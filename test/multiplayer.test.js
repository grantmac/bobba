import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {DEFAULT_ROOM,validateLook} from '../convex/lib/rules.js';
import appearanceCatalog from '../public/assets/appearance/catalog.json';
import {furniture} from '../convex/lib/catalog.js';
const modules=import.meta.glob('../convex/**/*.js');
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const token='a'.repeat(64),adminToken='b'.repeat(64),otherToken='c'.repeat(64),secret='test-entry-only';
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
let t;
beforeEach(async()=>{t=convexTest(schema,modules);vi.stubEnv('GRANT_ENTRY_HASH',await digest(secret));});
afterEach(()=>vi.unstubAllEnvs());
const guest=()=>t.mutation(api.room.join,{token,name:'Visitor',look});
const admin=()=>t.mutation(api.room.join,{token:adminToken,name:'Grant',look,entryCode:secret});
describe('room access and persistence',()=>{
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
    await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0}));
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
    for(const id of ['decks','chair'])await expect(t.mutation(api.room.setDeckPower,{token,id,on:true})).rejects.toThrow('Select decks');
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
      expect(taken.name).toBe('Visitor');expect(taken.look).toEqual(fresh);
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
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[duck],revision:1})).rejects.toThrow('tabletop');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,duck,{...duck,id:'other'}],revision:1})).rejects.toThrow('tabletop');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,{...duck,height:99}],revision:1})).rejects.toThrow('Invalid furniture');
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
  it('ignores an old timeout after a heartbeat and expires a crashed connection',async()=>{
    await guest();await admin();const connectionId='d'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId});
    const connection=await t.run(ctx=>ctx.db.query('connections').first());
    await t.mutation(internal.room.expireConnection,{connectionId,seenAt:connection.lastSeen-1});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(true);
    await t.mutation(internal.room.expireConnection,{connectionId,seenAt:connection.lastSeen});
    expect((await t.query(api.room.state,{token:adminToken})).players.some(p=>p.name==='Visitor')).toBe(false);
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
    await t.mutation(api.room.setOptions,{token:adminToken,options:{...DEFAULT_ROOM,shape:'model_f'},revision:1});
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
  async function attach(){
    const player=await guest();
    const {agentToken}=await t.mutation(api.agents.createKey,{token,label:'Codex'});
    const storageId=await t.run(ctx=>ctx.storage.store(png));
    return {player,agentToken,storageId};
  }
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
    const {player,agentToken,storageId}=await attach();
    expect((await t.query(api.agents.attached,{token})).map(a=>a.label)).toEqual(['Codex']);
    await expect(t.query(api.agents.status,{agentToken:'f'.repeat(64)})).rejects.toThrow('not attached');
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    const listed=await t.query(api.assets.list,{});
    expect(listed).toHaveLength(1);expect(listed[0]).toMatchObject({id:built.type,name:'Boombox',owner:player.id,ownerName:'Visitor',spriteDensity:3});
    expect(listed[0].parts[0].file).toMatch(/^http/);expect(listed[0].icon).toMatch(/^http/);
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:built.id,x:3,z:3});
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([{id:itemId,type:built.type,rotation:2,x:3,z:3,owner:player.id}]);
    await expect(t.mutation(api.agents.place,{agentToken,assetId:built.id,x:3,z:3})).rejects.toThrow('free');
    const status=await t.query(api.agents.status,{agentToken});
    expect(status.placed).toHaveLength(1);expect(status.assets[0].name).toBe('Boombox');
    const map=await t.query(api.agents.map,{agentToken});
    expect(map.areas.main.tiles.find(c=>c.x===3&&c.z===3).free).toBe(false);expect(map.walls.length).toBeGreaterThan(0);
    await t.mutation(api.agents.remove,{agentToken,itemId});
    expect((await t.query(api.room.preview,{})).room.furniture).toEqual([]);
    await t.mutation(api.agents.deleteAsset,{agentToken,id:built.id});
    expect(await t.query(api.assets.list,{})).toEqual([]);
  });
  it('lets builders move only their own pieces from the room UI, and cuts agents off on revoke',async()=>{
    await admin();
    const {player,agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:0});
    const mine={id:'mine',type:built.type,rotation:2,x:3,z:3,owner:player.id};
    const revision=()=>t.query(api.room.roomState,{token}).then(r=>r.revision);
    await t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},mine],revision:await revision()});
    await expect(t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:2,z:2},mine],revision:await revision()})).rejects.toThrow('you built');
    await expect(t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},mine,{id:'theirs',type:'small_chair_armas',rotation:0,x:4,z:4,owner:player.id}],revision:await revision()})).rejects.toThrow('own pieces');
    await t.mutation(api.room.setFurniture,{token,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1},{...mine,x:4,z:4}],revision:await revision()});
    expect((await t.query(api.room.preview,{})).room.furniture.find(i=>i.id==='mine').x).toBe(4);
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Castle'})})).rejects.toThrow('Category');
    await expect(t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId,{category:'Wall'})})).rejects.toThrow('wallWidth');
    await t.mutation(api.agents.revoke,{token});
    await expect(t.query(api.agents.status,{agentToken})).rejects.toThrow('not attached');
  });
  it('keeps built pieces when an older client saves a list without them',async()=>{
    await admin();
    const {agentToken,storageId}=await attach();
    const built=await t.mutation(api.agents.createAsset,{agentToken,...await spec(storageId)});
    const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:built.id,x:3,z:3});
    const revision=()=>t.query(api.room.roomState,{token:adminToken}).then(r=>r.revision);
    await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'chair',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:await revision()});
    expect((await t.query(api.room.preview,{})).room.furniture.map(i=>i.id).sort()).toEqual(['chair',itemId].sort());
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
    await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0}));
    await t.mutation(api.room.heartbeat,{token,pageOrigin:'https://chat.grantm.ac',connectionId:'d'.repeat(64)});await delivered();
    expect(fetch).toHaveBeenCalledTimes(1);
    await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0,lastJoinAlertAt:Date.now()-61000}));
    await t.mutation(api.room.heartbeat,{token,pageOrigin:'https://chat.grantm.ac',connectionId:'e'.repeat(64)});await delivered();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not notify for localhost entry or returning local visitors',async()=>{
    const player=await t.mutation(api.room.join,{token,name:'LocalVisitor',look,pageOrigin:'http://localhost:5175'});await delivered();
    expect(fetch).not.toHaveBeenCalled();
    await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0}));
    await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64),pageOrigin:'http://127.0.0.1:5175'});await delivered();
    expect(fetch).not.toHaveBeenCalled();
    await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0}));
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
    const player=await guest();await t.run(ctx=>ctx.db.patch(player.id,{lastSeen:0}));
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('Enter the room');
    await t.mutation(api.room.leave,{token});
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('session');
  });
  it('returns a useful message when voice has not been configured',async()=>{
    await guest();vi.stubEnv('LIVEKIT_API_SECRET','');
    await expect(t.action(api.voice.connect,{token})).rejects.toThrow('not ready yet');
  });
});
