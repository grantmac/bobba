// Imported as raw text: bundlers must not rewrite dynamic import or lift closure variables.
// A classic worker supports opaque iframe origins; the furniture itself is an ES module.
function assetProgramWorker(){
  const send=self.postMessage.bind(self),handlers=new Map(),saves=new Map();
  let world=null,previous=null,state={},revision=0,serial=0,visual={},saveId=0,started=false;
  const copy=value=>structuredClone(value);
  const emit=async(name,value)=>{for(const fn of handlers.get(name)??[])await fn(copy(value));};
  const api=Object.freeze({
    get item(){return copy(world.item);},get occupants(){return copy(world.occupants);},
    get state(){return copy(state);},get isHost(){return world.isHost;},
    get time(){return world.time;},get reducedMotion(){return world.reducedMotion;},
    on(name,fn){
      if(!['tick','sit','stand','power','interact','state','host','dispose'].includes(name)||typeof fn!=='function')throw new Error('Unknown event or invalid callback.');
      const list=handlers.get(name)??[];if(list.length>=32)throw new Error('Too many event listeners.');
      list.push(fn);handlers.set(name,list);return ()=>{const at=list.indexOf(fn);if(at>=0)list.splice(at,1);};
    },
    setVisual(patch){visual={...visual,...patch};},
    resetVisual(){visual={};},
    async saveState(next){
      if(!world.isHost)throw new Error('Only the host can save shared state.');
      if(saves.size)throw new Error('Await the previous state save first.');
      const id=++saveId;
      return new Promise((resolve,reject)=>{saves.set(id,{resolve,reject,next:copy(next)});send({type:'save',id,state:next,revision});});
    },
  });
  setInterval(()=>send({type:'heartbeat'}),500);
  self.onmessage=async({data})=>{
    try{
      if(data.type==='saved'){
        const pending=saves.get(data.id);if(!pending)return;saves.delete(data.id);
        if(data.error)pending.reject(new Error(data.error));else{state=pending.next;revision=data.revision;pending.resolve();}return;
      }
      if(data.type==='dispose'){await emit('dispose',{});self.close();return;}
      if(data.type!=='init'&&data.type!=='update')return;
      world=data.world;
      if(!started){
        started=true;state=copy(world.state);revision=world.revision;serial=world.serial;
        const url=URL.createObjectURL(new Blob([data.source],{type:'text/javascript'}));
        try{const module=await import(/* @vite-ignore */ url);if(typeof module.default!=='function')throw new Error('Export a default function that receives the furniture API.');await module.default(api);}finally{URL.revokeObjectURL(url);}
      }else if(world.revision>revision){state=copy(world.state);revision=world.revision;await emit('state',state);}
      if(previous&&previous.isHost!==world.isHost)await emit('host',{isHost:world.isHost});
      const before=new Map((previous?.occupants??[]).map(p=>[p.id,p])),after=new Map(world.occupants.map(p=>[p.id,p]));
      for(const [id,p] of before)if(!after.has(id))await emit('stand',p);
      for(const [id,p] of after)if(!before.has(id))await emit('sit',p);
      if(!previous||previous.item.on!==world.item.on)await emit('power',{on:world.item.on});
      for(const event of world.events)if(event.serial>serial){await emit('interact',event);serial=event.serial;}
      await emit('tick',{time:world.time,delta:previous?Math.min(250,Math.max(0,world.time-previous.time)):0});
      previous=world;send({type:'frame',sequence:data.sequence,visual});
    }catch(error){send({type:'error',message:String(error?.message??error).slice(0,300)});}
  };
  self.addEventListener('unhandledrejection',event=>send({type:'error',message:String(event.reason?.message??event.reason).slice(0,300)}));
}

assetProgramWorker();
