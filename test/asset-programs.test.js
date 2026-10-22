import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {validateProgram,programState,programVisual,programHost} from '../shared/asset-program.js';
import {createAssetPrograms} from '../src/asset-program-runtime.js';
import {spinningChairProgram} from '../shared/program-examples.js';
import {drawProgramDisplay} from '../src/program-display.js';
import beerStack from '../tools/programs/crowd-beer-stack.js';
const modules=import.meta.glob('../convex/**/*.js');
const token='a'.repeat(64),otherToken='b'.repeat(64);
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
let t;
beforeEach(()=>{t=convexTest(schema,modules);});
afterEach(()=>vi.restoreAllMocks());
async function setup(assetSpec={}){
  const player=await t.mutation(api.room.join,{token,name:'Builder',look});
  const {agentToken}=await t.mutation(api.agents.createKey,{token,label:'Test'});
  await t.mutation(api.agents.addSpace,{agentToken,name:'Workshop'});
  const storageId=await t.run(ctx=>ctx.storage.store(new Blob(['sprite'])));
  const asset=await t.mutation(api.agents.createAsset,{agentToken,name:'Chair',category:'Seating',width:1,depth:1,spriteDensity:1,icon:storageId,parts:[{storageId,direction:2,width:32,height:48,reg:{x:16,y:40}}],views:[0,2,4,6].map(direction=>({direction,source:2,mirror:false})),...assetSpec});
  const {itemId}=await t.mutation(api.agents.place,{agentToken,assetId:asset.id,x:23,z:3});
  const set=extra=>t.mutation(api.programs.set,{agentToken,assetId:asset.id,source:spinningChairProgram,...extra});
  return {player,agentToken,asset,itemId,set};
}
describe('saved asset programs',()=>{
  it('lets a seated player walk out of a custom car after starting its program',async()=>{
    const {player,itemId,set}=await setup({name:'Car',width:3,depth:3,seat:{x:1,z:1,height:10}});
    await set({});await t.mutation(api.room.setDeckPower,{token,id:itemId,on:false});
    const ride=await t.mutation(api.room.move,{token,x:24,z:4,seatId:itemId});
    await t.run(ctx=>ctx.db.patch(player.id,{startedAt:ride.startedAt-30000}));
    await t.mutation(api.room.setDeckPower,{token,id:itemId,on:true});
    const walk=await t.mutation(api.room.move,{token,x:26,z:4});
    expect(walk.seatId).toBeNull();
    expect(walk.route).toEqual([{x:24.5,z:4.5},{x:25.5,z:4.5},{x:26.5,z:4.5}]);
    expect((await t.query(api.room.me,{token})).seatId).toBeNull();
  });
  it('lets the MCP define visible labels live without resetting program state',async()=>{
    const {agentToken,asset,itemId,set}=await setup();await set({});
    expect((await t.query(api.assets.list,{}))[0].controls).toEqual({use:null,power:null});
    await t.mutation(api.programs.interact,{token,itemId});
    const before=await t.query(api.programs.list,{});
    const controls={use:' Drive ',power:{onLabel:'Start engine',offLabel:'Stop engine'}};
    await t.mutation(api.assetControls.set,{agentToken,assetId:asset.id,controls});
    const expected={...controls,use:'Drive'};
    expect((await t.query(api.assets.list,{}))[0].controls).toEqual(expected);
    expect((await t.query(api.agents.status,{agentToken})).assets[0].controls).toEqual(expected);
    expect(await t.query(api.programs.list,{})).toEqual(before);
    expect((await t.query(api.programs.get,{agentToken,assetId:asset.id})).revision).toBe(1);
    await t.mutation(api.assetControls.set,{agentToken,assetId:asset.id,controls:{use:null,power:null}});
    expect((await t.query(api.assets.list,{}))[0].controls).toEqual({use:null,power:null});
  });
  it('validates action capabilities, labels, and control ownership',async()=>{
    const {agentToken,asset,set}=await setup();
    const update=controls=>t.mutation(api.assetControls.set,{agentToken,assetId:asset.id,controls});
    await expect(update({use:'Drive',power:null})).rejects.toThrow('Attach a program');
    await expect(update({use:null,power:{onLabel:'Start',offLabel:'Stop'}})).rejects.toThrow('needs a program');
    await set({});
    for(const use of ['', '  ', 'x'.repeat(25), 'Go\nnow'])await expect(update({use,power:null})).rejects.toThrow('labels');
    await expect(update({use:null,power:{onLabel:'Start',offLabel:''}})).rejects.toThrow('labels');
    await t.mutation(api.room.join,{token:otherToken,name:'Other',look});
    const other=await t.mutation(api.agents.createKey,{token:otherToken,label:'Test'});
    await expect(t.mutation(api.assetControls.set,{agentToken:other.agentToken,assetId:asset.id,controls:{use:null,power:null}})).rejects.toThrow('not yours');
  });
  it('publishes code live, protects ownership and stale edits, and removes power cleanly',async()=>{
    const {agentToken,asset,itemId,set}=await setup();
    await set({initialState:{count:0},expectedRevision:0});
    const entry=(await t.query(api.assets.list,{}))[0];
    expect(entry.program).toMatchObject({source:spinningChairProgram,revision:1,initialState:{count:0}});expect(entry.switchable).toBe(true);
    expect((await t.query(api.programs.get,{agentToken,assetId:asset.id})).revision).toBe(1);
    await expect(set({expectedRevision:0})).rejects.toThrow('changed');
    await t.mutation(api.room.join,{token:otherToken,name:'Other',look});
    const other=await t.mutation(api.agents.createKey,{token:otherToken,label:'Test'});
    await expect(t.mutation(api.programs.set,{agentToken:other.agentToken,assetId:asset.id,source:null})).rejects.toThrow('not yours');
    await t.mutation(api.room.setDeckPower,{token,id:itemId,on:false});
    await set({source:null});
    expect((await t.query(api.assets.list,{}))[0].program).toBeUndefined();
    const copy=await t.run(ctx=>ctx.db.query('furniture').withIndex('by_item',q=>q.eq('id',itemId)).unique());expect(copy.on).toBeUndefined();
  });
  it('persists per-copy state with host, version, rate and compare-and-swap checks',async()=>{
    const {agentToken,asset,itemId,set}=await setup();await set({initialState:{count:0}});
    const second=await t.mutation(api.agents.place,{agentToken,assetId:asset.id,x:25,z:3});
    const save=extra=>t.mutation(api.programs.save,{token,itemId,version:1,revision:0,state:{count:1},...extra});
    await expect(save({token:'c'.repeat(64)})).rejects.toThrow('session');
    expect(await save()).toEqual({revision:1});
    await expect(save()).rejects.toThrow('state changed');
    await expect(save({revision:1})).rejects.toThrow('once per second');
    expect((await t.query(api.programs.list,{}))[0].state).toEqual({count:1});
    await save({itemId:second.itemId,state:null});
    const states=await t.query(api.programs.list,{});
    expect(states.find(row=>row.itemId===second.itemId).state).toBeNull();expect(states.find(row=>row.itemId===itemId).state).toEqual({count:1});
    await set({initialState:{count:10}});
    await expect(save({version:1,revision:1})).rejects.toThrow('program changed');
    expect(await t.query(api.programs.list,{})).toEqual([]);
    expect((await t.query(api.assets.list,{}))[0].program.initialState).toEqual({count:10});
    expect(asset.id).toBeTruthy();
  });
  it('elects a human host and rejects writes from other viewers',async()=>{
    const {player,itemId,set}=await setup();await set({});
    const other=await t.mutation(api.room.join,{token:otherToken,name:'Other',look});
    const host=programHost([player,other]),hostToken=host===player.id?token:otherToken,guestToken=host===player.id?otherToken:token;
    await expect(t.mutation(api.programs.save,{token:guestToken,itemId,version:1,revision:0,state:{}})).rejects.toThrow('hosting');
    await t.mutation(api.programs.save,{token:hostToken,itemId,version:1,revision:0,state:{ok:true}});
    await t.run(ctx=>ctx.db.patch(host,{online:false}));
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+1100);
    await t.mutation(api.programs.save,{token:guestToken,itemId,version:1,revision:1,state:{handoff:true}});
    expect((await t.query(api.programs.list,{}))[0].state).toEqual({handoff:true});
  });
  it('shares bounded interactions and cleans program records on asset deletion',async()=>{
    const {agentToken,asset,itemId,set}=await setup();await set({});
    expect(await t.mutation(api.programs.interact,{token,itemId})).toEqual({serial:1});
    await expect(t.mutation(api.programs.interact,{token,itemId})).rejects.toThrow('wait');
    const row=(await t.query(api.programs.list,{}))[0];expect(row.events[0]).toMatchObject({serial:1});
    await t.mutation(api.agents.remove,{agentToken,itemId});
    expect(await t.query(api.programs.list,{})).toEqual([]);
    await expect(t.mutation(api.programs.interact,{token,itemId})).rejects.toThrow('not in the room');
    await t.mutation(api.agents.deleteAsset,{agentToken,id:asset.id});
    expect(await t.run(ctx=>ctx.db.query('programInstances').collect())).toEqual([]);
  });
});
describe('runtime boundary',()=>{
  it('grows and shrinks the beer stack at crowd thresholds without shared state writes',()=>{
    let tick;const api={room:{people:null},on:(event,fn)=>{expect(event).toBe('tick');tick=fn;},setVisual:vi.fn()};
    beerStack(api);
    for(const [people,frame] of [[null,0],[0,0],[1,0],[2,1],[3,1],[4,2],[6,2],[7,3],[100,3],[2,1],[0,0]]){
      api.room.people=people;tick();expect(api.setVisual).toHaveBeenLastCalledWith({frame,animation:false});
    }
  });
  it('accepts only existing frame indices and allows clearing the selection',()=>{
    expect(programVisual({frame:3,animation:false},[2,4],4)).toEqual({frame:3,animation:false});
    expect(programVisual({frame:null},[2,4])).toEqual({frame:null});
    for(const frame of [-1,4,.5,Infinity,'1'])expect(()=>programVisual({frame},[2,4],4)).toThrow('available animation frame');
    expect(()=>programVisual({frame:0},[2,4])).toThrow('available animation frame');
  });
  it('validates numeric display bounds and draws its projected digits',()=>{
    const display={text:'012',color:'#ffbe55',corners:[.1,.2,.9,.6,.1,.4]};
    expect(programVisual({display},[2,4])).toEqual({display});
    expect(programVisual({display:null},[2,4])).toEqual({display:null});
    for(const change of [{text:'<img>'},{text:'1234567'},{color:'red'},{corners:[0,0,1,0,0,2]},{corners:[.5,.5,1,.8,.5,.8]},{corners:[0,0,0,0,0,0]},{url:'https://example.com'}])expect(()=>programVisual({display:{...display,...change}},[4])).toThrow();
    const ctx={save:vi.fn(),restore:vi.fn(),transform:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),fillRect:vi.fn()};
    drawProgramDisplay(ctx,100,100,display);
    expect(ctx.transform).toHaveBeenCalledWith(1.25,expect.closeTo(.625),0,expect.closeTo(5/6),10,20);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(20);expect(ctx.fillStyle).toBe('#ffbe55');expect(ctx.restore).toHaveBeenCalledOnce();
  });
  it('passes the global room count independently of visible occupants and the elected host',()=>{
    let room={people:null};const update=vi.fn();
    const runtime=createAssetPrograms({getPlayers:()=>[],getMe:()=>null,getRoom:()=>room,saveState:vi.fn(),sandbox:()=>({update,dispose:vi.fn()})});
    runtime.receive([]);runtime.sync([{id:'counter',type:'asset_a',x:0,z:0}],new Map([['asset_a',{name:'Counter',views:[{direction:4}],program:{revision:1,initialState:{},source:'x'}}]]));
    runtime.tick(100,false);expect(update.mock.lastCall[0].room).toEqual({people:null});
    room={people:12};runtime.tick(200,true);expect(update.mock.lastCall[0]).toMatchObject({room:{people:12},occupants:[],isHost:false,reducedMotion:true});runtime.dispose();
  });
  it('bounds code, JSON state and visual effects',()=>{
    expect(()=>validateProgram({source:'x'.repeat(65537)})).toThrow();
    expect(()=>validateProgram({source:'x',apiVersion:2})).toThrow();
    for(const state of [{x:NaN},{x:1n},{x:undefined},{x:'x'.repeat(8192)}])expect(()=>programState(state)).toThrow();
    for(const visual of [{direction:8},{offsetX:Infinity},{offsetY:65},{opacity:0},{url:'https://example.com'},{animation:'yes'},{constructor:1},{toString:1}])expect(()=>programVisual(visual,[0,2,4,6])).toThrow();
    expect(programVisual({direction:4,carryOccupants:true},[2,4])).toEqual({direction:4,carryOccupants:true});
  });
  it('waits for saved state, keeps instances alive, and disposes on hot replacement or pickup',()=>{
    const workers=[],players=[{id:'human',seatId:'chair',moving:true,direction:2}];
    const runtime=createAssetPrograms({getPlayers:()=>players,getMe:()=>null,saveState:vi.fn(),sandbox:options=>{const worker={options,update:vi.fn(),dispose:vi.fn()};workers.push(worker);return worker;}});
    const item={id:'chair',type:'asset_a',x:1,z:1,rotation:2},def={name:'Chair',views:[{direction:2}],program:{revision:1,initialState:{n:0},source:'x'}};
    const defs=new Map([['asset_a',def]]);runtime.sync([item],defs);expect(workers).toHaveLength(0);
    runtime.receive([{itemId:'chair',version:1,state:{n:3},revision:2,serial:9,events:[]}]);runtime.sync([item],defs);runtime.tick(1000,false);
    expect(workers[0].update.mock.calls[0][0]).toMatchObject({state:{n:3},occupants:[],serial:9,isHost:false});
    runtime.sync([item],defs);players[0].moving=false;runtime.tick(1100,false);expect(workers).toHaveLength(1);expect(workers[0].update.mock.calls[1][0].occupants).toHaveLength(1);
    def.program={...def.program,revision:2};runtime.sync([item],defs);expect(workers[0].dispose).toHaveBeenCalledOnce();expect(workers).toHaveLength(2);
    workers[0].options.onVisual({opacity:.2});expect(runtime.visual('chair')).toEqual({});
    runtime.sync([{...item,x:null,z:null}],defs);expect(workers[1].dispose).toHaveBeenCalledOnce();
  });
  it('handles state updates in a background host without rendering frames',()=>{
    vi.useFakeTimers();
    try{
      const update=vi.fn(),runtime=createAssetPrograms({getPlayers:()=>[],getMe:()=>null,getTime:()=>Date.now(),saveState:vi.fn(),sandbox:()=>({update,dispose:vi.fn()})});
      runtime.receive([{itemId:'chair',version:1,revision:1,state:null,serial:0,events:[]}]);
      runtime.sync([{id:'chair',type:'asset_a',x:0,z:0}],new Map([['asset_a',{name:'Chair',views:[{direction:2}],program:{revision:1,initialState:{},source:'x'}}]]));
      vi.advanceTimersByTime(100);expect(update).toHaveBeenCalledOnce();expect(update.mock.calls[0][0].state).toBeNull();
      runtime.dispose();vi.advanceTimersByTime(1000);expect(update).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });
});

describe('world-wide people count',()=>{
  it('counts connected humans once across zones and tracks clean and expired departures',async()=>{
    const a=await t.mutation(api.room.join,{token,name:'First',look});
    const b=await t.mutation(api.room.join,{token:otherToken,name:'Second',look});
    expect(await t.query(api.room.population,{})).toEqual({people:0});
    const ca='1'.repeat(64),ca2='2'.repeat(64),cb='3'.repeat(64);
    await t.mutation(api.room.heartbeat,{token,connectionId:ca});
    await t.mutation(api.room.heartbeat,{token,connectionId:ca2});
    await t.mutation(api.room.heartbeat,{token:otherToken,connectionId:cb});
    await t.run(async ctx=>{await ctx.db.patch(b.id,{zone:'far-away'});await ctx.db.insert('players',{kind:'bot',online:true,zone:'main',name:'Robot',nameKey:'robot',role:'guest',look,route:[{x:0,z:0}],startedAt:0,direction:2,seatId:null,lastSeen:Date.now(),lastChat:0});});
    expect(await t.query(api.room.population,{})).toEqual({people:2});
    await t.mutation(internal.room.disconnect,{token,connectionId:ca});expect(await t.query(api.room.population,{})).toEqual({people:2});
    await t.mutation(api.room.leave,{token});expect(await t.query(api.room.population,{})).toEqual({people:1});
    const lease=await t.run(ctx=>ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',cb)).unique());
    vi.spyOn(Date,'now').mockReturnValue(lease.lastSeen+lease.timeoutMs+1);
    await t.mutation(internal.room.expireConnection,{connectionId:cb,seenAt:lease.lastSeen});
    expect(await t.query(api.room.population,{})).toEqual({people:0});expect(a.id).not.toBe(b.id);
  });
});
