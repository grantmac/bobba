import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createProgramSandbox} from '../src/asset-program-runtime.js';

describe('furniture program suspension',()=>{
  let runtime,port,frame,doc,now,onVisual,onError;
  beforeEach(()=>{
    vi.useFakeTimers();now=0;
    vi.spyOn(performance,'now').mockImplementation(()=>now);
    doc=new EventTarget();doc.hidden=false;
    frame={remove:vi.fn()};
    doc.createElement=()=>frame;doc.body={append:vi.fn()};
    vi.stubGlobal('document',doc);
    port={postMessage:vi.fn(),close:vi.fn()};
    vi.stubGlobal('MessageChannel',class{constructor(){this.port1=port;this.port2={};}});
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
    expect(onError).toHaveBeenCalledWith('Furniture program stopped responding.');
  });
  it('allows startup to finish after suspension',()=>{
    runtime.update({room:{people:12}});visibility(true);
    now=10*60000;visibility(false);tick();expect(onError).not.toHaveBeenCalled();
    receive({type:'ready'});
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({type:'init',sequence:1}));
  });
  it('still terminates an unresponsive worker after its foreground grace period',()=>{
    startCounter();visibility(true);now=10*60000;visibility(false);
    now+=3000;tick();
    expect(onError).toHaveBeenCalledExactlyOnceWith('Furniture program stopped responding.');
    expect(onVisual).toHaveBeenLastCalledWith({});
  });
  it('removes the visibility listener and watchdog on disposal',()=>{
    const remove=vi.spyOn(doc,'removeEventListener');
    runtime.dispose();visibility(true);now=10*60000;visibility(false);tick();
    expect(remove).toHaveBeenCalledWith('visibilitychange',expect.any(Function));
    expect(frame.remove).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled();
  });
});
