import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {api} from '../convex/_generated/api.js';
import {createMultiplayer} from '../src/multiplayer.js';

const client=vi.hoisted(()=>({mutation:vi.fn(),query:vi.fn()}));
vi.mock('convex/browser',()=>({ConvexClient:class{constructor(){return client;}}}));
const key='habbo-room-session-v1',token='a'.repeat(64),player={id:'visitor',name:'Visitor'};
const missing=()=>new Error("[CONVEX M(identity:resume)] Server Error\nCould not find public function for 'identity:resume'.");
let storage;
beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubEnv('VITE_CONVEX_URL','https://example.convex.cloud');
  storage=new Map([[key,token]]);
  vi.stubGlobal('localStorage',{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});
  vi.stubGlobal('window',{addEventListener:vi.fn()});
  vi.stubGlobal('location',{hash:''});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('restoring a remembered session',()=>{
  it.each([false,true])('opens the agent’s character regardless of a remembered session (%s)',async remembered=>{
    if(!remembered)storage.clear();
    const code='c'.repeat(64),nextToken='d'.repeat(64),replaceState=vi.fn();
    vi.stubGlobal('history',{replaceState});
    vi.stubGlobal('location',{hash:`#enter=${code}`,origin:'https://chat.grantm.ac',pathname:'/',search:''});
    client.mutation.mockResolvedValue({token:nextToken,player});
    const network=createMultiplayer();
    expect(replaceState).toHaveBeenCalledWith(null,'','/');
    expect(await network.resume()).toEqual(player);
    expect(client.mutation).toHaveBeenCalledWith(api.agentLogin.consume,{code,origin:'https://chat.grantm.ac'});
    expect(storage.get(key)).toBe(nextToken);expect(network.me).toEqual(player);
    client.mutation.mockResolvedValue(player);await network.resume();
    expect(client.mutation).toHaveBeenLastCalledWith(api.identity.resume,{token:nextToken});
  });
  it('does not silently open another character when the agent link fails',async()=>{
    vi.stubGlobal('history',{replaceState:vi.fn()});
    vi.stubGlobal('location',{hash:'#enter=invalid',origin:'https://chat.grantm.ac',pathname:'/',search:''});
    client.mutation.mockRejectedValue({data:'This room link has expired. Ask your agent to open the room again.'});
    const network=createMultiplayer();
    await expect(network.resume()).rejects.toThrow('Ask your agent');
    expect(network.me).toBeNull();expect(storage.get(key)).toBe(token);
    expect(client.mutation).toHaveBeenCalledTimes(1);
  });
  it('uses session renewal when the deployment supports it',async()=>{
    client.mutation.mockResolvedValue(player);
    const network=createMultiplayer();
    expect(await network.resume()).toEqual(player);
    expect(network.me).toEqual(player);
    expect(client.mutation).toHaveBeenCalledWith(api.identity.resume,{token});
    expect(client.query).not.toHaveBeenCalled();
  });
  it('restores the same character against a deployment without session renewal',async()=>{
    client.mutation.mockRejectedValue(missing());client.query.mockResolvedValue(player);
    const network=createMultiplayer();
    expect(await network.resume()).toEqual(player);
    expect(network.me).toEqual(player);
    expect(client.query).toHaveBeenCalledWith(api.room.me,{token});
    expect(storage.get(key)).toBe(token);
  });
  it.each([false,true])('clears an expired session (older deployment: %s)',async older=>{
    const expired=Object.assign(new Error('Session expired'),{data:'Your session has ended. Please enter the room again.'});
    client.mutation.mockRejectedValue(older?missing():expired);client.query.mockRejectedValue(expired);
    expect(await createMultiplayer().resume()).toBeNull();
    expect(storage.has(key)).toBe(false);
  });
  it.each([false,true])('preserves a moderation rejection (older deployment: %s)',async older=>{
    const blocked=Object.assign(new Error('Blocked'),{data:'You have been removed from the room for 10 minutes. Please return later.'});
    client.mutation.mockRejectedValue(older?missing():blocked);client.query.mockRejectedValue(blocked);
    await expect(createMultiplayer().resume()).rejects.toThrow('removed from the room');
    expect(storage.get(key)).toBe(token);
  });
  it('does not fall back or clear the character on other server failures',async()=>{
    client.mutation.mockRejectedValue(new Error('Network unavailable'));
    await expect(createMultiplayer().resume()).rejects.toThrow('The room server could not be reached');
    expect(client.query).not.toHaveBeenCalled();
    expect(storage.get(key)).toBe(token);
  });
  it('keeps the character when the older endpoint is unreachable',async()=>{
    client.mutation.mockRejectedValue(missing());client.query.mockRejectedValue(new Error('Network unavailable'));
    await expect(createMultiplayer().resume()).rejects.toThrow('The room server could not be reached');
    expect(storage.get(key)).toBe(token);
  });
});
