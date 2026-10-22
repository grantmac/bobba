import {assetProgramBridge} from './asset-program-bridge.js';
import workerSource from './asset-program-worker.js?raw';
import {programVisual,programState,programHost} from '../shared/asset-program.js';

// The program has no game-origin DOM, storage, credentials, or network access.
// Blob workers inherit the iframe CSP; never add allow-same-origin to this sandbox.
export function createProgramSandbox({program,views,onVisual,onSave,onError}){
  const iframe=document.createElement('iframe');iframe.hidden=true;iframe.title='Furniture program';iframe.sandbox='allow-scripts';
  const bootstrap=`(${assetProgramBridge.toString()})(${JSON.stringify(workerSource)});`;
  iframe.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none';"><script>${bootstrap.replaceAll('</script','<\\/script')}</script>`;
  const channel=new MessageChannel();let ready=false,busy=false,ended=false,initialized=false,sequence=0,pending=null,heartbeat=performance.now(),sentAt=0,saving=false;
  function fail(message){if(ended)return;dispose();onVisual({});onError(message);}
  function flush(){
    if(!ready||busy||!pending||ended)return;
    busy=true;sentAt=performance.now();
    channel.port1.postMessage({type:initialized?'update':'init',...(initialized?{}:{source:program.source}),world:pending,sequence:++sequence});initialized=true;pending=null;
  }
  channel.port1.onmessage=async({data})=>{
    if(ended||!data||typeof data!=='object')return;
    if(data.type==='heartbeat'){heartbeat=performance.now();return;}
    if(data.type==='ready'){ready=true;heartbeat=performance.now();flush();return;}
    if(data.type==='error'){fail(String(data.message).slice(0,300));return;}
    if(data.type==='frame'){
      if(!busy||data.sequence!==sequence){fail('Unexpected program response.');return;}
      try{onVisual(programVisual(data.visual,views));}catch(error){fail(error.message);return;}
      busy=false;flush();return;
    }
    if(data.type==='save'){
      if(saving){fail('Too many pending state saves.');return;}saving=true;
      try{
        programState(data.state);
        if(!Number.isSafeInteger(data.revision)||data.revision<0)throw new Error('Invalid state revision.');
        const result=await onSave(data.state,data.revision);
        if(!ended)channel.port1.postMessage({type:'saved',id:data.id,revision:result.revision});
      }catch(error){if(!ended)channel.port1.postMessage({type:'saved',id:data.id,error:error.message});}
      finally{saving=false;}
    }
  };
  iframe.onload=()=>{if(!ended)iframe.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);};
  document.body.append(iframe);
  const watchdog=setInterval(()=>{
    if(document.hidden){heartbeat=performance.now();sentAt=performance.now();return;}
    const now=performance.now();
    if(now-heartbeat>(ready?2500:10000)||(busy&&now-sentAt>15000))fail('Furniture program stopped responding.');
  },500);
  function dispose(){
    if(ended)return;ended=true;clearInterval(watchdog);
    // Cleanup is best effort; removing the frame destroys its workers even for infinite loops.
    channel.port1.postMessage({type:'dispose'});
    setTimeout(()=>{channel.port1.postMessage({type:'terminate'});channel.port1.close();iframe.remove();},50);
  }
  return {update(world){pending=world;flush();},dispose};
}

export function createAssetPrograms({getPlayers,getMe,saveState,getRoom=()=>({people:null}),getTime=null,getReducedMotion=()=>false,onError=console.warn,sandbox=createProgramSandbox}){
  const instances=new Map(),visuals=new Map();let records=new Map(),lastTick=-Infinity,received=false,timer=null;
  function stop(id,entry){entry.runtime.dispose();instances.delete(id);visuals.delete(id);}
  const runtime={
    receive(list){records=new Map(list.map(row=>[row.itemId,row]));received=true;},
    sync(items,definitions){
      if(!received)return;
      const wanted=new Set();
      for(const item of items){
        const def=definitions.get(item.type),program=def?.program;
        if(!program||!Number.isFinite(item.x)||!Number.isFinite(item.z))continue;
        wanted.add(item.id);let entry=instances.get(item.id);
        if(entry&&(entry.version!==program.revision||entry.type!==item.type)){stop(item.id,entry);entry=null;}
        if(!entry){
          const next={type:item.type,version:program.revision,item,program};instances.set(item.id,next);
          next.runtime=sandbox({program,views:def.views.map(v=>v.direction),
            onVisual:visual=>{if(instances.get(item.id)===next)visuals.set(item.id,visual);},
            onSave:(state,revision)=>{
              if(instances.get(item.id)!==next||programHost(getPlayers(item))!==getMe())throw new Error('This client is no longer hosting this program.');
              return saveState(item.id,program.revision,revision,state);
            },
            onError:message=>onError(`${def.name}: ${message}`)});
        }else entry.item=item;
      }
      for(const [id,entry] of instances)if(!wanted.has(id))stop(id,entry);
      // requestAnimationFrame pauses in background tabs. The elected host must still
      // handle shared interactions there (browsers may throttle this to once a second).
      if(instances.size&&getTime&&timer===null)timer=setInterval(()=>runtime.tick(getTime(),getReducedMotion()),100);
      if(!instances.size&&timer!==null){clearInterval(timer);timer=null;}
    },
    tick(time,reducedMotion){
      if(time-lastTick<50)return;lastTick=time;
      const players=getPlayers();
      for(const [id,entry] of instances){
        // The host is chosen among the players around the piece (getPlayers with an item); occupants come from everyone in view.
        const host=programHost(getPlayers(entry.item));
        const row=records.get(id),stored=row?.version===entry.version?row:null;
        const occupants=players.filter(p=>p.seatId===id&&!p.moving).map(({id,direction})=>({id,direction}));
        entry.runtime.update({item:{id,type:entry.item.type,x:entry.item.x,z:entry.item.z,direction:entry.item.rotation,on:entry.item.on!==false},occupants,
          room:getRoom(),time,reducedMotion,isHost:!!host&&host===getMe(),state:stored?stored.state:entry.program.initialState,revision:stored?.revision??0,serial:stored?.serial??0,events:stored?.events??[]});
      }
    },
    visual:id=>visuals.get(id)??{},
    dispose(){for(const [id,entry] of instances)stop(id,entry);clearInterval(timer);timer=null;},
  };
  return runtime;
}
