import {describe,it,expect,vi} from 'vitest';
import {createPlayerFrames} from '../src/player-appearance.js';

describe('player appearance across poses',()=>{
  const outfit={top:{model:'2',color:'#b34c43'},hats:{model:'1',color:'#624631'}};
  it('shares a fetched look between ordinary and drink poses, even while it is loading',async()=>{
    let resolve;
    const fetchLook=vi.fn(()=>new Promise(done=>{resolve=done;}));
    const frames=vi.fn(async(look,carry)=>({look,carry}));
    const render=createPlayerFrames({id:'guest',lookVersion:3},{fetchLook,frames});
    const ordinary=render(),drink=render(true);
    expect(frames).not.toHaveBeenCalled();
    resolve(outfit);
    expect(await ordinary).toEqual({look:outfit,carry:false});
    expect(await drink).toEqual({look:outfit,carry:true});
    expect(await render(true)).toEqual({look:outfit,carry:true});
    expect(fetchLook).toHaveBeenCalledExactlyOnceWith('guest',3);
  });
  it('keeps an inline look when later presence updates omit it',async()=>{
    const fetchLook=vi.fn(),frames=vi.fn(async look=>look);
    const player={id:'guest',look:outfit};
    const render=createPlayerFrames(player,{fetchLook,frames});
    delete player.look;
    expect(await render()).toBe(outfit);
    expect(await render(true)).toBe(outfit);
    expect(fetchLook).not.toHaveBeenCalled();
  });
  it('uses the new version for new poses without changing an in-flight old render',async()=>{
    const changed={...outfit,top:{model:'1',color:'#6b8c64'}};
    let resolveOld;
    const fetchLook=vi.fn((_id,version)=>version===1?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve(changed));
    const frames=vi.fn(async look=>look),services={fetchLook,frames};
    const old=createPlayerFrames({id:'guest',lookVersion:1},services)(true);
    const next=createPlayerFrames({id:'guest',lookVersion:2},services);
    expect(await next(true)).toBe(changed);
    resolveOld(outfit);expect(await old).toBe(outfit);
    expect(await next()).toBe(changed);
  });
  it('preserves the robot appearance for drink poses too',async()=>{
    const robotFrames=vi.fn(async()=> 'robot'),fetchLook=vi.fn(),frames=vi.fn();
    const render=createPlayerFrames({kind:'bot'},{fetchLook,frames,robotFrames});
    expect(await render()).toBe('robot');expect(await render(true)).toBe('robot');
    expect(fetchLook).not.toHaveBeenCalled();expect(frames).not.toHaveBeenCalled();
  });
});
