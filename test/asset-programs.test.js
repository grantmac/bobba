import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api} from '../convex/_generated/api.js';
import {validateProgram,programState,programVisual,programHost} from '../shared/asset-program.js';
import {createAssetPrograms} from '../src/asset-program-runtime.js';
import {spinningChairProgram} from '../shared/program-examples.js';
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
