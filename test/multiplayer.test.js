import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {heartbeat as heartbeatFunction} from '../convex/room.js';
import {DEFAULT_ROOM,validateLook,findPath} from '../convex/lib/rules.js';
import appearanceCatalog from '../public/assets/appearance/catalog.json';
import {furniture} from '../convex/lib/catalog.js';
import {docItem} from '../convex/lib/furnitureStore.js';
const modules=import.meta.glob('../convex/**/*.js');
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const token='a'.repeat(64),adminToken='b'.repeat(64),otherToken='c'.repeat(64),secret='test-entry-only';
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
let t;
beforeEach(async()=>{t=convexTest(schema,modules);vi.stubEnv('GRANT_ENTRY_HASH',await digest(secret));});
afterEach(()=>vi.unstubAllEnvs());
const guest=()=>t.mutation(api.room.join,{token,name:'Visitor',look});
const admin=()=>t.mutation(api.room.join,{token:adminToken,name:'Grant',look,entryCode:secret});
// Every piece in the world, wherever it stands, in the order it was added.
const everywhere=()=>t.run(async ctx=>(await ctx.db.query('furniture').collect()).map(docItem));
describe('room access and persistence',()=>{
  it('checks a name without creating a player and rejects reserved or recently used names',async()=>{
    await t.query(api.room.checkName,{name:'NewVisitor'});
    expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(0);
    await expect(t.query(api.room.checkName,{name:'1'})).rejects.toThrow('2–20');
    await expect(t.query(api.room.checkName,{name:'Ｇｒａｎｔ'})).rejects.toThrow('reserved');
    await t.query(api.room.checkName,{name:'Grant',entryCode:secret});
    await expect(t.query(api.room.checkName,{name:'Grant',entryCode:'wrong'})).rejects.toThrow('not valid');
    const me=await guest();
    await expect(t.query(api.room.checkName,{name:' visitor '})).rejects.toThrow('already taken');
    await t.run(ctx=>ctx.db.patch(me.id,{lastSeen:Date.now()-4*60*60*1000-1}));
    await t.query(api.room.checkName,{name:'Visitor'});
  });

  it('does not rewrite players or scan visits on an idle heartbeat',async()=>{
    const me=await guest(),connectionId='d'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId});
    const before=await t.run(ctx=>ctx.db.get(me.id));
    const jobsBefore=await t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect());
    const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+15000);
    try{
      const tables=[],gets=[],writes=[];
      await t.run(ctx=>heartbeatFunction._handler({...ctx,db:new Proxy(ctx.db,{get(db,key){
        if(key==='query')return table=>{tables.push(table);return db.query(table);};
        if(key==='get')return id=>{gets.push(id);return db.get(id);};
        if(key==='patch')return (id,fields)=>{writes.push(Object.keys(fields));return db.patch(id,fields);};
        return typeof db[key]==='function'?db[key].bind(db):db[key];
      }})},{token,connectionId}));
      expect(tables).toEqual(['sessions','connections']);expect(gets).toEqual([]);expect(writes).toEqual([['lastSeen']]);
      expect(await t.run(ctx=>ctx.db.get(me.id))).toEqual(before);
      expect((await t.run(ctx=>ctx.db.system.query('_scheduled_functions').collect())).length).toBe(jobsBefore.length);
    }finally{clock.mockRestore();}
  });

  it('keeps idle players present and their tiles reserved, then removes them after a crash',async()=>{
    const me=await guest();await admin();const connectionId='d'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId});
    const initial=await t.run(ctx=>ctx.db.query('connections').first());
    const clock=vi.spyOn(Date,'now').mockReturnValue(initial.lastSeen+30000);
    try{
      await t.mutation(api.room.heartbeat,{token,connectionId});
      clock.mockReturnValue(initial.lastSeen+45000);
      await t.mutation(internal.room.expireConnection,{connectionId,seenAt:initial.lastSeen});
      const renewed=await t.run(ctx=>ctx.db.query('connections').first());
      expect(renewed.expiryAt).toBe(initial.lastSeen+75000);
      clock.mockReturnValue(initial.lastSeen+60000);
      expect((await t.query(api.room.presence,{})).players.some(p=>p.id===me.id)).toBe(true);
      await expect(t.mutation(api.room.move,{token:adminToken,x:Math.floor(me.route[0].x),z:Math.floor(me.route[0].z)})).rejects.toThrow('reached');
      expect(await t.query(internal.room.voiceIdentity,{token})).toEqual({playerId:me.id,zone:'main'});
      clock.mockReturnValue(initial.lastSeen+75001);
      await t.mutation(internal.room.expireConnection,{connectionId,seenAt:renewed.lastSeen});
      expect((await t.query(api.room.presence,{})).players.some(p=>p.id===me.id)).toBe(false);
      expect((await t.query(api.visits.page,{token})).visits.find(v=>v.name==='Visitor').leftAt).not.toBeNull();
    }finally{clock.mockRestore();}
  });
  it('adopts pre-upgrade connections and ignores their old expiry jobs',async()=>{
    const me=await guest(),connectionId='d'.repeat(64),now=Date.now();
    await t.run(async ctx=>{
      const session=await ctx.db.query('sessions').first();await ctx.db.patch(session._id,{role:undefined});
      await ctx.db.insert('connections',{connectionId,playerId:me.id,tokenHash:await digest(token),lastSeen:now-15000});
    });
    await t.mutation(api.room.heartbeat,{token,connectionId});
    expect((await t.run(ctx=>ctx.db.get(me.id))).online).toBe(true);
    expect((await t.run(ctx=>ctx.db.query('sessions').first())).role).toBe('guest');
    await t.mutation(internal.room.expireConnection,{connectionId,seenAt:now-15000});
    expect((await t.query(api.room.presence,{})).players.some(p=>p.id===me.id)).toBe(true);
  });
  it('expires an arrival that never opens a connection',async()=>{
    const me=await guest(),p=await t.run(ctx=>ctx.db.get(me.id));
    const clock=vi.spyOn(Date,'now').mockReturnValue(p.lastSeen+45000);
    try{
      await t.mutation(internal.room.expireArrival,{playerId:me.id,seenAt:p.lastSeen});
      expect((await t.query(api.room.presence,{})).players).toEqual([]);
      expect((await t.query(api.visits.page,{token})).visits[0].leftAt).not.toBeNull();
    }finally{clock.mockRestore();}
  });
  it('shares presence without chat or room payloads and keeps chat independent of movement',async()=>{
    await guest();await admin();await t.mutation(api.room.chat,{token,body:'Hello',mode:'Say'});
    const presence=await t.query(api.room.presence,{}),feed=await t.query(api.room.chatFeed,{token});
    expect(presence).not.toHaveProperty('messages');expect(presence).not.toHaveProperty('room');
    expect(feed.map(m=>m.body)).toEqual(['Hello']);
    await expect(t.query(api.room.chatFeed,{token:otherToken})).rejects.toThrow('session');
    await t.mutation(api.room.move,{token,x:7,z:7});expect(await t.query(api.room.chatFeed,{token})).toEqual(feed);
    expect(JSON.stringify(presence)).not.toContain('tokenHash');
    expect(await t.query(api.room.session,{token})).toEqual({id:(await t.query(api.room.me,{token})).id});
    await expect(t.query(api.room.session,{token:otherToken})).rejects.toThrow('session');
    expect(await t.query(api.room.scene,{})).toEqual((await t.query(api.room.preview,{})).room);
  });
  it('shares a short typing lease without changing presence, and clears it when a message is sent',async()=>{
    await guest();await admin();
    const before=await t.query(api.room.me,{token});
    await t.mutation(api.room.setTyping,{token,typing:true});
    const state=await t.query(api.room.state,{token:adminToken,presenceOnly:true});
    const visitor=state.players.find(p=>p.id===before.id);
    expect(visitor.typingUntil-state.serverTime).toBeGreaterThan(3500);
    expect(visitor.typingUntil-state.serverTime).toBeLessThanOrEqual(4000);
    expect(visitor.lastSeen).toBe(before.lastSeen);
    await t.mutation(api.room.setTyping,{token,typing:true});
    expect((await t.query(api.room.me,{token})).typingUntil).toBe(visitor.typingUntil);
    await t.mutation(api.room.chat,{token,body:'Hello',mode:'Say'});
    expect((await t.query(api.room.me,{token})).typingUntil).toBe(0);
  });
  it('lets typing expire, clears an abandoned draft, and rejects invalid or offline sessions',async()=>{
    await guest();await t.mutation(api.room.setTyping,{token,typing:true});
    const player=await t.query(api.room.me,{token});
    const clock=vi.spyOn(Date,'now').mockReturnValue(player.typingUntil+1);
    try{
      const state=await t.query(api.room.state,{token,presenceOnly:true});
      expect(state.me.typingUntil).toBeLessThan(state.serverTime);
    }finally{clock.mockRestore();}
    await t.mutation(api.room.setTyping,{token,typing:false});
    expect((await t.query(api.room.me,{token})).typingUntil).toBe(0);
    await expect(t.mutation(api.room.setTyping,{token:otherToken,typing:true})).rejects.toThrow('session');
    await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0}));
    await expect(t.mutation(api.room.setTyping,{token,typing:true})).rejects.toThrow('Enter the room');
  });
  it('lets visitors switch floor and DJ power without giving them furniture editing access',async()=>{
    await admin();await guest();
    expect((await t.query(api.room.preview,{})).room.danceFloorOn).toBe(true);
    await expect(t.mutation(api.room.setDanceFloor,{token:otherToken,on:false})).rejects.toThrow();
    await t.mutation(api.room.setDanceFloor,{token,on:false});
    expect((await t.query(api.room.roomState,{token})).danceFloorOn).toBe(false);
    expect((await t.query(api.room.preview,{})).room.danceFloorOn).toBe(false);
    const items=[{id:'decks',type:'custom_dj_decks',rotation:2,x:0,z:0,on:false}];
    await t.mutation(api.room.setFurniture,{token:adminToken,items,revision:0});
    expect((await t.query(api.room.roomState,{token})).furniture[0].on).toBe(false);
    await expect(t.mutation(api.room.setFurniture,{token,items:[{...items[0],on:true}],revision:1})).rejects.toThrow('you built');
    await t.mutation(api.room.gesture,{token,action:'dance'});
    await t.mutation(api.room.setDeckPower,{token,id:'decks',on:true});
    expect((await t.query(api.room.preview,{})).room.furniture[0].on).toBe(true);
    expect((await t.query(api.room.me,{token})).action).toBe('dance');
    await expect(t.mutation(api.room.setDeckPower,{token:otherToken,id:'decks',on:false})).rejects.toThrow();
    await expect(t.mutation(api.room.setDeckPower,{token,id:'missing',on:false})).rejects.toThrow();
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{...items[0],x:null,z:null},{id:'chair',type:'small_chair_armas',rotation:0,x:2,z:2}],revision:2});
    for(const id of ['decks','chair'])await expect(t.mutation(api.room.setDeckPower,{token,id,on:true})).rejects.toThrow('can be switched');
  });
  it('saves decks on the record cabinet in both orientations',async()=>{
    await admin();
    for(const [revision,rotation] of [2,4].entries()){
      const items=[{id:'table',type:'custom_dj_table',rotation,x:1,z:1},{id:'decks',type:'custom_dj_decks',rotation,x:1,z:1,supportId:'table'}];
      await t.mutation(api.room.setFurniture,{token:adminToken,items,revision});
      expect((await t.query(api.room.preview,{})).room.furniture).toEqual(items);
    }
  });
  it('keeps dancing across walking routes but stops when sitting',async()=>{
    await admin();await guest();
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'seat',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:0});
    await t.mutation(api.room.gesture,{token,action:'dance'});
    for(const [x,z] of [[7,7],[6,8]]){
      await t.mutation(api.room.move,{token,x,z});
      expect((await t.query(api.room.me,{token})).action).toBe('dance');
    }
    await t.mutation(api.room.move,{token,x:1,z:1,seatId:'seat'});
    expect((await t.query(api.room.me,{token})).action).toBe(null);
  });
  it('saves and reloads both custom furniture items in every rotation',async()=>{
    await admin();
    let revision=0;
    for(const rotation of [0,2,4,6]){
      const items=[{id:'decks',type:'custom_dj_decks',rotation,x:0,z:0},{id:'car',type:'custom_porsche',rotation,x:4,z:0}];
      await t.mutation(api.room.setFurniture,{token:adminToken,items,revision:revision++});
      expect((await t.query(api.room.roomState,{token:adminToken})).furniture).toEqual(items);
    }
  });
  it('reserves Grant including case, whitespace and Unicode variants',async()=>{
    for(const name of ['Grant','GRANT',' grant ','Ｇｒａｎｔ'])await expect(t.mutation(api.room.join,{token,name,look})).rejects.toThrow('reserved');
  });
  it('rejects bad private links and only gives the valid private entry admin access',async()=>{
    await expect(t.mutation(api.room.join,{token,name:'Grant',look,entryCode:'wrong'})).rejects.toThrow('not valid');
    const owner=await admin();expect(owner.name).toBe('Grant');expect(owner.role).toBe('admin');
  });
  it('keeps Grant’s saved look on re-entry unless the editor deliberately changes it',async()=>{
    await admin();
    const styled={...look,hair:{...look.hair,color:'#b34c43'}};
    await t.mutation(api.room.appearance,{token:adminToken,look:styled});
    await expect(t.query(api.room.entryAppearance,{entryCode:'wrong'})).rejects.toThrow('not valid');
    expect(await t.query(api.room.entryAppearance,{entryCode:secret})).toEqual(styled);
    const resumed=await t.mutation(api.room.join,{token:otherToken,name:'Grant',look,entryCode:secret});
    expect(resumed.look).toEqual(styled);
    const edited=await t.mutation(api.room.join,{token,name:'Grant',look,entryCode:secret,replaceLook:true});
    expect(edited.look).toEqual(look);
  });
  it('rejects every editing endpoint for a guest',async()=>{
    await guest();
    for(const [fn,args] of [[api.room.setOptions,{options:DEFAULT_ROOM,revision:0}],[api.room.seed,{options:DEFAULT_ROOM,items:[]}]])await expect(t.mutation(fn,{token,...args})).rejects.toThrow('Only Grant');
    // Guests may save furniture, but only pieces they built (none here).
    await expect(t.mutation(api.room.setFurniture,{token,items:[{id:'c',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:0})).rejects.toThrow('you built');
  });
  it('keeps room state for older tabs while new tabs subscribe to presence separately',async()=>{
    await guest();
    const legacy=await t.query(api.room.state,{token});
    const presence=await t.query(api.room.state,{token,presenceOnly:true});
    expect(legacy.room).toEqual(await t.query(api.room.roomState,{token}));
    expect(presence).not.toHaveProperty('room');
    expect(presence.me.id).toBe(legacy.me.id);
    expect(presence.players).toEqual(legacy.players);
    await expect(t.query(api.room.state,{token:otherToken,presenceOnly:true})).rejects.toThrow('session');
  });
  it('stores only token hashes and never exposes them in shared state',async()=>{
    await guest();const sessions=await t.run(ctx=>ctx.db.query('sessions').collect());expect(sessions[0].tokenHash).toBe(await digest(token));
    const state=await t.query(api.room.state,{token});expect(JSON.stringify(state)).not.toContain('tokenHash');expect(JSON.stringify(state)).not.toContain(token);
  });
  it('preserves a guest appearance and rejects duplicate names or forged sessions',async()=>{
    await guest();const changed=structuredClone(look);changed.top.color='#b34c43';await t.mutation(api.room.appearance,{token,look:changed});
    expect((await t.query(api.room.me,{token})).look).toEqual(changed);
    await expect(t.mutation(api.room.join,{token:otherToken,name:'VISITOR',look})).rejects.toThrow('already taken');
    await expect(t.query(api.room.state,{token:otherToken})).rejects.toThrow('session');
    await t.run(async ctx=>{const s=await ctx.db.query('sessions').first();await ctx.db.patch(s._id,{expiresAt:1});});
    await expect(t.mutation(api.room.move,{token,x:0,z:0})).rejects.toThrow('session');
  });
  it('validates looks and prevents extra privilege fields',async()=>{
    await expect(t.mutation(api.room.join,{token,name:'Visitor',look:{...look,role:'admin'}})).rejects.toThrow('appearance');
    await guest();await expect(t.mutation(api.room.appearance,{token,look:{...look,top:{model:'evil',color:'#ffffff'}}})).rejects.toThrow('appearance');
  });
  it('accepts every selectable source style and palette, including accessory second colours',()=>{
    for(const [group,models] of Object.entries(appearanceCatalog.choices)){
      for(const model of models){
        const choice={...look,[group]:{model,color:appearanceCatalog.colors[group][0]}};
        expect(validateLook(choice)).toEqual(choice);
      }
      for(const color of appearanceCatalog.colors[group]){
        const choice={...look,[group]:{model:models[0],color,color2:color}};
        expect(validateLook(choice)).toEqual(choice);
      }
    }
    expect(()=>validateLook({...look,hats:{model:'none',color:'#ffffff',color2:'#abcdef'}})).toThrow('appearance');
  });
  it('persists room edits and rejects stale overwrites',async()=>{
    await admin();await guest();const options={...DEFAULT_ROOM,window:false};
    await t.mutation(api.room.setOptions,{token:adminToken,options,revision:0});
    expect((await t.query(api.room.roomState,{token})).options).toEqual(options);
    await expect(t.mutation(api.room.setOptions,{token:adminToken,options:DEFAULT_ROOM,revision:0})).rejects.toThrow('room changed');
    await t.mutation(api.room.seed,{token:adminToken,options:DEFAULT_ROOM,items:[]});
    expect((await t.query(api.room.roomState,{token})).options.window).toBe(false);
  });
  it('shares messages with server-owned sender identity',async()=>{
    await guest();await admin();await t.mutation(api.room.chat,{token,body:'Hello room',mode:'Say'});
    const state=await t.query(api.room.state,{token:adminToken});expect(state.messages.at(-1)).toMatchObject({name:'Visitor',body:'Hello room',color:look.top.color});
    await expect(t.mutation(api.room.chat,{token,body:'Again',mode:'Say'})).rejects.toThrow('wait');
  });
  it('validates furniture and movement, including occupied seats',async()=>{
    await admin();await guest();
    const [type,def]=Object.entries(furniture).find(([,d])=>d.category==='Seating'&&d.width===1&&d.depth===1);
    const seat={id:'chair',type,rotation:def.views[0].direction,x:4,z:4};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[seat],revision:0});
    await expect(t.mutation(api.room.move,{token,x:4,z:4})).rejects.toThrow('reached');
    await expect(t.mutation(api.room.move,{token,x:999,z:999})).rejects.toThrow('reached');
    await t.mutation(api.room.move,{token,x:4,z:4,seatId:'chair'});
    await expect(t.mutation(api.room.move,{token:adminToken,x:4,z:4,seatId:'chair'})).rejects.toThrow('already using');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[{...seat,x:-1}],revision:1})).rejects.toThrow('fit');
    expect((await t.query(api.room.roomState,{token})).furniture).toEqual([seat]);
  });
  it('seats three people at the bar and serves drinks only after they arrive',async()=>{
    const owner=await admin(),visitor=await guest(),third=await t.mutation(api.room.join,{token:otherToken,name:'Third',look});
    const bar={id:'bar',type:'custom_bar',rotation:2,x:0,z:11};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[bar],revision:0});
    const players=[[token,visitor,12],[adminToken,owner,13],[otherToken,third,14]];
    for(const [,player,z] of players)await t.run(ctx=>ctx.db.patch(player.id,{route:[{x:3.5,z:z+.5}],startedAt:Date.now(),lastSeen:Date.now()}));
    await expect(t.mutation(api.room.move,{token,x:1,z:12,seatId:'bar'})).rejects.toThrow('not available');
    await expect(t.mutation(api.room.takeDrink,{token,id:'bar'})).rejects.toThrow('Sit on');
    const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
    try{
      for(const [session,,z] of players)await t.mutation(api.room.move,{token:session,x:2,z,seatId:'bar'});
      await expect(t.mutation(api.room.takeDrink,{token,id:'bar'})).rejects.toThrow('Sit on');
      clock.mockReturnValue(now+1000);
      for(const [session] of players)await t.mutation(api.room.takeDrink,{token:session,id:'bar'});
      await expect(t.mutation(api.room.move,{token:adminToken,x:2,z:12,seatId:'bar'})).rejects.toThrow('already using');
      const state=await t.query(api.room.state,{token,presenceOnly:true});
      expect(state.players.filter(p=>p.seatId==='bar')).toHaveLength(3);
      for(const player of state.players){expect(player.direction).toBe(6);expect(player.drink).toBe(now+1000);}
    }finally{clock.mockRestore();}
  });
  it('seats players in the car on its cabin tile only, facing the way the car points',async()=>{
    await admin();await guest();
    const car={id:'car',type:'custom_porsche',rotation:2,x:3,z:3};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[car],revision:0});
    await expect(t.mutation(api.room.move,{token,x:3,z:3,seatId:'car'})).rejects.toThrow('not available');
    await expect(t.mutation(api.room.move,{token,x:4,z:4})).rejects.toThrow('reached');
    const ride=await t.mutation(api.room.move,{token,x:4,z:4,seatId:'car'});
    expect(ride).toMatchObject({seatId:'car',direction:4});expect(ride.route.at(-1)).toEqual({x:4.5,z:4.5});
    await expect(t.mutation(api.room.move,{token:adminToken,x:4,z:4,seatId:'car'})).rejects.toThrow('already using');
  });
  it('lets a move end facing a chosen direction and rejects other values',async()=>{
    await guest();
    const turn=await t.mutation(api.room.move,{token,x:2,z:2,direction:6});
    expect(turn.direction).toBe(6);expect((await t.query(api.room.state,{token})).me.direction).toBe(6);
    await expect(t.mutation(api.room.move,{token,x:2,z:2,direction:3})).rejects.toThrow();
  });
  it('hands out a drink only from a fridge within reach and flashes it open for the room',async()=>{
    await admin();const me=await guest();
    const here={x:Math.floor(me.route[0].x),z:Math.floor(me.route[0].z)};
    const near={id:'near',type:'fridge',rotation:2,x:here.x+1,z:here.z},far={id:'far',type:'fridge',rotation:2,x:7,z:7};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[near,far],revision:0});
    await expect(t.mutation(api.room.takeDrink,{token,id:'far'})).rejects.toThrow('Walk up');
    await expect(t.mutation(api.room.takeDrink,{token,id:'nope'})).rejects.toThrow('no fridge');
    await t.mutation(api.room.takeDrink,{token,id:'near'});
    const state=await t.query(api.room.state,{token});
    expect(state.me.drink).toBeGreaterThan(0);expect((await t.query(api.room.roomState,{token})).fridge).toMatchObject({id:'near'});
    await expect(t.mutation(api.room.takeDrink,{token,id:'near'})).rejects.toThrow('wait');
  });
  it('toggles breakdancing like dancing and switches between the two',async()=>{
    await guest();
    await t.mutation(api.room.gesture,{token,action:'breakdance'});
    expect((await t.query(api.room.state,{token})).me.action).toBe('breakdance');
    await new Promise(r=>setTimeout(r,320));
    await t.mutation(api.room.gesture,{token,action:'dance'});
    expect((await t.query(api.room.state,{token})).me.action).toBe('dance');
    await new Promise(r=>setTimeout(r,320));
    await t.mutation(api.room.gesture,{token,action:'dance'});
    expect((await t.query(api.room.state,{token})).me.action).toBeNull();
  });
  it('frees a guest name four hours after its holder was last seen, but never Grant',async()=>{
    await guest();
    await expect(t.mutation(api.room.join,{token:otherToken,name:'Visitor',look})).rejects.toThrow('already taken');
    const later=Date.now()+4*60*60*1000+60000,clock=vi.spyOn(Date,'now').mockReturnValue(later);
    try{
      await expect(t.mutation(api.room.join,{token:otherToken,name:'Grant',look})).rejects.toThrow('reserved');
      const fresh=structuredClone(look);fresh.top.color='#b34c43';
      const taken=await t.mutation(api.room.join,{token:otherToken,name:'visitor',look:fresh});
      expect(taken.name).toBe('visitor');expect(taken.look).toEqual(fresh);
      expect((await t.query(api.room.me,{token:otherToken})).look).toEqual(fresh);
      await expect(t.query(api.room.state,{token})).rejects.toThrow('session');
    }finally{clock.mockRestore();}
  });
  it('runs Pong solo against the computer, lets a second player take the other paddle, and scores misses',async()=>{
    const me=await guest(),other=await admin();
    expect((await t.query(api.pong.state,{})).status).toBe('idle');
    await t.mutation(api.pong.join,{token});
    let game=await t.query(api.pong.state,{});
    expect(game.status).toBe('playing');expect(game.a.id).toBe(me.id);expect(game.b).toBeNull();
    // Solo: the only player also drives paddle b.
    await t.mutation(api.pong.paddle,{token,side:'b',y:20});
    expect((await t.query(api.pong.state,{})).paddles.b.y).toBe(20);
    await t.mutation(api.pong.join,{token:adminToken});
    game=await t.query(api.pong.state,{});expect(game.b.id).toBe(other.id);
    await expect(t.mutation(api.pong.paddle,{token,side:'b',y:30})).rejects.toThrow('not yours');
    // Put the ball just about to reach paddle a, then report the hit and a miss.
    const now=Date.now();
    await t.run(async ctx=>{const g=await ctx.db.query('pong').first();await ctx.db.patch(g._id,{ball:{x:7.1,y:36,vx:-60,vy:0,at:now,serial:5},paddles:{a:{y:36,at:now},b:{y:36,at:now}}});});
    await t.mutation(api.pong.hit,{token,side:'a',y:36,serial:5});
    game=await t.query(api.pong.state,{});expect(game.ball.serial).toBe(6);expect(game.ball.vx).toBeGreaterThan(0);
    await t.run(async ctx=>{const g=await ctx.db.query('pong').first();await ctx.db.patch(g._id,{ball:{x:-5,y:36,vx:-60,vy:0,at:Date.now()-100,serial:6}});});
    await t.mutation(api.pong.miss,{token,side:'a',serial:6});
    game=await t.query(api.pong.state,{});expect(game.scores).toEqual({a:0,b:1});expect(game.ball.serial).toBe(7);
    await t.mutation(api.pong.miss,{token,side:'a',serial:6});
    expect((await t.query(api.pong.state,{})).scores.b).toBe(1);
    await t.mutation(api.pong.leave,{token:adminToken});
    expect((await t.query(api.pong.state,{})).b).toBeNull();
  });
  it('streams whiteboard strokes in chunks, serves deltas by serial, and clears for everyone',async()=>{
    await guest();await admin();
    await t.mutation(api.whiteboard.draw,{token,id:'stroke-one',color:'#1b1b1b',size:4,points:[10,10,20,20],done:false});
    await t.mutation(api.whiteboard.draw,{token,id:'stroke-one',color:'#1b1b1b',size:4,points:[30,30],done:true});
    await expect(t.mutation(api.whiteboard.draw,{token:adminToken,id:'stroke-one',color:'#1b1b1b',size:4,points:[1,1],done:true})).rejects.toThrow('not yours');
    await expect(t.mutation(api.whiteboard.draw,{token,id:'bad',color:'#123456',size:4,points:[1,1],done:true})).rejects.toThrow('Bad stroke');
    const all=await t.query(api.whiteboard.all,{});
    expect(all.strokes).toHaveLength(1);expect(all.strokes[0].points).toEqual([10,10,20,20,30,30]);expect(all.serial).toBe(2);
    await t.mutation(api.whiteboard.draw,{token:adminToken,id:'stroke-two',color:'#d7263d',size:8,points:[1,1,2,2],done:true});
    const delta=await t.query(api.whiteboard.updates,{after:2});
    expect(delta.strokes.map(s=>s.id)).toEqual(['stroke-two']);expect(delta.serial).toBe(3);
    await t.mutation(api.whiteboard.clear,{token});
    const cleared=await t.query(api.whiteboard.updates,{after:3});
    expect(cleared.strokes).toEqual([]);expect(cleared.clearedSerial).toBe(4);
    expect((await t.query(api.whiteboard.all,{})).strokes).toEqual([]);
  });
  it('seats a player who stops on the sunken sofa, facing the rug',async()=>{
    await guest();
    const layout=(await import('../shared/room-layout.js')).roomLayout((await import('../convex/lib/catalog.js')).shapes[DEFAULT_ROOM.shape]);
    const p=layout.pit;
    const onSofa=await t.mutation(api.room.move,{token,x:p.x+1,z:p.z});
    expect(onSofa.seatId).toBe('pit');expect(onSofa.direction).toBe(4);
    const onRug=await t.mutation(api.room.move,{token,x:p.x+2,z:p.z+1});
    expect(onRug.seatId).toBeNull();
  });
  it('keeps a guest book of entries and exits',async()=>{
    const me=await guest();await admin();
    let page=await t.query(api.visits.page,{token});
    const mine=page.visits.filter(v=>v.name==='Visitor');expect(mine).toHaveLength(1);expect(mine[0].leftAt).toBeNull();
    await expect(t.query(api.visits.page,{token:otherToken})).rejects.toThrow('session');
    // A clean disconnect of the last connection closes the visit.
    const connectionId='c'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId});
    await t.mutation(internal.room.disconnect,{token,connectionId});
    page=await t.query(api.visits.page,{token});
    expect(page.visits.find(v=>v.name==='Visitor').leftAt).toBeGreaterThan(0);
    // Coming back after being away opens a new visit; the old one stays closed.
    await t.run(async ctx=>{await ctx.db.patch(me.id,{lastSeen:Date.now()-60000});});
    await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64)});
    page=await t.query(api.visits.page,{token});
    const visits=page.visits.filter(v=>v.name==='Visitor');expect(visits).toHaveLength(2);expect(visits[0].leftAt).toBeNull();expect(visits[1].leftAt).toBeGreaterThan(0);
  });
  it('reaches a car cabin through the car body when it is parked against the wall',async()=>{
    await admin();await guest();
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'car',type:'custom_porsche',rotation:2,x:6,z:0}],revision:0});
    const ride=await t.mutation(api.room.move,{token,x:7,z:1,seatId:'car'});
    expect(ride.route.at(-1)).toEqual({x:7.5,z:1.5});expect([[6.5,1.5],[7.5,0.5],[7.5,2.5]]).toContainEqual([ride.route.at(-2).x,ride.route.at(-2).z]);
    await expect(t.mutation(api.room.move,{token:adminToken,x:6,z:1})).rejects.toThrow('reached');
  });
  it.each([null,'wave'])('lets a player leave a car with its cabin exit blocked after %s',async action=>{
    await admin();const me=await guest();
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'car',type:'custom_porsche',rotation:2,x:0,z:0},{id:'chair',type:'small_chair_armas',rotation:0,x:2,z:1}],revision:0});
    const ride=await t.mutation(api.room.move,{token,x:1,z:1,seatId:'car'});
    await t.run(ctx=>ctx.db.patch(me.id,{startedAt:ride.startedAt-10000}));
    if(action)await t.mutation(api.room.gesture,{token,action});
    const walk=await t.mutation(api.room.move,{token,x:3,z:1});
    expect(walk.seatId).toBeNull();
    expect(walk.route[0]).toEqual({x:1.5,z:1.5});expect(walk.route.at(-1)).toEqual({x:3.5,z:1.5});
    expect(walk.route).not.toContainEqual({x:2.5,z:1.5});
    expect((await t.query(api.room.me,{token})).seatId).toBeNull();
  });
  it('can redirect a walk while still inside furniture without allowing blocked destinations',()=>{
    const room={options:DEFAULT_ROOM,furniture:[{id:'car',type:'custom_porsche',rotation:2,x:6,z:0}]};
    const start={x:7.2,z:1.5};
    const route=findPath(room,start,{x:5,z:1},null,new Set(['8,1']));
    expect(route?.[0]).toEqual(start);expect(route?.at(-1)).toEqual({x:5.5,z:1.5});
    expect(findPath(room,start,{x:6,z:1})).toBeNull();
    expect(findPath(room,start,{x:7,z:1})).toBeNull();
  });
  it('keeps other furniture and player reservations blocked when leaving a car',()=>{
    const room={options:DEFAULT_ROOM,furniture:[{id:'car',type:'custom_porsche',rotation:2,x:6,z:0}]};
    const start={x:7.5,z:1.5},end={x:5,z:1};
    // Every possible step from the cabin is reserved.
    expect(findPath(room,start,end,null,new Set(['6,1','8,1','7,0','7,2']))).toBeNull();
    room.furniture.push({id:'chair',type:'small_chair_armas',rotation:0,x:5,z:1});
    expect(findPath(room,start,end)).toBeNull();
    const route=findPath(room,start,{x:4,z:1});
    expect(route).not.toBeNull();expect(route).not.toContainEqual({x:5.5,z:1.5});
  });
  it('gives arrivals separate tiles and rejects walking onto another player',async()=>{
    const a=await guest(),b=await admin();expect(a.route[0]).not.toEqual(b.route[0]);
    await expect(t.mutation(api.room.move,{token,x:Math.floor(b.route[0].x),z:Math.floor(b.route[0].z)})).rejects.toThrow('reached');
    const path=await t.mutation(api.room.move,{token,x:7,z:7});
    const reserved=path.route.at(-1);
    await expect(t.mutation(api.room.move,{token:adminToken,x:Math.floor(reserved.x),z:Math.floor(reserved.z)})).rejects.toThrow('reached');
  });
  it('allows visitors to walk onto a rug without furniture permissions',async()=>{
    await admin();await guest();
    const [type,def]=Object.entries(furniture).find(([,d])=>d.category==='Rugs'&&d.width<=3&&d.depth<=3);
    const rug={id:'walkable-rug',type,rotation:def.views[0].direction,x:4,z:4};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[rug],revision:0});
    const result=await t.mutation(api.room.move,{token,x:4,z:4});
    expect(result.route.at(-1)).toEqual({x:4.5,z:4.5});
  });
  it('persists supported tabletop items and rejects orphaned or overlapping stacks',async()=>{
    await admin();await guest();
    const table={id:'table',type:'small_table_armas',rotation:0,x:4,z:4};
    const duck={id:'duck',type:'duck',rotation:furniture.duck.views[0].direction,x:4,z:4,supportId:'table'};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[table,duck],revision:0});
    expect((await t.query(api.room.roomState,{token})).furniture).toEqual([table,duck]);
    await expect(t.mutation(api.room.setFurniture,{token,items:[{...table,x:5},{...duck,x:5}],revision:1})).rejects.toThrow('you built');
    // A piece whose table is gone heals into the inventory rather than failing the save.
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[duck],revision:1});
    expect((await t.query(api.room.roomState,{token:adminToken})).furniture).toEqual([{id:'duck',type:'duck',rotation:duck.rotation,x:null,z:null}]);
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,duck,{...duck,id:'other'}],revision:2})).rejects.toThrow('tabletop');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,{...duck,height:99}],revision:2})).rejects.toThrow('Invalid furniture');
  });
  it('accepts both fridge facings',async()=>{
    await admin();
    for(const [revision,rotation] of [2,4].entries()){
      await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'fridge',type:'fridge',rotation,x:4,z:4}],revision});
      expect((await t.query(api.room.roomState,{token:adminToken})).furniture[0].rotation).toBe(rotation);
    }
  });
  it('removes a closing connection without removing other tabs for the same player',async()=>{
    await guest();await admin();const a='d'.repeat(64),b='e'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId:a});await t.mutation(api.room.heartbeat,{token,connectionId:b});
    await t.mutation(internal.room.disconnect,{token:adminToken,connectionId:a});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(true);
    await t.mutation(internal.room.disconnect,{token,connectionId:a});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(true);
    await t.mutation(internal.room.disconnect,{token,connectionId:b});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(false);
    expect((await t.query(api.room.me,{token})).name).toBe('Visitor');
  });
  it('leaves one session without hiding another connected session for Grant',async()=>{
    const me=await admin();await t.mutation(api.room.join,{token:otherToken,name:'Grant',look,entryCode:secret});
    await t.mutation(api.room.heartbeat,{token:adminToken,connectionId:'d'.repeat(64)});
    await t.mutation(api.room.heartbeat,{token:otherToken,connectionId:'e'.repeat(64)});
    await t.mutation(api.room.leave,{token:adminToken});
    expect((await t.query(api.room.presence,{})).players.some(p=>p.id===me.id)).toBe(true);
    expect(await t.query(api.room.session,{token:otherToken})).toEqual({id:me.id});
    await expect(t.query(api.room.session,{token:adminToken})).rejects.toThrow('session');
  });
  it('ignores an old timeout after a heartbeat and expires a crashed connection',async()=>{
    await guest();await admin();const connectionId='d'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId});
    const connection=await t.run(ctx=>ctx.db.query('connections').first());
    await t.mutation(internal.room.expireConnection,{connectionId,seenAt:connection.lastSeen-1});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(true);
    const clock=vi.spyOn(Date,'now').mockReturnValue(connection.lastSeen+45001);
    try{
      await t.mutation(internal.room.expireConnection,{connectionId,seenAt:connection.lastSeen});
      expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(false);
    }finally{clock.mockRestore();}
  });

  it('shows the placed room and online players before a visitor joins',async()=>{
    await admin();const preview=await t.query(api.room.preview,{});expect(preview.players[0].name).toBe('Grant');expect(preview.room.options).toEqual(DEFAULT_ROOM);expect(JSON.stringify(preview)).not.toContain('tokenHash');
  });
  it('shares wave and dance, toggles dancing off, and stops actions when walking',async()=>{
    await guest();await admin();await t.mutation(api.room.gesture,{token,action:'wave'});
    expect((await t.query(api.room.state,{token:adminToken})).players.find(p=>p.name==='Visitor').action).toBe('wave');
    await t.run(async ctx=>{const p=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey','visitor')).unique();await ctx.db.patch(p._id,{actionStarted:0});});
    await t.mutation(api.room.gesture,{token,action:'dance'});expect((await t.query(api.room.me,{token})).action).toBe('dance');
    await t.run(async ctx=>{const p=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey','visitor')).unique();await ctx.db.patch(p._id,{actionStarted:0});});
    await t.mutation(api.room.gesture,{token,action:'dance'});expect((await t.query(api.room.me,{token})).action).toBe(null);
    await t.mutation(api.room.move,{token,x:7,z:7});expect((await t.query(api.room.me,{token})).action).toBe(null);
  });

});

describe('sticky notes',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const position={x:0,z:2,side:'left',u:.5,height:70};
  const create=()=>t.mutation(api.room.createSticky,{token:adminToken,id,position});
  it('restricts creation, editing, movement and deletion to Grant',async()=>{
    await guest();await admin();
    await expect(t.mutation(api.room.createSticky,{token,id,position})).rejects.toThrow('Only Grant');
    await create();
    await expect(t.mutation(api.room.editSticky,{token,id,revision:0,text:'forged',color:'#ffff33'})).rejects.toThrow('Only Grant');
    await expect(t.mutation(api.room.deleteSticky,{token,id,revision:0})).rejects.toThrow('Only Grant');
    await t.mutation(api.room.editSticky,{token:adminToken,id,revision:0,text:'Welcome',color:'#9cceff',position:{...position,side:'right',x:2,z:0}});
    const note=(await t.query(api.room.preview,{})).room.stickies[0];expect(note).toMatchObject({text:'Welcome',color:'#9cceff',side:'right',x:2,z:0,revision:1});
    expect((await t.query(api.room.roomState,{token})).stickies[0]).toEqual(note);
    await t.mutation(api.room.deleteSticky,{token:adminToken,id,revision:1});expect((await t.query(api.room.preview,{})).room.stickies).toEqual([]);
  });
  it('appends visitor text without overwriting concurrent additions, and rejects stale owner edits',async()=>{
    await admin();await guest();await create();
    await t.mutation(api.room.appendSticky,{token,id,text:'First'});
    await t.mutation(api.room.appendSticky,{token,id,text:'\nSecond'});
    expect((await t.query(api.room.preview,{})).room.stickies[0].text).toBe('First\nSecond');
    await expect(t.mutation(api.room.editSticky,{token:adminToken,id,revision:0,text:'overwrite',color:'#ffff33'})).rejects.toThrow('changed');
    await expect(t.mutation(api.room.deleteSticky,{token:adminToken,id,revision:0})).rejects.toThrow('changed');
    await expect(t.mutation(api.room.appendSticky,{token,id,text:'x'.repeat(2001)})).rejects.toThrow('2,000');
  });
  it('rejects invalid walls, colours and oversized text',async()=>{
    await admin();
    for(const bad of [{...position,x:2},{...position,height:200},{...position,u:2}])await expect(t.mutation(api.room.createSticky,{token:adminToken,id,position:bad})).rejects.toThrow('wall');
    await create();
    await expect(t.mutation(api.room.editSticky,{token:adminToken,id,revision:0,text:'hello',color:'red'})).rejects.toThrow('colour');
    await expect(t.mutation(api.room.editSticky,{token:adminToken,id,revision:0,text:'x'.repeat(2001),color:'#ffff33'})).rejects.toThrow('2,000');
  });
  it('keeps notes when furniture changes and relocates them when their wall disappears',async()=>{
    await admin();await create();
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[],revision:0});
    // Furniture edits no longer count on the map's revision; only the map itself does.
    await t.mutation(api.room.setOptions,{token:adminToken,options:{...DEFAULT_ROOM,shape:'model_f'},revision:0});
    const note=(await t.query(api.room.preview,{})).room.stickies[0];expect(note.id).toBe(id);expect(note.revision).toBe(1);
  });
});

describe('wall posters',()=>{
  const id='22222222-2222-4222-8222-222222222222',position={x:0,z:2,side:'left',u:.5,height:65};
  it('saves artwork and permits Grant to move it to the other wall',async()=>{
    await admin();await guest();
    await t.mutation(api.room.createSticky,{token:adminToken,id,position,poster:'neu'});
    expect((await t.query(api.room.preview,{})).room.stickies[0]).toMatchObject({poster:'neu',...position});
    await t.mutation(api.room.editSticky,{token:adminToken,id,revision:0,text:'',color:'#ffff33',position:{x:2,z:0,side:'right',u:.5,height:65}});
    expect((await t.query(api.room.preview,{})).room.stickies[0].side).toBe('right');
    await expect(t.mutation(api.room.appendSticky,{token,id,text:'change artwork'})).rejects.toThrow('poster');
    await expect(t.mutation(api.room.editSticky,{token:adminToken,id,revision:1,text:'change',color:'#ffff33'})).rejects.toThrow('artwork');
    await expect(t.mutation(api.room.deleteSticky,{token,id,revision:1})).rejects.toThrow('Only Grant');
  });
  it('rejects unsupported poster types, non-admin placement and prints extending past a wall',async()=>{
    await admin();await guest();
    await expect(t.mutation(api.room.createSticky,{token,id,position,poster:'neu'})).rejects.toThrow('Only Grant');
    await expect(t.mutation(api.room.createSticky,{token:adminToken,id,position,poster:'other'})).rejects.toThrow();
    for(const bad of [{...position,z:0},{...position,height:24},{...position,height:100}])await expect(t.mutation(api.room.createSticky,{token:adminToken,id,position:bad,poster:'neu'})).rejects.toThrow('wall');
  });
});

describe('wall furniture',()=>{
  const speaker={id:'speaker',type:'custom_speaker',rotation:2,x:0,z:2,u:.5,height:60};
  it('hangs on a continuous wall without taking floor space and survives room changes',async()=>{
    await admin();await guest();
    const chair={id:'chair',type:'small_chair_armas',rotation:0,x:0,z:2};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[speaker,chair],revision:0});
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([speaker,chair]);
    await t.mutation(api.room.move,{token,x:0,z:3});
    const room=(await t.query(api.room.roomState,{token}));
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{...speaker,rotation:4,x:2,z:0}],revision:room.revision});
    expect((await t.query(api.room.preview,{})).room.furniture[0]).toMatchObject({rotation:4,x:2,z:0});
    const inHand={id:'speaker',type:'custom_speaker',rotation:2,x:null,z:null};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[inHand],revision:room.revision+1});
    expect((await t.query(api.room.roomState,{token:adminToken})).furniture).toEqual([inHand]);
  });
  it('rejects wall pieces off the wall, on the floor, past a corner or with a wall position on floor pieces',async()=>{
    await admin();
    for(const bad of [{...speaker,x:3,z:3},{...speaker,rotation:0},{...speaker,z:0},{...speaker,height:20},{...speaker,u:undefined,height:undefined},{...speaker,supportId:'x'}])
      await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[bad],revision:0})).rejects.toThrow();
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:0,z:2,u:.5,height:60}],revision:0})).rejects.toThrow('wall');
  });
});

describe('agents building pieces',()=>{
  const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
  const spec=async(storageId,extra={})=>({name:'Boombox',category:'Decor',width:1,depth:1,spriteDensity:3,icon:storageId,parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:2,source:2,mirror:false},{direction:4,source:2,mirror:true}],...extra});
  // A builder with a key and, unless told otherwise, a space of their own (x 21 to 28 on the test shape):
  // pieces may only be placed inside it.
  async function attach({space=true}={}){
    const player=await guest();
    const {agentToken}=await t.mutation(api.agents.createKey,{token,label:'Codex'});
    const storageId=await t.run(ctx=>ctx.storage.store(png));
    if(space)await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    return {player,agentToken,storageId};
  }
  it('puts no cap on how many pieces a builder places or builds',async()=>{
    const {agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Wall',wallWidth:32,parts:[{storageId,direction:4,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:4,source:4,mirror:false}]})});
    const place=()=>t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:0,rotation:4,u:.5,height:60});
    for(let i=0;i<120;i++)await place();
    expect((await t.query(api.agents.status,{agentToken})).placed).toHaveLength(120);
    for(let i=0;i<60;i++)await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:`Piece ${i}`})});
    expect((await t.query(api.agents.status,{agentToken})).assets).toHaveLength(61);
  });
  it('lets a builder place and save more than two hundred pieces in one space, and pick them all up',async()=>{
    const {agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Wall',wallWidth:32,parts:[{storageId,direction:4,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:4,source:4,mirror:false}]})});
    const place=()=>t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:0,rotation:4,u:.5,height:60});
    for(let i=0;i<201;i++)await place();
    expect((await t.query(api.agents.status,{agentToken})).placed).toHaveLength(201);
    const items=[...await everywhere(),{...(await everywhere())[0],id:'from-browser'}];
    await t.mutation(api.room.setFurniture,{token,items,knowsAssets:true});
    expect(await everywhere()).toHaveLength(202);
    // Picking up a large collection must not introduce an inventory limit either.
    const inventory=items.map(({u,height,...item})=>({...item,x:null,z:null}));
    await t.mutation(api.room.setFurniture,{token,items:inventory,knowsAssets:true});
    expect((await t.query(api.agents.status,{agentToken})).placed).toHaveLength(0);
    expect(await t.query(api.room.inventory,{token})).toHaveLength(202);
  });
  it('reports connection only after authenticated agent contact, and clears it on revoke',async()=>{
    await guest();
    const {agentToken}=await t.mutation(api.agents.createKey,{token});
    expect((await t.query(api.agents.attached,{token}))[0].connectedAt).toBeNull();
    await expect(t.mutation(api.agents.connected,{agentToken:'f'.repeat(64)})).rejects.toThrow('not attached');
    await t.mutation(api.agents.connected,{agentToken});
    const [connected]=await t.query(api.agents.attached,{token});
    expect(connected.connectedAt).toBeTypeOf('number');
    await t.mutation(api.agents.connected,{agentToken});
    expect((await t.query(api.agents.attached,{token}))[0].connectedAt).toBe(connected.connectedAt);
    await t.mutation(api.agents.revoke,{token});
    expect(await t.query(api.agents.attached,{token})).toEqual([]);
  });
  it('hands the player a key for the hosted endpoint and reads uploads back through it',async()=>{
    await guest();
    const {agentToken}=await t.mutation(api.agents.createKey,{token,label:'Plugin'});
    expect(agentToken).toMatch(/^[a-f0-9]{64}$/);
    expect((await t.query(api.agents.attached,{token})).map(a=>a.label)).toEqual(['Plugin']);
    expect((await t.query(api.agents.status,{agentToken})).playerName).toBe('Visitor');
    const storageId=await t.run(ctx=>ctx.storage.store(png));
    expect(await t.query(api.agents.uploadedFile,{agentToken,storageId})).toMatch(/^http/);
    await expect(t.query(api.agents.uploadedFile,{agentToken,storageId:'nonsense'})).rejects.toThrow('storage id');
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    await expect(t.mutation(api.agents.discardUpload,{agentToken,storageId})).rejects.toThrow('belongs to a piece');
    const spare=await t.run(ctx=>ctx.storage.store(png));
    await t.mutation(api.agents.discardUpload,{agentToken,storageId:spare});
    expect(await t.run(ctx=>ctx.storage.getUrl(spare))).toBeNull();
    await t.mutation(api.agents.revoke,{token});
    await expect(t.query(api.agents.status,{agentToken})).rejects.toThrow('not attached');
    expect(built.type).toMatch(/^asset_/);
  });
  it('pairs once with a code, builds a piece everyone can see, and places it as the player',async()=>{
    const {player,agentToken,storageId}=await attach({space:false});
    expect((await t.query(api.agents.attached,{token})).map(a=>a.label)).toEqual(['Codex']);
    await expect(t.query(api.agents.status,{agentToken:'f'.repeat(64)})).rejects.toThrow('not attached');
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    const listed=await t.query(api.assets.list,{});
    expect(listed).toHaveLength(1);expect(listed[0]).toMatchObject({id:built.type,name:'Boombox',owner:player.id,ownerName:'Visitor',spriteDensity:3});
    expect(listed[0].parts[0].file).toMatch(/^http/);expect(listed[0].icon).toMatch(/^http/);
    // Builders place only inside a space of their own; without one, nothing can be placed.
    await expect(t.mutation(api.agents.place,{agentToken,assetId:built.id,x:3,z:3})).rejects.toThrow('Add a space first');
    await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    await expect(t.mutation(api.agents.place,{agentToken,assetId:built.id,x:3,z:3})).rejects.toThrow('own space');
    await expect(t.mutation(api.agents.place,{agentToken,assetId:built.id,x:29,z:3})).rejects.toThrow('own space');
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:3});
    expect(await everywhere()).toEqual([{id:itemId,type:built.type,rotation:2,x:23,z:3,owner:player.id}]);
    // The lobby preview never carries a space's pieces; the space's own subscription does.
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([]);
    const space=(await t.query(api.agents.map,{agentToken})).spaces[0].id;
    expect((await t.query(api.room.zoneFurniture,{token,zone:space})).map(i=>i.id)).toEqual([itemId]);
    await expect(t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:3})).rejects.toThrow('free');
    const status=await t.query(api.agents.status,{agentToken});
    expect(status.placed).toHaveLength(1);expect(status.assets[0].name).toBe('Boombox');
    const map=await t.query(api.agents.map,{agentToken});
    expect(map.spaces[0].tiles.find(c=>c.x===23&&c.z===3).free).toBe(false);expect(map.areas.main.tiles.find(c=>c.x===3&&c.z===3).free).toBe(true);expect(map.walls.length).toBeGreaterThan(0);
    await t.mutation(api.agents.remove,{agentToken,itemId});
    expect(await everywhere()).toEqual([]);
    await t.mutation(api.agents.deleteAsset,{agentToken,id:built.id});
    expect(await t.query(api.assets.list,{})).toEqual([]);
  });
  it('lets builders move only their own pieces from the room UI, and cuts agents off on revoke',async()=>{
    await admin();
    const {player,agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    // The builder's space bumped the room to revision 1.
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:1});
    const mine={id:'mine',type:built.type,rotation:2,x:23,z:3,owner:player.id};
    const revision=()=>t.query(api.room.roomState,{token}).then(r=>r.revision);
    await t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},mine],revision:await revision()});
    await expect(t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:2,z:2},mine],revision:await revision()})).rejects.toThrow('you built');
    await expect(t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},mine,{id:'theirs',type:'small_chair_armas',rotation:0,x:24,z:4,owner:player.id}],revision:await revision()})).rejects.toThrow('own pieces');
    await t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},{...mine,x:24,z:4}],revision:await revision()});
    expect((await everywhere()).find(i=>i.id==='mine').x).toBe(24);
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Castle'})})).rejects.toThrow('Category');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Wall'})})).rejects.toThrow('wallWidth');
    await t.mutation(api.agents.revoke,{token});
    await expect(t.query(api.agents.status,{agentToken})).rejects.toThrow('not attached');
  });
  it('lets a builder say which tile of a seat is sat on and how high',async()=>{
    await admin();const {player,agentToken,storageId}=await attach();
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Stool',seat:{x:0,z:0,height:20}})})).rejects.toThrow('Only seats');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Stool',category:'Seating',width:2,seat:{x:0,z:2,height:20}})})).rejects.toThrow('within the footprint');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Stool',category:'Seating',seat:{x:0,z:0,height:99}})})).rejects.toThrow('0 to 40');
    // A stool beside a counter, two tiles along the front: only the stool tile seats, 20 px up.
    const stool=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Stool and counter',category:'Seating',width:2,seat:{x:0,z:1,height:20}})});
    const entry=()=>t.query(api.assets.list,{}).then(list=>list.find(d=>d.id===stool.type));
    expect((await entry()).seat).toEqual({2:{cell:[0,1],direction:2,height:20,offset:[0,6]},4:{cell:[1,0],direction:4,height:20,offset:[0,6]}});
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:stool.id,x:25,z:5,rotation:2});
    await expect(t.mutation(api.room.move,{token,x:25,z:5,seatId:itemId})).rejects.toThrow('not available');
    await t.mutation(api.room.move,{token,x:25,z:6,seatId:itemId});
    expect((await t.query(api.room.me,{token})).seatId).toBe(itemId);
    // Adjusting later: the builder (or Grant) only, and null clears it back to the whole piece.
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});const other=(await t.mutation(api.agents.createKey,{token:otherToken,label:'Other'})).agentToken;
    await expect(t.mutation(api.agents.setSeat,{agentToken:other,assetId:stool.id,seat:{x:0,z:0,height:5}})).rejects.toThrow('not yours');
    expect((await t.mutation(api.agents.setSeat,{agentToken,assetId:stool.id,seat:{x:0,z:0,height:5}})).seat).toEqual({x:0,z:0,height:5});
    expect((await entry()).seat[4]).toEqual({cell:[0,0],direction:4,height:5,offset:[0,21]});
    // A pixel nudge for art drawn off the tile centre: sideways flips on the mirrored rotation.
    await expect(t.mutation(api.agents.setSeat,{agentToken,assetId:stool.id,seat:{x:0,z:0,height:5,offsetX:40}})).rejects.toThrow('-24 to 24');
    await t.mutation(api.agents.setSeat,{agentToken,assetId:stool.id,seat:{x:0,z:0,height:5,offsetX:6,offsetY:-3}});
    expect((await entry()).seat[2].offset).toEqual([6,18]);expect((await entry()).seat[4].offset).toEqual([-6,18]);
    expect((await t.query(api.agents.status,{agentToken})).assets.find(a=>a.id===stool.id).seat).toEqual({x:0,z:0,height:5,offsetX:6,offsetY:-3});
    await t.mutation(api.agents.setSeat,{agentToken,assetId:stool.id,seat:null});
    expect((await entry()).seat).toBeUndefined();
    await t.mutation(api.room.move,{token,x:25,z:5,seatId:itemId});
  });
  it('lets builders move, pick up, replace and delete their piece while preserving unseen inventory',async()=>{
    await admin();const {player,agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    const stored={id:'stored',type:'small_chair_armas',rotation:0,x:null,z:null};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[stored],revision:1,knowsAssets:true});
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:3});
    const save=async items=>t.mutation(api.room.setFurniture,{token,items,revision:(await t.query(api.room.roomState,{token})).revision,knowsAssets:true});
    const space=(await t.query(api.agents.map,{agentToken})).spaces[0].id,inSpace=()=>t.query(api.room.zoneFurniture,{token,zone:space});
    expect((await inSpace()).map(i=>i.id)).toEqual([itemId]);
    const piece=(await inSpace())[0];expect(piece.owner).toBe(player.id);
    await save([{...piece,x:24,z:4}]);
    expect((await inSpace())[0]).toMatchObject({id:itemId,x:24,z:4});
    await save([{...piece,x:null,z:null}]);
    expect(await t.query(api.room.inventory,{token})).toEqual([{...piece,x:null,z:null}]);
    expect((await t.query(api.room.roomState,{token})).furniture).toEqual([{...piece,x:null,z:null}]);
    expect((await t.query(api.room.state,{token})).room.furniture).toEqual([{...piece,x:null,z:null}]);
    await t.mutation(api.room.join,{token:otherToken,name:'Other builder',look});
    expect((await t.query(api.room.roomState,{token:otherToken})).furniture).toEqual([]);
    expect((await t.query(api.room.state,{token:otherToken})).room.furniture).toEqual([]);
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([]);
    await save([{...piece,x:25,z:5}]);
    await expect(save([{...piece,x:25,z:5},{...stored,x:2,z:2}])).rejects.toThrow('you built');
    // A list that never mentions the space leaves the piece there; deleting is an explicit change.
    await save([]);
    expect((await inSpace()).map(i=>i.id)).toEqual([itemId]);
    await t.mutation(api.room.editFurniture,{token,changes:[{id:itemId,removed:true}]});
    expect(await inSpace()).toEqual([]);
    expect((await t.query(api.room.roomState,{token})).furniture).toEqual([]);
    expect((await t.query(api.room.roomState,{token:adminToken})).furniture).toEqual([stored]);
    expect(await t.query(api.assets.list,{})).toHaveLength(1);
  });
  it('animates a built piece from frame cells and lets anyone switch it off and on',async()=>{
    await admin();const {player,agentToken,storageId}=await attach();
    const cells=[{x:0,y:0,width:48,height:60},{x:48,y:0,width:48,height:60}];
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46},frames:cells}]})})).rejects.toThrow('needs a frameDuration');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{switchable:true})})).rejects.toThrow('Only an animated');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{frameDuration:5000,parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46},frames:cells}]})})).rejects.toThrow('80 to 2000');
    const lamp=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Lamp',frameDuration:300,switchable:true,parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46},frames:cells}]})});
    const entry=(await t.query(api.assets.list,{})).find(d=>d.id===lamp.type);
    expect(entry).toMatchObject({frameDuration:300,switchable:true});expect(entry.parts[0]).toMatchObject({frames:cells,trimFrames:false});
    expect((await t.query(api.agents.status,{agentToken})).assets.find(a=>a.id===lamp.id)).toMatchObject({animated:true,frameMs:300,switchable:true});
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:lamp.id,x:23,z:3});
    // Anyone in the room can switch it, and the owner can still move it while it is off.
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});
    await t.mutation(api.room.setDeckPower,{token:otherToken,id:itemId,on:false});
    expect((await everywhere()).find(i=>i.id===itemId).on).toBe(false);
    const items=await everywhere();
    await t.mutation(api.room.setFurniture,{token,items:items.map(i=>i.id===itemId?{...i,x:24,z:4}:i),revision:(await t.query(api.room.roomState,{token})).revision,knowsAssets:true});
    expect((await everywhere()).find(i=>i.id===itemId)).toMatchObject({x:24,z:4,on:false});
    // A plain piece has no switch.
    const plain=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Box'})});
    const {itemId:box}=await t.mutation(api.agents.place,{agentToken,assetId:plain.id,x:25,z:5});
    await expect(t.mutation(api.room.setDeckPower,{token:otherToken,id:box,on:false})).rejects.toThrow('can be switched');
  });
  it('takes the pieces on a table off with it, and heals one left pointing at a vanished table',async()=>{
    await admin();const {player,agentToken,storageId}=await attach();
    const table=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Desk',category:'Tables'})});
    const lamp=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{name:'Lamp'})});
    const {itemId:desk}=await t.mutation(api.agents.place,{agentToken,assetId:table.id,x:23,z:3});
    const save=async(token_,items)=>t.mutation(api.room.setFurniture,{token:token_,items,revision:(await t.query(api.room.roomState,{token:token_})).revision,knowsAssets:true});
    const room=everywhere;
    const onDesk={id:'lamp',type:lamp.type,rotation:2,x:23,z:3,supportId:desk,owner:player.id};
    await save(token,[...await room(),onDesk]);
    // Removing the desk through the agent takes the lamp back to the inventory rather than stranding it.
    await t.mutation(api.agents.remove,{agentToken,itemId:desk});
    expect((await room()).find(i=>i.id==='lamp')).toEqual({id:'lamp',type:lamp.type,rotation:2,x:null,z:null,owner:player.id});
    // A piece stranded by an older path (its table gone) no longer blocks every save: it heals to the inventory.
    const space=(await t.query(api.agents.map,{agentToken})).spaces[0].id;
    await t.run(async ctx=>{for(const doc of await ctx.db.query('furniture').collect())await ctx.db.delete(doc._id);await ctx.db.insert('furniture',{id:'ghost',zone:space,type:lamp.type,rotation:2,x:24,z:4,supportId:'gone',owner:player.id});});
    const {itemId:again}=await t.mutation(api.agents.place,{agentToken,assetId:lamp.id,x:25,z:5});
    expect((await room()).map(i=>[i.id,i.x,i.supportId??null])).toEqual([['ghost',null,null],[again,25,null]]);
    // Someone else's piece on the table keeps it in the room.
    const {itemId:desk2}=await t.mutation(api.agents.place,{agentToken,assetId:table.id,x:23,z:3});
    await save(adminToken,[...await room(),{id:'theirs',type:'custom_logbook',rotation:2,x:23,z:3,supportId:desk2}]);
    await expect(t.mutation(api.agents.remove,{agentToken,itemId:desk2})).rejects.toThrow('Someone else');
  });
  it('keeps built pieces when an older client saves a list without them',async()=>{
    await admin();
    const {agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:built.id,x:23,z:3});
    const revision=()=>t.query(api.room.roomState,{token:adminToken}).then(r=>r.revision);
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:await revision()});
    expect((await everywhere()).map(i=>i.id).sort()).toEqual(['chair',itemId].sort());
    // A list that only covers the lobby never touches a space's pieces, whatever the client knows.
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:await revision(),knowsAssets:true});
    expect((await everywhere()).map(i=>i.id).sort()).toEqual(['chair',itemId].sort());
    // In the lobby, a client that knows about built pieces may remove them; one that does not keeps them.
    const stock={id:'lamp',type:built.type,rotation:2,x:2,z:2};
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},stock],revision:await revision(),knowsAssets:true});
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:await revision()});
    expect((await t.query(api.room.preview,{})).room.furniture.map(i=>i.id).sort()).toEqual(['chair','lamp']);
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:await revision(),knowsAssets:true});
    expect((await t.query(api.room.preview,{})).room.furniture.map(i=>i.id)).toEqual(['chair']);
  });
});

describe('room join phone alerts',()=>{
  const guest=()=>t.mutation(api.room.join,{token,name:'Visitor',look,pageOrigin:'https://chat.grantm.ac'});
  const entryLink='https://chat.grantm.ac/#grant=test-entry-only';
  beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('NTFY_TOPIC','test-room-alerts');vi.stubEnv('GRANT_ENTRY_URL',entryLink);vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true}));});
  afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
  const delivered=async()=>{await vi.advanceTimersByTimeAsync(0);await t.finishInProgressScheduledFunctions();};
  it('notifies once for a new guest, but not Grant, repeat joins or routine heartbeats',async()=>{
    await guest();await delivered();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://ntfy.sh/test-room-alerts',expect.objectContaining({body:'Visitor joined your room.',headers:expect.objectContaining({Click:entryLink})}));
    await guest();await admin();
    await t.mutation(api.room.heartbeat,{token,pageOrigin:'https://chat.grantm.ac',connectionId:'d'.repeat(64)});await delivered();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await t.query(api.room.state,{token}))).not.toContain('lastJoinAlertAt');
    expect(JSON.stringify(await t.query(api.room.state,{token}))).not.toContain(entryLink);
    expect(JSON.stringify(await t.query(api.room.preview,{}))).not.toContain(entryLink);
  });
  it('alerts for returning guests while suppressing rapid disconnect/reconnect duplicates',async()=>{
    const player=await guest();await delivered();
    await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0}));
    await t.mutation(api.room.heartbeat,{token,pageOrigin:'https://chat.grantm.ac',connectionId:'d'.repeat(64)});await delivered();
    expect(fetch).toHaveBeenCalledTimes(1);
    await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0,lastJoinAlertAt:Date.now()-61000}));
    await t.mutation(api.room.heartbeat,{token,pageOrigin:'https://chat.grantm.ac',connectionId:'e'.repeat(64)});await delivered();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not notify for localhost entry or returning local visitors',async()=>{
    const player=await t.mutation(api.room.join,{token,name:'LocalVisitor',look,pageOrigin:'http://localhost:5175'});await delivered();
    expect(fetch).not.toHaveBeenCalled();
    await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0}));
    await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64),pageOrigin:'http://127.0.0.1:5175'});await delivered();
    expect(fetch).not.toHaveBeenCalled();
    await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0}));
    await t.mutation(api.room.heartbeat,{token,connectionId:'e'.repeat(64),pageOrigin:'https://habbo-room.vercel.app'});await delivered();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles Unicode names and delivery failures without breaking entry',async()=>{
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
    try{
      fetch.mockResolvedValueOnce({ok:false,status:503});
      await guest();await delivered();
      expect((await t.query(api.room.me,{token})).name).toBe('Visitor');
      expect(warning).toHaveBeenCalledWith('Room join notification failed (503).');
      fetch.mockRejectedValueOnce(new Error('offline'));
      await t.action(internal.notifications.roomJoin,{name:'Zoë'});
      expect(fetch).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({body:'Zoë joined your room.'}));
      vi.stubEnv('NTFY_TOPIC','');fetch.mockClear();
      await t.action(internal.notifications.roomJoin,{name:'No notification'});
      expect(fetch).not.toHaveBeenCalled();
    }finally{warning.mockRestore();}
  });
});

describe('voice room access',()=>{
  beforeEach(()=>{
    vi.stubEnv('LIVEKIT_URL','wss://example.livekit.cloud');
    vi.stubEnv('LIVEKIT_API_KEY','test-livekit-key');
    vi.stubEnv('LIVEKIT_API_SECRET','test-secret-long-enough-for-a-signed-token');
  });
  it('issues a long-lived microphone-only token per tab for the authenticated player',async()=>{
    const player=await guest();
    const tagged=await t.action(api.voice.connect,{token,tab:'ab12cd'});
    const {TokenVerifier:Verifier}=await import('livekit-server-sdk');
    expect((await new Verifier(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET).verify(tagged.token)).sub).toBe(`${player.id}#ab12cd`);
    await expect(t.action(api.voice.connect,{token,tab:'bad tag!'})).rejects.toThrow();
    const result=await t.action(api.voice.connect,{token});
    const {TokenVerifier}=await import('livekit-server-sdk');
    const claims=await new TokenVerifier(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET).verify(result.token);
    expect(result.url).toBe('wss://example.livekit.cloud');
    expect(claims.sub).toBe(player.id);
    expect(claims.video).toMatchObject({room:'habbo-room',roomJoin:true,canPublish:true,canSubscribe:true,canPublishSources:['microphone'],canPublishData:false,canUpdateOwnMetadata:false});
    expect(claims.video.roomAdmin).not.toBe(true);
    expect(claims.exp-Math.floor(Date.now()/1000)).toBeLessThanOrEqual(12*3600);
    expect(claims.exp-Math.floor(Date.now()/1000)).toBeGreaterThan(11*3600);
    expect(JSON.stringify(result)).not.toContain(process.env.LIVEKIT_API_SECRET);
  });
  it('rejects visitors without a valid session and players who have left',async()=>{
    await expect(t.action(api.voice.connect,{token:otherToken})).rejects.toThrow('session');
    const player=await guest();await t.run(ctx=>ctx.db.patch(player.id,{online:false,lastSeen:0}));
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('Enter the room');
    await t.mutation(api.room.leave,{token});
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('session');
  });
  it('returns a useful message when voice has not been configured',async()=>{
    await guest();vi.stubEnv('LIVEKIT_API_SECRET','');
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('not ready yet');
  });
});
describe('agents asking for pictures',()=>{
  it('cannot use screenshot cleanup to delete another player’s artwork',async()=>{
    await guest();const owner=await t.mutation(api.room.join,{token:otherToken,name:'Artist',look});
    const agentToken=(await t.mutation(api.agents.createKey,{token,label:'Codex'})).agentToken;
    const png=await t.run(async ctx=>{
      const storageId=await ctx.storage.store(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}));
      await ctx.db.insert('assets',{ownerId:owner.id,ownerName:'Artist',name:'Protected artwork',category:'Decor',width:1,depth:1,surfaceHeight:0,spriteDensity:3,icon:storageId,parts:[{storageId,direction:2,width:30,height:30,reg:{x:15,y:30}}],views:[{direction:2,source:2,mirror:false}],createdAt:Date.now()});
      return storageId;
    });
    const id=await t.mutation(api.captures.request,{agentToken});await t.mutation(api.captures.take,{token,id});
    await expect(t.mutation(api.captures.finish,{token,id,storageId:png})).rejects.toThrow('room artwork');
    // Even a stale request written before the protection must leave the artwork intact.
    await t.run(ctx=>ctx.db.patch(id,{status:'done',storageId:png}));
    await t.mutation(api.captures.discard,{agentToken,id});
    expect(await t.run(ctx=>ctx.db.system.get(png))).not.toBeNull();
    const stale=await t.mutation(api.captures.request,{agentToken});
    await t.run(ctx=>ctx.db.patch(stale,{status:'done',storageId:png,requestedAt:Date.now()-600001}));
    await t.mutation(api.captures.request,{agentToken});
    expect(await t.run(ctx=>ctx.db.system.get(png))).not.toBeNull();
  });
  it('hands a request to an open tab, which uploads the picture for the agent',async()=>{
    await guest();const agentToken=(await t.mutation(api.agents.createKey,{token,label:'Codex'})).agentToken;
    expect(await t.query(api.captures.pending,{token})).toBeNull();
    const id=await t.mutation(api.captures.request,{agentToken,region:{x:21,z:0,width:8,depth:8}});
    expect(await t.query(api.captures.pending,{token})).toEqual({id,region:{x:21,z:0,width:8,depth:8}});
    expect((await t.query(api.captures.result,{agentToken,id})).status).toBe('pending');
    // The first tab to claim it renders; a second claim is refused and the request leaves the queue.
    expect(await t.mutation(api.captures.take,{token,id})).toBe(true);
    expect(await t.mutation(api.captures.take,{token,id})).toBe(false);
    expect(await t.query(api.captures.pending,{token})).toBeNull();
    const png=await t.run(ctx=>ctx.storage.store(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'})));
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});
    await expect(t.mutation(api.captures.finish,{token:otherToken,id,storageId:png})).rejects.toThrow('Another tab');
    await t.mutation(api.captures.finish,{token,id,storageId:png});
    const result=await t.query(api.captures.result,{agentToken,id});
    expect(result.status).toBe('done');expect(result.url).toMatch(/^http/);expect(result.takenBy).toBe('Visitor');
    // Only the asking agent sees it, and discarding removes the request and its picture.
    const other=(await t.mutation(api.agents.createKey,{token:otherToken,label:'Other'})).agentToken;
    await expect(t.query(api.captures.result,{agentToken:other,id})).rejects.toThrow('No such');
    await t.mutation(api.captures.discard,{agentToken,id});
    await expect(t.query(api.captures.result,{agentToken,id})).rejects.toThrow('No such');
    expect(await t.run(ctx=>ctx.db.system.get(png))).toBeNull();
  });
});
describe('agents adding spaces',()=>{
  const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
  const key=async(t_=token,label='Codex')=>(await t.mutation(api.agents.createKey,{token:t_,label})).agentToken;
  it('chains a named block of floor onto the back wall and reports it on the map',async()=>{
    const player=await guest(),agentToken=await key();
    const before=await t.query(api.agents.map,{agentToken});
    expect(before.spaces).toEqual([]);
    const added=await t.mutation(api.agents.addSpace,{agentToken,name:'  Reading   nook ',floor:'wood',floorColor:'#f7de9c'});
    expect(added).toMatchObject({name:'Reading nook',x:21,z:0,width:8,depth:8});expect(added.tiles).toHaveLength(64);
    const map=await t.query(api.agents.map,{agentToken});
    expect(map.spaces).toHaveLength(1);
    expect(map.spaces[0]).toMatchObject({id:added.spaceId,name:'Reading nook',owner:player.id,ownerName:'Visitor',mine:true,latest:true,x:21,z:0,width:8,depth:8,floor:'wood',floorColor:'#f7de9c'});
    expect(map.spaces[0].tiles.every(c=>c.free)).toBe(true);
    // The back wall continues behind the new space, so wall pieces can hang there.
    expect(map.walls.filter(w=>w.z===0&&w.x>=21&&w.x<29&&w.side==='right')).toHaveLength(8);
    const scene=await t.query(api.room.scene,{});
    expect(scene.spaces.map(s=>s.name)).toEqual(['Reading nook']);expect(scene.spaces[0]).not.toHaveProperty('x');
    // Walking onto the new floor works, and furniture can sit there.
    await t.mutation(api.room.move,{token,x:22,z:2});
    expect((await t.query(api.room.me,{token})).route.at(-1)).toEqual({x:22.5,z:2.5});
    await t.mutation(api.room.setFurniture,{token:(await admin(),adminToken),items:[{id:'chair',type:'small_chair_armas',rotation:0,x:23,z:3}],revision:(await t.query(api.room.roomState,{token})).revision});
    expect((await t.query(api.agents.map,{agentToken})).spaces[0].tiles.find(c=>c.x===23&&c.z===3).free).toBe(false);
    // The walkway along the front of the lounge and the space can be walked on but never built on.
    expect((await t.query(api.agents.map,{agentToken})).walkway.tiles).toHaveLength(16);
    await t.mutation(api.room.move,{token,x:25,z:8});
    expect((await t.query(api.room.me,{token})).route.at(-1)).toEqual({x:25.5,z:8.5});
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:23,z:3},{id:'stool',type:'small_chair_armas',rotation:0,x:25,z:8}],revision:(await t.query(api.room.roomState,{token})).revision})).rejects.toThrow('walkway');
  });
  it('validates the request and limits each player to one space',async()=>{
    await guest();const agentToken=await key();
    await expect(t.mutation(api.agents.addSpace,{agentToken,name:''})).rejects.toThrow('Name the space');
    await expect(t.mutation(api.agents.addSpace,{agentToken,name:'Lava',floor:'lava'})).rejects.toThrow('Floor must be');
    await expect(t.mutation(api.agents.addSpace,{agentToken,name:'Pink',floorColor:'pink'})).rejects.toThrow('Floor colour');
    const first=await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    expect(first).toMatchObject({x:21,z:0,width:8,depth:8});
    await expect(t.mutation(api.agents.addSpace,{agentToken,name:'Again'})).rejects.toThrow('up to 1 space');
    // Someone else's space joins on after the first; Grant is not capped.
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});
    const second=await t.mutation(api.agents.addSpace,{agentToken:await key(otherToken,'Other'),name:'Theirs'});
    expect(second).toMatchObject({x:29,z:0,width:8,depth:8});
    await admin();const adminAgent=await key(adminToken,'Grant');
    expect((await t.mutation(api.agents.addSpace,{agentToken:adminAgent,name:'One'})).x).toBe(37);
    expect((await t.mutation(api.agents.addSpace,{agentToken:adminAgent,name:'Two'})).x).toBe(45);
    expect((await t.query(api.agents.map,{agentToken})).spaces.map(s=>[s.name,s.mine,s.latest])).toEqual([['Mine',true,false],['Theirs',false,false],['One',false,false],['Two',false,true]]);
  });
  it('lets the owner restyle a space with colours, wallpaper and uploaded pictures',async()=>{
    await guest();const agentToken=await key();
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});const other=await key(otherToken,'Other');
    const mine=await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    const picture=await t.run(ctx=>ctx.storage.store(png));
    await expect(t.mutation(api.agents.styleSpace,{agentToken:other,spaceId:mine.spaceId,floorColor:'#123456'})).rejects.toThrow('not yours');
    await expect(t.mutation(api.agents.styleSpace,{agentToken:other,floorColor:'#123456'})).rejects.toThrow('Add a space first');
    await expect(t.mutation(api.agents.styleSpace,{agentToken,floorColor:'pink'})).rejects.toThrow('Floor colour');
    await expect(t.mutation(api.agents.styleSpace,{agentToken,wall:'lava'})).rejects.toThrow('Wall must be');
    await expect(t.mutation(api.agents.styleSpace,{agentToken,wallImage:picture,wallFit:'stretch'})).rejects.toThrow('Fit must be');
    await expect(t.mutation(api.agents.styleSpace,{agentToken,floorImage:'nope'})).rejects.toThrow('No upload');
    const styled=await t.mutation(api.agents.styleSpace,{agentToken,name:'Pit lane',floor:'tiles',floorColor:'#123456',wall:'stripes',wallColor:'#ABCDEF',floorImage:picture,wallImage:picture,wallFit:'cover'});
    expect(styled).toEqual({spaceId:mine.spaceId,name:'Pit lane',floor:'tiles',floorColor:'#123456',floorFit:'tile',floorImage:true,wall:'stripes',wallColor:'#abcdef',wallFit:'cover',wallImage:true});
    // Clients get the pictures as URLs, never the storage ids; agents see them as yes/no.
    const scene=await t.query(api.room.scene,{});
    expect(scene.spaces[0]).toMatchObject({name:'Pit lane',wall:'stripes',wallColor:'#abcdef',floorFit:'tile',wallFit:'cover'});
    expect(scene.spaces[0].floorImageUrl).toMatch(/^http/);expect(scene.spaces[0].wallImageUrl).toMatch(/^http/);expect(scene.spaces[0]).not.toHaveProperty('floorImage');
    expect((await t.query(api.agents.status,{agentToken})).spaces[0]).toMatchObject({name:'Pit lane',wallImage:true,floorImage:true});
    expect((await t.query(api.agents.map,{agentToken})).spaces[0]).toMatchObject({wall:'stripes',wallFit:'cover'});
    // Null clears a picture (and its fit) or the wall choice, which falls back to the room's.
    const cleared=await t.mutation(api.agents.styleSpace,{agentToken,floorImage:null,wall:null,wallColor:null});
    expect(cleared).toMatchObject({floorImage:false,floorFit:null,wall:null,wallColor:null,wallImage:true,wallFit:'cover'});
    expect((await t.query(api.room.scene,{})).spaces[0]).not.toHaveProperty('floorImageUrl');
    // Grant can restyle anyone's space.
    await admin();const adminAgent=await key(adminToken,'Grant');
    expect((await t.mutation(api.agents.styleSpace,{agentToken:adminAgent,spaceId:mine.spaceId,floorColor:'#000000'})).floorColor).toBe('#000000');
  });
  it('makes a space wider or narrower and slides the spaces after it along',async()=>{
    await guest();const agentToken=await key();
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});const other=await key(otherToken,'Other');
    const mine=await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    await t.mutation(api.agents.addSpace,{agentToken:other,name:'Theirs'});
    await expect(t.mutation(api.agents.resizeSpace,{agentToken:other,spaceId:mine.spaceId,width:4})).rejects.toThrow('not yours');
    await expect(t.mutation(api.agents.resizeSpace,{agentToken,width:3})).rejects.toThrow('4 to 16');
    // Friend's piece, and Friend, are on the space after mine; widening mine slides them along.
    const storageId=await t.run(ctx=>ctx.storage.store(png)),build=(agent,name)=>t.mutation(api.agents.createAsset,{agentToken:agent,name,category:'Decor',width:1,depth:1,spriteDensity:3,icon:storageId,parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:2,source:2,mirror:false}]});
    const theirBox=await build(other,'Box'),{itemId}=await t.mutation(api.agents.place,{agentToken:other,assetId:theirBox.id,x:30,z:2});
    await t.mutation(api.room.move,{token:otherToken,x:31,z:3});
    expect(await t.mutation(api.agents.resizeSpace,{agentToken,width:12})).toMatchObject({x:21,width:12,depth:8,moved:1});
    const map=await t.query(api.agents.map,{agentToken});
    expect(map.spaces.map(s=>[s.x,s.width])).toEqual([[21,12],[33,8]]);expect(map.walkway.tiles).toHaveLength(8+12+8);
    expect((await everywhere()).find(i=>i.id===itemId)).toMatchObject({x:34,z:2});
    expect((await t.query(api.room.me,{token:otherToken})).route.at(-1)).toEqual({x:35.5,z:3.5});
    // A poster hanging on the later space's back wall slides along with it and still hangs there.
    const poster=await t.mutation(api.agents.createAsset,{agentToken:other,name:'Poster',category:'Wall',width:1,depth:1,spriteDensity:3,wallWidth:32,icon:storageId,parts:[{storageId,direction:4,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:4,source:4,mirror:false}]});
    const {itemId:hung}=await t.mutation(api.agents.place,{agentToken:other,assetId:poster.id,x:35,z:0,rotation:4,u:.5,height:60});
    expect((await everywhere()).find(i=>i.id===hung)).toMatchObject({x:35,z:0,rotation:4,u:.5,height:60});
    // Narrowing needs the dropped columns clear of furniture and people.
    const myBox=await build(agentToken,'Crate'),{itemId:crate}=await t.mutation(api.agents.place,{agentToken,assetId:myBox.id,x:31,z:2});
    await expect(t.mutation(api.agents.resizeSpace,{agentToken,width:8})).rejects.toThrow('Clear the furniture');
    await t.mutation(api.agents.remove,{agentToken,itemId:crate});
    await t.mutation(api.room.move,{token,x:31,z:5});
    await expect(t.mutation(api.agents.resizeSpace,{agentToken,width:8})).rejects.toThrow('Visitor is standing');
    await t.mutation(api.room.move,{token,x:22,z:5});
    expect(await t.mutation(api.agents.resizeSpace,{agentToken,width:8})).toMatchObject({width:8,moved:1});
    expect((await t.query(api.agents.map,{agentToken})).spaces.map(s=>[s.x,s.width])).toEqual([[21,8],[29,8]]);
    expect((await everywhere()).find(i=>i.id===itemId)).toMatchObject({x:30,z:2});
    expect((await t.query(api.room.me,{token:otherToken})).route.at(-1)).toEqual({x:31.5,z:3.5});
    expect((await everywhere()).find(i=>i.id===hung)).toMatchObject({x:31,z:0,rotation:4});
    // The room still validates with the poster in its new place: another placement goes through.
    await t.mutation(api.agents.place,{agentToken:other,assetId:theirBox.id,x:33,z:3});
  });
  it('removes only the latest space, only when it is empty, by its owner or Grant',async()=>{
    const player=await guest(),agentToken=await key();
    await t.mutation(api.room.join,{token:otherToken,name:'Friend',look});const other=await key(otherToken,'Other');
    const mine=await t.mutation(api.agents.addSpace,{agentToken,name:'Mine'});
    const theirs=await t.mutation(api.agents.addSpace,{agentToken:other,name:'Theirs'});
    await expect(t.mutation(api.agents.removeSpace,{agentToken,spaceId:'nope'})).rejects.toThrow('No space');
    await expect(t.mutation(api.agents.removeSpace,{agentToken,spaceId:theirs.spaceId})).rejects.toThrow('not yours');
    await expect(t.mutation(api.agents.removeSpace,{agentToken,spaceId:mine.spaceId})).rejects.toThrow('latest');
    // Furniture or a player on the space blocks removal.
    const storageId=await t.run(ctx=>ctx.storage.store(png));
    const built=await t.mutation(api.agents.createAsset,{agentToken:other,name:'Box',category:'Decor',width:1,depth:1,spriteDensity:3,icon:storageId,parts:[{storageId,direction:2,width:48,height:60,reg:{x:-8,y:46}}],views:[{direction:2,source:2,mirror:false}]});
    const {itemId}=await t.mutation(api.agents.place,{agentToken:other,assetId:built.id,x:theirs.x,z:theirs.z});
    await expect(t.mutation(api.agents.removeSpace,{agentToken:other,spaceId:theirs.spaceId})).rejects.toThrow('Clear the furniture');
    await t.mutation(api.agents.remove,{agentToken:other,itemId});
    await t.mutation(api.room.move,{token,x:theirs.x+1,z:theirs.z+1});
    await expect(t.mutation(api.agents.removeSpace,{agentToken:other,spaceId:theirs.spaceId})).rejects.toThrow('Visitor is standing on it');
    await t.mutation(api.room.move,{token,x:0,z:0});
    await t.mutation(api.agents.removeSpace,{agentToken:other,spaceId:theirs.spaceId});
    expect((await t.query(api.agents.map,{agentToken})).spaces.map(s=>s.name)).toEqual(['Mine']);
    // Grant can clear anyone's latest space.
    await admin();
    await t.mutation(api.agents.removeSpace,{agentToken:await key(adminToken,'Grant'),spaceId:mine.spaceId});
    expect((await t.query(api.room.scene,{})).spaces).toEqual([]);
    expect(player.id).toBeTruthy();
  });
});

describe('zones',()=>{
  const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
  const friend=()=>t.mutation(api.room.join,{token:otherToken,name:'Friend',look});
  async function spaceFor(token_,name){
    const {agentToken}=await t.mutation(api.agents.createKey,{token:token_,label:name});
    const space=await t.mutation(api.agents.addSpace,{agentToken,name});
    return {agentToken,...space};
  }
  it('scopes presence, chat and voice to the zone a player stands in',async()=>{
    const me=await guest();const other=await friend();
    const space=await spaceFor(token,'Mine');
    expect((await t.query(api.room.presence,{zone:'main'})).players.map(p=>p.id).sort()).toEqual([me.id,other.id].sort());
    expect((await t.query(api.room.presence,{zone:space.spaceId})).players).toEqual([]);
    const walk=await t.mutation(api.room.move,{token,x:space.x+2,z:3});
    expect(walk.zone).toBe(space.spaceId);
    expect((await t.query(api.room.me,{token})).zone).toBe(space.spaceId);
    expect((await t.query(api.room.presence,{zone:'main'})).players.map(p=>p.id)).toEqual([other.id]);
    expect((await t.query(api.room.presence,{zone:space.spaceId})).players.map(p=>p.id)).toEqual([me.id]);
    // Tabs from before zones ask without a zone and get the lobby, appearances included.
    expect((await t.query(api.room.presence,{})).players.map(p=>[p.id,!!p.look])).toEqual([[other.id,true]]);
    await t.mutation(api.room.chat,{token,body:'Over here',mode:'Say'});
    await t.mutation(api.room.chat,{token:otherToken,body:'In the lobby',mode:'Say'});
    expect((await t.query(api.room.chatFeed,{token,zone:space.spaceId})).map(m=>m.body)).toEqual(['Over here']);
    expect((await t.query(api.room.chatFeed,{token,zone:'main'})).map(m=>m.body)).toEqual(['In the lobby']);
    expect((await t.query(api.room.chatFeed,{token})).map(m=>m.body)).toEqual(['Over here']);
    expect((await t.query(api.room.chatFeed,{token:otherToken})).map(m=>m.body)).toEqual(['In the lobby']);
    await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64)});
    expect(await t.query(internal.room.voiceIdentity,{token})).toEqual({playerId:me.id,zone:space.spaceId});
    // Walking back out returns the player to the lobby's crowd.
    await t.mutation(api.room.move,{token,x:5,z:5});
    expect((await t.query(api.room.presence,{zone:space.spaceId})).players).toEqual([]);
    expect((await t.query(api.room.presence,{zone:'main'})).players.map(p=>p.id).sort()).toEqual([me.id,other.id].sort());
  });
  it('bounds every zone by the same cap, the lobby included',async()=>{
    await guest();
    const space=await spaceFor(token,'Mine');
    const crowd=zone=>t.run(async ctx=>{const base=await ctx.db.query('players').first();for(let i=0;i<60;i++)await ctx.db.insert('players',{...Object.fromEntries(Object.entries(base).filter(([k])=>!k.startsWith('_'))),name:`Extra ${i}`,nameKey:`extra ${i}`,zone,online:true,lastSeen:Date.now()});});
    await crowd(space.spaceId);
    await expect(t.mutation(api.room.move,{token,x:space.x+2,z:3})).rejects.toThrow('full');
    expect((await t.query(api.room.presence,{zone:space.spaceId})).players.length).toBeLessThanOrEqual(61);
    await crowd('main');
    await expect(friend()).rejects.toThrow('full');
    // Someone already in the lobby can still move about in it.
    await t.mutation(api.room.move,{token,x:2,z:2});
  });
  it('sends movement without appearances, which travel once per version',async()=>{
    const me=await guest();
    const seen=(await t.query(api.room.presence,{zone:'main'})).players[0];
    expect(seen.look).toBeUndefined();expect(seen.lookVersion).toBe(0);
    expect(await t.query(api.room.look,{id:me.id})).toEqual({look,lookVersion:0});
    const next={...look,top:{model:'1',color:'#55677e'}};
    await t.mutation(api.room.appearance,{token,look:next});
    expect((await t.query(api.room.presence,{zone:'main'})).players[0].lookVersion).toBe(1);
    expect(await t.query(api.room.look,{id:me.id})).toEqual({look:next,lookVersion:1});
  });
  it('keeps the lobby switches apart from the map',async()=>{
    await guest();
    const map=await t.query(api.room.roomMap,{token});
    expect(Object.keys(map).sort()).toEqual(['options','revision','spaces','stickies']);
    await t.mutation(api.room.setDanceFloor,{token,on:false});
    expect(await t.query(api.room.signals,{})).toEqual({danceFloorOn:false,fridge:null});
    expect(await t.query(api.room.roomMap,{token})).toEqual(map);
    expect((await t.query(api.room.preview,{})).room.danceFloorOn).toBe(false);
  });
  it('checks furniture one zone at a time and never lets a piece straddle two spaces',async()=>{
    await admin();await guest();await friend();
    const first=await spaceFor(token,'Mine'),second=await spaceFor(otherToken,'Theirs');
    const edit=changes=>t.mutation(api.room.editFurniture,{token:adminToken,changes});
    const car={id:'car',type:'custom_porsche',rotation:0,x:first.x+first.width-2,z:2};
    await expect(edit([car])).rejects.toThrow('straddle two spaces');
    await edit([{...car,x:first.x+1}]);
    expect((await t.query(api.room.zoneFurniture,{token,zone:first.spaceId})).map(i=>i.id)).toEqual(['car']);
    expect(await t.query(api.room.zoneFurniture,{token,zone:second.spaceId})).toEqual([]);
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([]);
    // A chair in the other space may stand on the same local tile: zones are checked apart.
    await edit([{id:'chair',type:'small_chair_armas',rotation:0,x:second.x+1,z:2}]);
    await expect(edit([{id:'chair2',type:'small_chair_armas',rotation:0,x:first.x+1,z:2}])).rejects.toThrow('free floor');
    await expect(edit([{id:'chair',type:'small_chair_armas',rotation:0,x:second.x+1,z:2,extra:1}])).rejects.toThrow('Invalid furniture');
    await expect(edit([{id:'chair',removed:true,x:1}])).rejects.toThrow('Invalid furniture');
    await edit([{id:'chair',removed:true}]);
    expect(await t.query(api.room.zoneFurniture,{token,zone:second.spaceId})).toEqual([]);
    expect((await t.query(api.room.zoneFurniture,{token,zone:first.spaceId})).map(i=>i.id)).toEqual(['car']);
  });
  it('moves a room from before zones into the furniture table once',async()=>{
    const me=await guest();
    const space=await spaceFor(token,'Mine');
    await t.mutation(api.room.move,{token,x:space.x+1,z:1});
    await t.run(async ctx=>{
      const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
      await ctx.db.patch(room._id,{furniture:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},{id:'box',type:'small_chair_armas',rotation:0,x:space.x+3,z:3,owner:me.id},{id:'held',type:'small_chair_armas',rotation:0,x:null,z:null}],danceFloorOn:false});
      await ctx.db.patch(me.id,{zone:undefined});
      for(const s of await ctx.db.query('signals').collect())await ctx.db.delete(s._id);
    });
    expect(await t.mutation(internal.migrate.furniture,{})).toEqual({moved:3,players:1});
    expect((await t.run(ctx=>ctx.db.query('furniture').collect())).map(d=>[d.id,d.zone]).sort()).toEqual([['box',space.spaceId],['chair','main'],['held','inventory']]);
    expect((await t.run(ctx=>ctx.db.query('rooms').first())).furniture).toBeUndefined();
    expect(await t.query(api.room.signals,{})).toEqual({danceFloorOn:false,fridge:null});
    expect((await t.query(api.room.me,{token})).zone).toBe(space.spaceId);
    expect(await t.mutation(internal.migrate.furniture,{})).toEqual({moved:0,players:0});
  });
});
