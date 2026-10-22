import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createProgramSandbox} from '../src/asset-program-runtime.js';
import {assetProgramBridge} from '../src/asset-program-bridge.js';

describe('furniture program suspension',()=>{
  let runtime,port,frame,doc,now,onVisual,onError,ports,frames;
  beforeEach(()=>{
    vi.useFakeTimers();now=0;
    vi.spyOn(performance,'now').mockImplementation(()=>now);
    doc=new EventTarget();doc.hidden=false;
    ports=[];frames=[];
    doc.createElement=()=>{frame={remove:vi.fn()};frames.push(frame);return frame;};doc.body={append:vi.fn()};
    vi.stubGlobal('document',doc);
    vi.stubGlobal('MessageChannel',class{constructor(){port={postMessage:vi.fn(),close:vi.fn()};ports.push(port);this.port1=port;this.port2={};}});
    onVisual=vi.fn();onError=vi.fn();
    runtime=createProgramSandbox({program:{source:'unused'},views:[4],onVisual,onError,onSave:vi.fn()});
  });
  afterEach(()=>{
    runtime.dispose();vi.runOnlyPendingTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
  });
  const tick=()=>vi.advanceTimersByTime(500);
  const visibility=hidden=>{doc.hidden=hidden;doc.dispatchEvent(new Event('visibilitychange'));};
  const receive=data=>port.onmessage({data});
  function startCounter(){
    receive({type:'ready'});runtime.update({room:{people:12}});
    receive({type:'frame',sequence:1,visual:{display:{text:'012',color:'#ffbe55',corners:[.1,.2,.9,.6,.1,.4]}}});
  }
  it('retains the count when a frozen background tab returns before its worker heartbeat',()=>{
    startCounter();visibility(true);
    // No timers or worker messages execute during suspension.
    now=10*60000;visibility(false);tick();
    expect(onError).not.toHaveBeenCalled();
    expect(onVisual).toHaveBeenCalledTimes(1);
    expect(onVisual.mock.lastCall[0].display.text).toBe('012');
    receive({type:'heartbeat'});runtime.update({room:{people:13}});
    receive({type:'frame',sequence:2,visual:{display:{text:'013',color:'#ffbe55',corners:[.1,.2,.9,.6,.1,.4]}}});
    expect(onVisual.mock.lastCall[0].display.text).toBe('013');
  });
  it('keeps program-controlled animations stopped when the tab returns',()=>{
    receive({type:'ready'});runtime.update({item:{on:false},state:{running:false}});
    receive({type:'frame',sequence:1,visual:{animation:false}});
    visibility(true);now=10*60000;visibility(false);tick();
    expect(onError).not.toHaveBeenCalled();
    // Clearing this override would select the ordinary looping sprite again.
    expect(onVisual).toHaveBeenCalledExactlyOnceWith({animation:false});
    runtime.update({item:{on:false},state:{running:false}});
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'update',world:{item:{on:false},state:{running:false}}}));
  });
  it('allows an in-flight update to finish after resuming while retaining the response timeout',()=>{
    startCounter();runtime.update({room:{people:13}});visibility(true);
    now=10*60000;visibility(false);
    // Heartbeats can resume before a pending update finishes.
    receive({type:'heartbeat'});tick();expect(onError).not.toHaveBeenCalled();
    now+=14000;receive({type:'heartbeat'});tick();expect(onError).not.toHaveBeenCalled();
    now+=2000;receive({type:'heartbeat'});tick();
    expect(ports).toHaveLength(2);expect(onError).not.toHaveBeenCalled();
    receive({type:'ready'});
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'init',world:{room:{people:13}}}));
  });
  it('allows startup to finish after suspension',()=>{
    runtime.update({room:{people:12}});visibility(true);
    now=10*60000;visibility(false);tick();expect(onError).not.toHaveBeenCalled();
    receive({type:'ready'});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'init',sequence:1}));
  });
  it('restarts an unresponsive worker once on return, then stops retrying',()=>{
    startCounter();visibility(true);now=10*60000;visibility(false);
    now+=3000;tick();
    expect(ports).toHaveLength(2);expect(onError).not.toHaveBeenCalled();
    receive({type:'ready'});now+=3000;tick();
    expect(onError).toHaveBeenCalledExactlyOnceWith('Furniture program stopped responding.');
    expect(onVisual.mock.lastCall[0].display.text).toBe('012');
    now+=60000;tick();expect(ports).toHaveLength(2);
  });
  it('reconnects a program that failed while hidden with the latest saved state and power',()=>{
    startCounter();const old=port;visibility(true);
    receive({type:'error',message:'Program sent too many messages.'});
    const world={item:{on:false},room:{people:17},state:{running:false},revision:4,serial:9,events:[]};
    runtime.update(world);now=10*60000;visibility(false);
    expect(ports).toHaveLength(2);expect(onVisual).toHaveBeenCalledTimes(1);
    receive({type:'ready'});
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({type:'init',world}));
    old.onmessage({data:{type:'frame',sequence:1,visual:{}}});
    expect(onVisual.mock.lastCall[0].display.text).toBe('012');
    receive({type:'frame',sequence:1,visual:{animation:false}});
    expect(onVisual).toHaveBeenLastCalledWith({animation:false});
    tick();expect(frames[0].remove).toHaveBeenCalledOnce();
  });
  it('does not reset a healthy worker or its module state on return',()=>{
    startCounter();visibility(true);now=10*60000;visibility(false);
    receive({type:'heartbeat'});tick();expect(ports).toHaveLength(1);
  });
  it('recovers if a queued bridge failure arrives after the tab is already visible',()=>{
    startCounter();visibility(true);now=10*60000;visibility(false);
    receive({type:'error',message:'Program sent too many messages.',recoverable:true});
    expect(ports).toHaveLength(2);expect(onError).not.toHaveBeenCalled();
    expect(onVisual.mock.lastCall[0].display.text).toBe('012');
    receive({type:'ready'});
    receive({type:'error',message:'Program sent too many messages.',recoverable:true});
    expect(ports).toHaveLength(2);expect(onError).toHaveBeenCalledOnce();
  });
  it('still clears invalid visuals and stops a broken foreground program',()=>{
    startCounter();runtime.update({room:{people:12}});
    receive({type:'frame',sequence:2,visual:{direction:999}});
    expect(onVisual).toHaveBeenLastCalledWith({});expect(onError).toHaveBeenCalledOnce();
    now+=60000;tick();expect(ports).toHaveLength(1);
  });
  it('removes the visibility listener and watchdog on disposal',()=>{
    const remove=vi.spyOn(doc,'removeEventListener');
    runtime.dispose();visibility(true);now=10*60000;visibility(false);tick();
    expect(remove).toHaveBeenCalledWith('visibilitychange',expect.any(Function));
    expect(frame.remove).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled();
  });
});

describe('sandbox message budget',()=>{
  let now,worker,port;
  beforeEach(()=>{
    now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
    const parent={},win=new EventTarget();vi.stubGlobal('window',win);vi.stubGlobal('parent',parent);
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    vi.stubGlobal('Worker',class{constructor(){worker=this;this.terminate=vi.fn();this.postMessage=vi.fn();}});
    port={postMessage:vi.fn(),close:vi.fn()};
    assetProgramBridge('unused');
    const event=new Event('message');Object.assign(event,{source:parent,ports:[port]});win.dispatchEvent(event);
  });
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('allows normal heartbeats when iframe reset timers are throttled for minutes',()=>{
    // Dedicated worker messages keep arriving while iframe timers cannot reset.
    for(let i=0;i<12*60;i++){now+=500;worker.onmessage({data:{type:'heartbeat'}});}
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({type:'error'}));
  });
  it('still terminates an actual message flood exactly once',()=>{
    for(let i=0;i<150;i++)worker.onmessage({data:{type:'heartbeat'}});
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenLastCalledWith({type:'error',message:'Program sent too many messages.',recoverable:true});
  });
});
