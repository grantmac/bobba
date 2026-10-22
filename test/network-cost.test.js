import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {getFunctionName} from 'convex/server';
import {createMultiplayer} from '../src/multiplayer.js';

const fake=vi.hoisted(()=>({}));
vi.mock('convex/browser',()=>({ConvexClient:class{constructor(){return fake.client;}}}));
let listeners,network;
beforeEach(()=>{
  vi.useFakeTimers();vi.stubEnv('VITE_CONVEX_URL','https://test.convex.cloud');
  listeners={};
  vi.stubGlobal('window',{addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:vi.fn()});
  vi.stubGlobal('document',{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:vi.fn()});
  vi.stubGlobal('location',{hash:'',origin:'http://localhost',pathname:'/',search:''});
  vi.stubGlobal('localStorage',{getItem:()=> 'a'.repeat(64),setItem:vi.fn()});
  vi.stubGlobal('sessionStorage',{getItem:()=>null});
  vi.stubGlobal('navigator',{sendBeacon:vi.fn()});
  fake.client={
    mutation:vi.fn(async fn=>getFunctionName(fn)==='identity:resume'?{id:'me',zone:'main'}:{serverTime:Date.now(),heartbeatInterval:30000}),
    onUpdate:vi.fn(()=>vi.fn()),close:vi.fn(),
  };
});
afterEach(()=>{network?.close();network=null;vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const pulses=()=>fake.client.mutation.mock.calls.filter(([fn])=>getFunctionName(fn)==='room:heartbeat');
const watch=async(options={})=>{network=createMultiplayer();await network.resume();await network.watch({onState:vi.fn(),onError:vi.fn(),...options});};

describe('room network budget',()=>{
  it('receives a single world-wide count without subscribing to off-screen player records',async()=>{
    await watch();expect(network.population).toEqual({people:null});
    const calls=fake.client.onUpdate.mock.calls.filter(([fn])=>getFunctionName(fn)==='room:population');
    expect(calls).toHaveLength(1);calls[0][2]({people:14});expect(network.population).toEqual({people:14});
    const copy=network.population;copy.people=99;expect(network.population.people).toBe(14);
    calls[0][3](new Error('offline'));expect(network.population.people).toBeNull();
  });
  it('only watches programs in zones with custom furniture and ignores retired callbacks',async()=>{
    const onPrograms=vi.fn();await watch({onPrograms});
    const calls=name=>fake.client.onUpdate.mock.calls.filter(([fn])=>getFunctionName(fn)===name);
    const furniture=calls('room:zoneFurniture')[0][2];
    expect(calls('programs:list')).toHaveLength(0);
    furniture([]);furniture([{id:'chair',type:'small_chair_armas'}]);
    expect(calls('programs:list')).toHaveLength(0);
    const custom=[{id:'custom',type:'asset_test'}];
    furniture(custom);furniture(custom);
    expect(calls('programs:list')).toHaveLength(1);
    const firstIndex=fake.client.onUpdate.mock.calls.findIndex(([fn])=>getFunctionName(fn)==='programs:list');
    const stop=fake.client.onUpdate.mock.results[firstIndex].value;
    furniture([]);expect(stop).toHaveBeenCalledTimes(1);
    // A late delivery cannot restore a removed piece's program state.
    calls('programs:list')[0][2]([{itemId:'custom',state:{obsolete:true}}]);
    await vi.advanceTimersByTimeAsync(0);expect(onPrograms).toHaveBeenLastCalledWith([]);
    furniture(custom);expect(calls('programs:list')).toHaveLength(2);
    const lastIndex=fake.client.onUpdate.mock.calls.findLastIndex(([fn])=>getFunctionName(fn)==='programs:list');
    network.close();network=null;
    expect(fake.client.onUpdate.mock.results[lastIndex].value).toHaveBeenCalledTimes(1);
  });
  it('uses 120 periodic heartbeats per hour and one session-validating player subscription',async()=>{
    await watch();await vi.advanceTimersByTimeAsync(3600000);
    expect(pulses()).toHaveLength(121); // Includes the initial connection.
    const names=fake.client.onUpdate.mock.calls.map(([fn])=>getFunctionName(fn));
    expect(names.filter(name=>name==='room:me')).toHaveLength(1);
    expect(names.some(name=>name.startsWith('pong:'))).toBe(false);expect(network).not.toHaveProperty('pong');
    expect(names.some(name=>name.startsWith('captures:'))).toBe(false);expect(network).not.toHaveProperty('captures');
    expect(names).not.toContain('room:session');expect(names).toContain('room:livePresence');
    network.close();network=null;await vi.advanceTimersByTimeAsync(60000);
    expect(pulses()).toHaveLength(121);
  });
  it('retains the old heartbeat cadence when connected to an older backend',async()=>{
    const original=fake.client.mutation.getMockImplementation();
    fake.client.mutation.mockImplementation(async(fn,...args)=>getFunctionName(fn)==='room:heartbeat'?{serverTime:Date.now()}:original(fn,...args));
    await watch();await vi.advanceTimersByTimeAsync(60000);expect(pulses()).toHaveLength(5);
    const names=fake.client.onUpdate.mock.calls.map(([fn])=>getFunctionName(fn));
    expect(names).toContain('room:presence');expect(names).not.toContain('room:livePresence');
  });
  it('does not queue heartbeats behind a slow request and reconnects on page restore',async()=>{
    await watch();let finish;
    fake.client.mutation.mockImplementation(()=>new Promise(resolve=>finish=resolve));
    await vi.advanceTimersByTimeAsync(120000);expect(pulses()).toHaveLength(2);
    listeners.pageshow({persisted:true});expect(pulses()).toHaveLength(2);
    finish({serverTime:Date.now(),heartbeatInterval:30000});await Promise.resolve();await Promise.resolve();
    listeners.pageshow({persisted:true});expect(pulses()).toHaveLength(3);
    finish({serverTime:Date.now(),heartbeatInterval:30000});
  });
  it('refreshes presence immediately after a suspended tab becomes visible',async()=>{
    await watch();
    document.hidden=true;listeners.visibilitychange();listeners.online();
    expect(pulses()).toHaveLength(1);
    // A suspended browser advances wall time without executing interval callbacks.
    vi.setSystemTime(Date.now()+10*60000);
    document.hidden=false;listeners.visibilitychange();
    expect(pulses()).toHaveLength(2);
    listeners.online();listeners.pageshow({persisted:true});
    expect(pulses()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    listeners.online();expect(pulses()).toHaveLength(3);
  });
  it('reports a temporary heartbeat failure without requiring the room to disable controls',async()=>{
    const onError=vi.fn();await watch({onError});
    fake.client.mutation.mockRejectedValueOnce(new Error('Connection interrupted'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(onError).toHaveBeenCalledWith('Connection interrupted',{transient:true});
    listeners.visibilitychange();await vi.advanceTimersByTimeAsync(0);
    expect(pulses()).toHaveLength(3);expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);expect(pulses()).toHaveLength(4);
  });
  it.each(['Your session has ended. Please enter the room again.','You have been removed from the room.'])('keeps server rejection fatal: %s',async message=>{
    const onError=vi.fn();await watch({onError});
    fake.client.mutation.mockRejectedValueOnce(Object.assign(new Error('Server Error'),{data:message}));
    listeners.visibilitychange();await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(message,{transient:false});
  });
  it('ignores wake events and late heartbeat errors after closing',async()=>{
    const onError=vi.fn();await watch({onError});let fail;
    fake.client.mutation.mockImplementation(()=>new Promise((resolve,reject)=>fail=reject));
    listeners.online();expect(pulses()).toHaveLength(2);
    network.close();network=null;
    fail(new Error('Connection closed'));await vi.advanceTimersByTimeAsync(0);
    listeners.visibilitychange();listeners.online();listeners.pageshow({persisted:true});
    expect(pulses()).toHaveLength(2);expect(onError).not.toHaveBeenCalled();
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange',listeners.visibilitychange);
    expect(window.removeEventListener).toHaveBeenCalledWith('pageshow',listeners.pageshow);
    expect(window.removeEventListener).toHaveBeenCalledWith('online',listeners.online);
  });
});
