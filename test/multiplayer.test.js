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
  it('lets visitors switch floor and DJ power without giving them furniture editing access',async()=>{
    await admin();await guest();
    expect((await t.query(api.room.preview,{})).room.danceFloorOn).toBe(true);
    await expect(t.mutation(api.room.setDanceFloor,{token:otherToken,on:false})).rejects.toThrow();
    await t.mutation(api.room.setDanceFloor,{token,on:false});
    expect((await t.query(api.room.state,{token})).room.danceFloorOn).toBe(false);
    expect((await t.query(api.room.preview,{})).room.danceFloorOn).toBe(false);
    const items=[{id:'decks',type:'custom_dj_decks',rotation:2,x:0,z:0,on:false}];
    await t.mutation(api.room.setFurniture,{token:adminToken,items,revision:0});
    expect((await t.query(api.room.state,{token})).room.furniture[0].on).toBe(false);
    await expect(t.mutation(api.room.setFurniture,{token,items:[{...items[0],on:true}],revision:1})).rejects.toThrow('Only Grant');
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
      expect((await t.query(api.room.state,{token:adminToken})).room.furniture).toEqual(items);
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
    for(const [fn,args] of [[api.room.setOptions,{options:DEFAULT_ROOM,revision:0}],[api.room.setFurniture,{items:[],revision:0}],[api.room.seed,{options:DEFAULT_ROOM,items:[]}]])await expect(t.mutation(fn,{token,...args})).rejects.toThrow('Only Grant');
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
    expect((await t.query(api.room.state,{token})).room.options).toEqual(options);
    await expect(t.mutation(api.room.setOptions,{token:adminToken,options:DEFAULT_ROOM,revision:0})).rejects.toThrow('room changed');
    await t.mutation(api.room.seed,{token:adminToken,options:DEFAULT_ROOM,items:[]});
    expect((await t.query(api.room.state,{token})).room.options.window).toBe(false);
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
    expect((await t.query(api.room.state,{token})).room.furniture).toEqual([seat]);
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
    expect((await t.query(api.room.state,{token})).room.furniture).toEqual([table,duck]);
    await expect(t.mutation(api.room.setFurniture,{token,items:[table,duck],revision:1})).rejects.toThrow('Only Grant');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[duck],revision:1})).rejects.toThrow('tabletop');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,duck,{...duck,id:'other'}],revision:1})).rejects.toThrow('tabletop');
    await expect(t.mutation(api.room.setFurniture,{token:adminToken,items:[table,{...duck,height:99}],revision:1})).rejects.toThrow('Invalid furniture');
  });
  it('accepts both fridge facings',async()=>{
    await admin();
    for(const [revision,rotation] of [2,4].entries()){
      await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'fridge',type:'fridge',rotation,x:4,z:4}],revision});
      expect((await t.query(api.room.state,{token:adminToken})).room.furniture[0].rotation).toBe(rotation);
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
    expect((await t.query(api.room.state,{token})).room.stickies[0]).toEqual(note);
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
  it('issues a short-lived microphone-only token for the authenticated player',async()=>{
    const player=await guest();
    const result=await t.action(api.voice.connect,{token});
    const {TokenVerifier}=await import('livekit-server-sdk');
    const claims=await new TokenVerifier(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET).verify(result.token);
    expect(result.url).toBe('wss://example.livekit.cloud');
    expect(claims.sub).toBe(player.id);
    expect(claims.video).toMatchObject({room:'habbo-room',roomJoin:true,canPublish:true,canSubscribe:true,canPublishSources:['microphone'],canPublishData:false,canUpdateOwnMetadata:false});
    expect(claims.video.roomAdmin).not.toBe(true);
    expect(claims.exp-Math.floor(Date.now()/1000)).toBeLessThanOrEqual(300);
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
