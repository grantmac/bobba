import {ConvexClient} from 'convex/browser';
import {api} from '../convex/_generated/api.js';
const KEY='habbo-room-session-v1';
export function createMultiplayer(){
  const url=import.meta.env.VITE_CONVEX_URL;
  if(!url)throw new Error('The room server is not configured.');
  const client=new ConvexClient(url,{logger:false});
  window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).has('grant'))location.reload();});
  const fragment=new URLSearchParams(location.hash.slice(1));let entryCode=fragment.get('grant')||'';
  if(entryCode)history.replaceState(null,'',location.pathname+location.search);
  let token='',me=null,state=null,room=null,inventory=null,unsubscribe=null,unsubscribeRoom=null,unsubscribePong=null,heartbeat=null,offset=0;
  // Per-zone subscriptions, keyed by zone id; `pinned` zones stay while a picture needs them.
  const zones=new Map(),pinned=new Set(),loaded=new Map(),looks=new Map();let wanted=null,lastZones=[];
  const RELEASE_AFTER=2500;
  try{token=localStorage.getItem(KEY)||'';}catch{}
  let remembered=!!token;
  function remember(){try{localStorage.setItem(KEY,token);remembered=localStorage.getItem(KEY)===token;}catch{remembered=false;}}
  function acceptSession(result){if(result.token){token=result.token;me=result.player;entryCode='';remember();}return result;}
  async function identityCall(kind,fn,args){try{return await client[kind](fn,args);}catch(error){throw new Error(errorMessage(error));}}
  function errorMessage(error){return typeof error?.data==='string'?error.data:error?.message?.replace(/\[CONVEX[^\]]*\]\s*/,'').split('\n')[0]||'The room could not be reached.';}
  async function mutatePong(name,args={}){try{return await client.mutation(api.pong[name],{token,...args});}catch(error){throw new Error(errorMessage(error));}}
  async function mutate(name,args={}){
    const sent=Date.now();
    try{
      const result=await client.mutation(api.room[name],{token,...args});
      // Presence can stay cached for hours while the room is idle; time comes from a fresh heartbeat.
      if(name==='heartbeat'&&Number.isFinite(result?.serverTime))offset=result.serverTime-(sent+Date.now())/2;
      return result;
    }catch(error){throw new Error(errorMessage(error));}
  }
  function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const connectionId=randomToken();
  const depart=()=>{if(token&&me)navigator.sendBeacon(import.meta.env.VITE_CONVEX_SITE_URL+'/disconnect',JSON.stringify({token,connectionId}));};
  window.addEventListener('pagehide',depart);
  window.addEventListener('pageshow',event=>{if(event.persisted&&me)mutate('heartbeat',{connectionId,pageOrigin:location.origin}).catch(()=>{});});
  return {
    get adminEntry(){return !!entryCode;},get me(){return me;},get state(){return state;},now:()=>Date.now()+offset,
    async resume(){
      if(entryCode||!token)return null;
      try{
        try{me=await client.mutation(api.identity.resume,{token});}
        catch(error){
          // A local client can be ahead of the shared deployment during development.
          if(!error?.message?.includes("Could not find public function for 'identity:resume'"))throw error;
          me=await client.query(api.room.me,{token});
        }
        return me;
      }catch(error){
        if(errorMessage(error).includes('removed from the room'))throw new Error(errorMessage(error));
        if(error?.data){token='';try{localStorage.removeItem(KEY);}catch{}return null;}
        throw new Error('The room server could not be reached. Please try again.');
      }
    },
    async entryAppearance(){if(!entryCode)return null;try{return await client.query(api.room.entryAppearance,{entryCode});}catch(error){throw new Error(errorMessage(error));}},
    async checkName(name){try{return await client.query(api.room.checkName,{name,...(entryCode?{entryCode}:{})});}catch(error){throw new Error(errorMessage(error));}},
    async join(name,look,{appearanceChanged=false}={}){
      if(!token||entryCode)token=randomToken();
      try{me=await client.mutation(api.room.join,{token,name,look,pageOrigin:location.origin,...(entryCode?{entryCode,replaceLook:appearanceChanged}:{})});}catch(error){throw new Error(errorMessage(error));}
      entryCode='';remember();return me;
    },
    identity:{
      get remembered(){return remembered;},
      status:()=>identityCall('query',api.identity.status,{token}),
      registrationOptions:()=>identityCall('action',api.passkeys.registrationOptions,{token,origin:location.origin}),
      register:(id,response)=>identityCall('action',api.passkeys.register,{token,id,response}),
      authenticationOptions:()=>identityCall('action',api.passkeys.authenticationOptions,{origin:location.origin}),
      authenticate:async(id,response)=>acceptSession(await identityCall('action',api.passkeys.authenticate,{id,response})),
      makeBackup:()=>identityCall('mutation',api.identity.makeBackup,{token}),
      useBackup:async code=>{
        const result=await identityCall('mutation',api.identity.useBackup,{code});
        if(result.error)throw new Error(result.error);
        return acceptSession(result);
      },
    },
    async loadPreview(){const value=await client.query(api.room.preview,{});offset=value.serverTime-Date.now();return value;},
    preview(onState,onError){
      let presence=null,scene=null;const error=e=>onError(errorMessage(e));
      const emit=()=>{if(presence&&scene)onState({...presence,room:scene});};
      const stops=[client.onUpdate(api.room.presence,{},value=>{presence=value;emit();},error),client.onUpdate(api.room.scene,{},value=>{scene=value;emit();},error)];
      return ()=>stops.forEach(stop=>stop());
    },
    // The live room, one zone at a time. Fixed subscriptions carry the player, the map, the
    // lobby switches, what the player holds and the pong table; `setZones` adds and drops a
    // presence, chat and furniture subscription per zone as the camera moves. Only the zones in
    // view cost anything, however many exist.
    async watch({onState,onError,onMap,onSignals,onFurniture,onPrograms,onPong}){
      try{await mutate('heartbeat',{connectionId,pageOrigin:location.origin});}catch(error){onError(error.message);return;}
      unsubscribe?.();unsubscribeRoom?.();
      const error=e=>onError(errorMessage(e));
      let queued=false;
      const emit=()=>{
        if(queued)return;queued=true;
        queueMicrotask(()=>{
          queued=false;if(!me)return;
          const players=new Map(),messages=[];let serverTime=0;
          for(const zone of zones.values()){
            if(zone.presence){serverTime=Math.max(serverTime,zone.presence.serverTime);for(const p of zone.presence.players)players.set(p.id,p);}
            if(zone.messages)messages.push(...zone.messages);
          }
          players.delete(me.id);
          messages.sort((a,b)=>a.sentAt-b.sentAt);
          state={serverTime:serverTime||Date.now()+offset,me,players:[...players.values()],messages};onState(state);
        });
      };
      let programsQueued=false;
      const emitPrograms=()=>{
        if(programsQueued)return;programsQueued=true;
        queueMicrotask(()=>{programsQueued=false;onPrograms?.([...zones.values()].flatMap(z=>z.programs??[]));});
      };
      let furnitureQueued=false;
      const emitFurniture=()=>{
        if(furnitureQueued)return;furnitureQueued=true;
        queueMicrotask(()=>{furnitureQueued=false;onFurniture?.({zones:new Map([...zones].filter(([,z])=>z.furniture).map(([id,z])=>[id,z.furniture])),inventory:inventory??[]});});
      };
      const stops=[
        client.onUpdate(api.room.session,{token},()=>{},error),
        client.onUpdate(api.room.me,{token},value=>{me=value;emit();},error),
        client.onUpdate(api.room.roomMap,{token},value=>{room=value;onMap?.(value);},error),
        client.onUpdate(api.room.signals,{},value=>onSignals?.(value),error),
        client.onUpdate(api.room.inventory,{token},value=>{inventory=value;emitFurniture();},error),
        client.onUpdate(api.pong.state,{},value=>onPong?.(value),error)
      ];
      unsubscribe=()=>{stops.forEach(stop=>stop());for(const id of [...zones.keys()])dropZone(id);};
      unsubscribeRoom=null;
      function addZone(id){
        if(zones.has(id)){const zone=zones.get(id);clearTimeout(zone.release);zone.release=null;return;}
        const zone={presence:null,messages:null,furniture:null,programs:null,release:null,stops:[]};zones.set(id,zone);
        zone.stops=[
          client.onUpdate(api.room.presence,{zone:id},value=>{zone.presence=value;emit();},error),
          client.onUpdate(api.programs.list,{zone:id},value=>{zone.programs=value;emitPrograms();},error),
          client.onUpdate(api.room.chatFeed,{token,zone:id},value=>{zone.messages=value;emit();},error),
          client.onUpdate(api.room.zoneFurniture,{token,zone:id},value=>{zone.furniture=value;emitFurniture();loaded.get(id)?.forEach(resolve=>resolve());loaded.delete(id);},error)
        ];
      }
      function dropZone(id){
        const zone=zones.get(id);if(!zone)return;
        clearTimeout(zone.release);zone.stops.forEach(stop=>stop());zones.delete(id);emit();emitFurniture();emitPrograms();
      }
      wanted=ids=>{
        const keep=new Set([...ids,...pinned,...(me?[me.zone]:[])]);
        for(const id of keep)addZone(id);
        // A zone that scrolled out of view lingers a moment, so panning back and forth is free.
        for(const [id,zone] of zones)if(!keep.has(id)&&!zone.release)zone.release=setTimeout(()=>{if(!keep.has(id))dropZone(id);},RELEASE_AFTER);
      };
      // Zones asked for before the room was live are picked up now.
      wanted(lastZones);
      clearInterval(heartbeat);heartbeat=setInterval(()=>mutate('heartbeat',{connectionId,pageOrigin:location.origin}).catch(error=>onError(error.message)),15000);
    },
    // The zones the camera can see; the player's own zone is always included.
    setZones(ids){lastZones=ids;wanted?.(ids);},
    // Hold some zones subscribed (for a picture of them) until their furniture has arrived.
    async ensureZones(ids){
      for(const id of ids)pinned.add(id);
      wanted?.(lastZones);
      await Promise.all(ids.map(id=>zones.get(id)?.furniture?Promise.resolve():new Promise(resolve=>{if(!loaded.has(id))loaded.set(id,[]);loaded.get(id).push(resolve);})));
      return ()=>{for(const id of ids)pinned.delete(id);wanted?.(lastZones);};
    },
    get zones(){return [...zones.keys()];},
    // An appearance by player and version: fetched once, then remembered.
    async look(id,version){
      const key=`${id}:${version}`;
      if(!looks.has(key)){looks.set(key,client.query(api.room.look,{id}).then(value=>{if(!value)throw new Error('That player has left.');return value.look;}).catch(error=>{looks.delete(key);throw error;}));if(looks.size>400)looks.delete(looks.keys().next().value);}
      return looks.get(key);
    },
    appearance:look=>mutate('appearance',{look}),
    async voiceCredentials(tab){try{return await client.action(api.voice.connect,{token,...(tab?{tab}:{})});}catch(error){throw new Error(errorMessage(error));}},
    move:(x,z,seatId,direction=null)=>mutate('move',{x,z,...(seatId?{seatId}:{}),...(direction===null?{}:{direction})}),
    gesture:action=>mutate('gesture',{action}),
    takeDrink:id=>mutate('takeDrink',{id}),
    whiteboard:{
      all:()=>client.query(api.whiteboard.all,{}),
      draw:stroke=>client.mutation(api.whiteboard.draw,{token,...stroke}).catch(error=>{throw new Error(errorMessage(error));}),
      clear:()=>client.mutation(api.whiteboard.clear,{token}).catch(error=>{throw new Error(errorMessage(error));}),
      // Delta subscription: after each batch, re-subscribe from the newest serial seen, so
      // the live feed only ever carries what changed.
      watch(after,onUpdate){
        let stop=null,cursor=after,ended=false;
        const subscribe=()=>{stop?.();stop=client.onUpdate(api.whiteboard.updates,{after:cursor},value=>{
          if(ended)return;const latest=Math.max(cursor,value.serial,...value.strokes.map(s=>s.serial));
          if(value.strokes.length||value.clearedSerial>cursor)onUpdate(value);
          if(latest>cursor){cursor=latest;subscribe();}
        },error=>console.warn(errorMessage(error)));};
        subscribe();return ()=>{ended=true;stop?.();};
      },
    },
    visits:{
      page:before=>client.query(api.visits.page,{token,...(before?{before}:{})}).catch(error=>{throw new Error(errorMessage(error));}),
      watch:(onPage,onError)=>client.onUpdate(api.visits.page,{token},onPage,error=>onError(errorMessage(error))),
    },
    pong:{join:()=>mutatePong('join'),leave:()=>mutatePong('leave'),paddle:(side,y)=>mutatePong('paddle',{side,y}),hit:(side,y,serial)=>mutatePong('hit',{side,y,serial}),miss:(side,serial)=>mutatePong('miss',{side,serial})},
    chat:(body,mode)=>mutate('chat',{body,mode}),
    bot:{
      status:(onValue,onError)=>client.onUpdate(api.bot.status,{},onValue,error=>onError(errorMessage(error))),
      watch:(onValue,onError)=>client.onUpdate(api.bot.manage,{token},onValue,error=>onError(errorMessage(error))),
      configure:settings=>client.mutation(api.bot.configure,{token,...settings}).catch(error=>{throw new Error(errorMessage(error));}),
      saveMemory:(text,id)=>client.mutation(api.bot.saveMemory,{token,text,...(id?{id}:{})}).catch(error=>{throw new Error(errorMessage(error));}),
      forgetMemory:id=>client.mutation(api.bot.forgetMemory,{token,id}).catch(error=>{throw new Error(errorMessage(error));}),
      restore:playerId=>client.mutation(api.bot.restore,{token,playerId}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    typing:typing=>mutate('setTyping',{typing}),
    // Furniture saves carry only the pieces that changed (each whole, or {id, removed: true}).
    furniture:changes=>mutate('editFurniture',{changes}),
    options:options=>mutate('setOptions',{options,revision:room.revision}),
    danceFloor:on=>mutate('setDanceFloor',{on}),
    deckPower:(id,on)=>mutate('setDeckPower',{id,on}),
    createSticky:(id,position,poster)=>mutate('createSticky',{id,position,...(poster?{poster}:{})}),
    editSticky:note=>mutate('editSticky',note),
    appendSticky:(id,text)=>mutate('appendSticky',{id,text}),
    deleteSticky:(id,revision)=>mutate('deleteSticky',{id,revision}),
    seed:(options,items)=>mutate('seed',{options,items}),
    // Player-built catalogue pieces, live: a new piece reaches every open room at once.
    programs:{
      save:(itemId,version,revision,state)=>client.mutation(api.programs.save,{token,itemId,version,revision,state}).catch(error=>{throw new Error(errorMessage(error));}),
      interact:itemId=>client.mutation(api.programs.interact,{token,itemId}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    assets:{
      list:()=>client.query(api.assets.list,{}).catch(error=>{throw new Error(errorMessage(error));}),
      watch:(onList,onError)=>client.onUpdate(api.assets.list,{},onList,error=>onError(errorMessage(error))),
    },
    agents:{
      key:label=>client.mutation(api.agents.createKey,{token,label}).catch(error=>{throw new Error(errorMessage(error));}),
      attached:(onList,onError)=>client.onUpdate(api.agents.attached,{token},onList,error=>onError(errorMessage(error))),
      revoke:()=>client.mutation(api.agents.revoke,{token}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    // Pictures for agents: an open tab takes the request, renders and uploads (src/snapshot.js).
    captures:{
      watch:(onPending,onError)=>client.onUpdate(api.captures.pending,{token},onPending,error=>onError(errorMessage(error))),
      take:id=>client.mutation(api.captures.take,{token,id}),
      uploadUrl:()=>client.mutation(api.captures.uploadUrl,{token}),
      finish:(id,storageId)=>client.mutation(api.captures.finish,{token,id,storageId}),
      failed:(id,reason)=>client.mutation(api.captures.failed,{token,id,reason}),
    },
    close(){depart();window.removeEventListener('pagehide',depart);unsubscribe?.();unsubscribeRoom?.();unsubscribePong?.();clearInterval(heartbeat);client.close();},
  };
}
export function samplePlayer(player,now){
  const route=player.route;let distance=Math.max(0,now-player.startedAt)/1000*3.2;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],length=Math.hypot(b.x-a.x,b.z-a.z);
    if(distance<length&&length>0){const dx=b.x-a.x,dz=b.z-a.z;return {x:a.x+dx*distance/length,z:a.z+dz*distance/length,direction:Math.abs(dx)>Math.abs(dz)?(dx>0?2:6):(dz>0?4:0),moving:true};}
    distance-=length;
  }
  return {...route.at(-1),direction:player.direction,moving:false};
}
