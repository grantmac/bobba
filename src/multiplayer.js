import {ConvexClient} from 'convex/browser';
import {api} from '../convex/_generated/api.js';
const KEY='habbo-room-session-v1';
export function createMultiplayer(){
  const url=import.meta.env.VITE_CONVEX_URL;
  if(!url)throw new Error('The room server is not configured.');
  const client=new ConvexClient(url,{logger:false});
  window.addEventListener('hashchange',()=>{const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('grant')||hash.has('pair'))location.reload();});
  const fragment=new URLSearchParams(location.hash.slice(1));let entryCode=fragment.get('grant')||'';
  const pairingStorage='habbo-room-pairing';let pairingCode=fragment.get('pair')||'';
  try{if(pairingCode)sessionStorage.setItem(pairingStorage,pairingCode);else pairingCode=sessionStorage.getItem(pairingStorage)||'';}catch{}
  if(entryCode||fragment.has('pair'))history.replaceState(null,'',location.pathname+location.search);
  let token='',me=null,state=null,room=null,inventory=null,unsubscribe=null,unsubscribeRoom=null,heartbeat=null,heartbeatInterval=15000,offset=0;
  // Per-zone subscriptions, keyed by zone id.
  const zones=new Map(),looks=new Map();let wanted=null,lastZones=[];
  const RELEASE_AFTER=2500;
  try{token=localStorage.getItem(KEY)||'';}catch{}
  let remembered=!!token;
  function remember(){try{localStorage.setItem(KEY,token);remembered=localStorage.getItem(KEY)===token;}catch{remembered=false;}}
  function acceptSession(result){if(result.token){token=result.token;me=result.player;entryCode='';remember();}return result;}
  async function identityCall(kind,fn,args){try{return await client[kind](fn,args);}catch(error){throw new Error(errorMessage(error));}}
  function errorMessage(error){return typeof error?.data==='string'?error.data:error?.message?.replace(/\[CONVEX[^\]]*\]\s*/,'').split('\n')[0]||'The room could not be reached.';}
  async function mutate(name,args={}){
    const sent=Date.now();
    try{
      const result=await client.mutation(api.room[name],{token,...args});
      // Presence can stay cached for hours while the room is idle; time comes from a fresh heartbeat.
      if(name==='heartbeat'&&Number.isFinite(result?.serverTime)){
        offset=result.serverTime-(sent+Date.now())/2;
        // Older backends still need the 15-second pulse until their leases are upgraded.
        heartbeatInterval=result.heartbeatInterval===30000?30000:15000;
      }
      return result;
    }catch(error){throw new Error(errorMessage(error),{cause:error});}
  }
  function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const connectionId=randomToken();let population={people:null};
  let pendingHeartbeat=null,refreshConnection=null,closed=false;
  function pulse(){
    if(!pendingHeartbeat)pendingHeartbeat=mutate('heartbeat',{connectionId,pageOrigin:location.origin}).finally(()=>{pendingHeartbeat=null;});
    return pendingHeartbeat;
  }
  const depart=()=>{if(token&&me)navigator.sendBeacon(import.meta.env.VITE_CONVEX_SITE_URL+'/disconnect',JSON.stringify({token,connectionId}));};
  const wake=()=>{if(!closed&&!document.hidden)refreshConnection?.();};
  const restore=event=>{if(event.persisted)wake();};
  window.addEventListener('pagehide',depart);
  window.addEventListener('pageshow',restore);
  window.addEventListener('online',wake);
  document.addEventListener('visibilitychange',wake);
  return {
    get adminEntry(){return !!entryCode;},get me(){return me;},get state(){return state;},now:()=>Date.now()+offset,
    get population(){return {...population};},
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
        if(typeof error?.data==='string'&&/session has ended|Please enter the room again|character is no longer available/.test(error.data)){
          token='';remembered=false;try{localStorage.removeItem(KEY);}catch{}return null;
        }
        throw new Error('The room server could not be reached. Please try again.');
      }
    },
    async entryAppearance(){if(!entryCode)return null;try{return await client.query(api.room.entryAppearance,{entryCode});}catch(error){throw new Error(errorMessage(error));}},
    async checkName(name){try{return await client.query(api.room.checkName,{name,...(entryCode?{entryCode}:{})});}catch(error){throw new Error(errorMessage(error));}},
    async join(name,{_wearables,...look},{appearanceChanged=false}={}){
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
    // lobby switches, world chat and what the player holds; `setZones` adds and drops a
    // presence and furniture subscription per zone as the camera moves. Only nearby
    // zones are live, including a small lookahead for preloading furniture.
    async watch({onState,onError,onMap,onSignals,onFurniture,onPrograms,onJoin,onMessage}){
      try{await pulse();}catch(error){onError(error.message);return;}
      unsubscribe?.();unsubscribeRoom?.();
      const error=e=>onError(errorMessage(e));
      // Recently visited rooms can draw immediately while their live query refreshes.
      // Store only furniture data, never old presence or program state.
      const furnitureCache=new Map(),CACHE_LIMIT=24;
      let queued=false,messages=[],present=null,messageIds=null;
      const emit=()=>{
        if(queued)return;queued=true;
        queueMicrotask(()=>{
          queued=false;if(!me)return;
          const players=new Map();let serverTime=0;
          for(const zone of zones.values()){
            if(zone.presence){serverTime=Math.max(serverTime,zone.presence.serverTime??0);for(const p of zone.presence.players)players.set(p.id,p);}
          }
          players.delete(me.id);
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
        queueMicrotask(()=>{
          furnitureQueued=false;
          // A piece may have moved since its old room was cached. Live placements
          // and inventory take precedence over a cached copy of the same piece.
          const freshIds=new Set([...(inventory??[]),...[...zones.values()].filter(z=>!z.cached).flatMap(z=>z.furniture??[])].map(item=>item.id));
          onFurniture?.({zones:new Map([...zones].filter(([,z])=>z.furniture).map(([id,z])=>[id,z.cached?z.furniture.filter(item=>!freshIds.has(item.id)):z.furniture])),inventory:inventory??[]});
        });
      };
      const stops=[
        client.onUpdate(api.room.worldChatFeed,{token},value=>{
          const previous=messageIds;messageIds=new Set(value.map(message=>message.id));
          messages=value;emit();
          if(previous)for(const message of value){
            if(!previous.has(message.id)&&message.playerId!==me?.id&&Date.now()+offset-message.sentAt<28000)onMessage?.(message);
          }
        },error),
        client.onUpdate(api.room.population,{},value=>{
          population={people:value.people};
          // The first roster is a baseline. Camera changes, heartbeats and extra tabs
          // for an existing player must never sound like a new arrival.
          if(!Array.isArray(value.playerIds))return;
          const next=new Set(value.playerIds),previous=present;present=next;
          if(previous)for(const id of next)if(id!==me?.id&&!previous.has(id))onJoin?.(id);
        },()=>{population={people:null};}),
        client.onUpdate(api.room.me,{token},value=>{me=value;emit();},error),
        client.onUpdate(api.room.roomMap,{token},value=>{room=value;onMap?.(value);},error),
        client.onUpdate(api.room.signals,{},value=>onSignals?.(value),error),
        client.onUpdate(api.room.inventory,{token},value=>{inventory=value;emitFurniture();},error)
      ];
      unsubscribe=()=>{stops.forEach(stop=>stop());for(const id of [...zones.keys()])dropZone(id);};
      unsubscribeRoom=null;
      function addZone(id){
        if(zones.has(id)){const zone=zones.get(id);clearTimeout(zone.release);zone.release=null;return;}
        const cached=furnitureCache.get(id);furnitureCache.delete(id);
        const zone={presence:null,furniture:cached??null,cached:!!cached,programs:null,stopPrograms:null,programEpoch:0,release:null,stops:[]};zones.set(id,zone);
        if(cached)emitFurniture();
        function watchPrograms(items){
          const needed=items.some(item=>item.type.startsWith('asset_'));
          if(needed&&!zone.stopPrograms){
            const epoch=++zone.programEpoch;
            zone.stopPrograms=client.onUpdate(api.programs.list,{zone:id},value=>{
              if(zones.get(id)!==zone||zone.programEpoch!==epoch)return;
              zone.programs=value;emitPrograms();
            },error);
          }else if(!needed){
            zone.programEpoch++;zone.stopPrograms?.();zone.stopPrograms=null;zone.programs=[];emitPrograms();
          }
        }
        zone.stops=[
          client.onUpdate(heartbeatInterval===30000?api.room.livePresence:api.room.presence,{zone:id},value=>{if(zones.get(id)!==zone)return;zone.presence=value;emit();},error),
          client.onUpdate(api.room.zoneFurniture,{token,zone:id},value=>{if(zones.get(id)!==zone)return;zone.furniture=value;zone.cached=false;watchPrograms(value);emitFurniture();},error)
        ];
      }
      function dropZone(id){
        const zone=zones.get(id);if(!zone)return;
        if(zone.furniture){
          furnitureCache.delete(id);furnitureCache.set(id,zone.furniture);
          if(furnitureCache.size>CACHE_LIMIT)furnitureCache.delete(furnitureCache.keys().next().value);
        }
        clearTimeout(zone.release);zone.stopPrograms?.();zone.stops.forEach(stop=>stop());zones.delete(id);emit();emitFurniture();emitPrograms();
      }
      wanted=ids=>{
        const keep=new Set([...ids,...(me?[me.zone]:[])]);
        for(const id of keep)addZone(id);
        // A zone that scrolled out of view lingers a moment, so panning back and forth is free.
        for(const [id,zone] of zones)if(!keep.has(id)&&!zone.release)zone.release=setTimeout(()=>{if(!keep.has(id))dropZone(id);},RELEASE_AFTER);
      };
      // Zones asked for before the room was live are picked up now.
      wanted(lastZones);
      // Sleeping tabs may lose their presence lease. Refresh as soon as they return,
      // and let the transport retry temporary failures without disabling the room.
      refreshConnection=()=>pulse().catch(error=>{
        if(!closed)onError(error.message,{transient:!error.cause?.data});
      });
      clearInterval(heartbeat);heartbeat=setInterval(refreshConnection,heartbeatInterval);
    },
    // Visible and soon-to-be-visible zones; the player's own zone is always included.
    setZones(ids){lastZones=ids;wanted?.(ids);},
    get zones(){return [...zones.keys()];},
    // An appearance by player and version: fetched once, then remembered.
    async look(id,version){
      const key=`${id}:${version}`;
      if(!looks.has(key)){looks.set(key,client.query(api.room.look,{id}).then(value=>{if(!value)throw new Error('That player has left.');return value.look;}).catch(error=>{looks.delete(key);throw error;}));if(looks.size>400)looks.delete(looks.keys().next().value);}
      return looks.get(key);
    },
    appearance:({_wearables=[],...look})=>identityCall('mutation',api.wearables.applyOutfit,{token,look,wearableIds:_wearables.map(w=>w.id)}),
    wearables:{
      list:()=>identityCall('query',api.wearables.list,{token}),
      equip:(slot,wearableId)=>identityCall('mutation',api.wearables.equip,{token,slot,wearableId}),
    },
    activities:{
      watch:(spaceId,receive,onError)=>client.onUpdate(api.activities.list,{token,spaceId},receive,error=>onError(errorMessage(error))),
      create:args=>identityCall('mutation',api.activities.createPlayer,{token,...args}),
      objects:spaceId=>identityCall('query',api.activities.objects,{token,spaceId}),
      control:(activityId,action)=>identityCall('mutation',api.activities.control,{token,activityId,action}),
      play:(activityId,action,args={})=>identityCall('mutation',api.activities.play,{token,activityId,action,...args}),
    },
    async voiceCredentials(tab){try{return await client.action(api.voice.connect,{token,...(tab?{tab}:{})});}catch(error){throw new Error(errorMessage(error));}},
    move:(x,z,seatId,direction=null)=>mutate('move',{x,z,...(seatId?{seatId}:{}),...(direction===null?{}:{direction})}),
    teleport:spaceId=>mutate('teleport',{spaceId}),
    gesture:action=>mutate('gesture',{action}),
    face:playerId=>mutate('face',{playerId}),
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
    homepage:{
      notes:args=>identityCall('query',api.homepage.notes,{token,...args}),
      add:args=>identityCall('mutation',api.homepage.addNote,{token,...args}),
      review:args=>identityCall('mutation',api.homepage.reviewNote,{token,...args}),
    },
    visits:{
      page:before=>client.query(api.visits.page,{token,...(before?{before}:{})}).catch(error=>{throw new Error(errorMessage(error));}),
      watch:(onPage,onError)=>client.onUpdate(api.visits.page,{token},onPage,error=>onError(errorMessage(error))),
    },
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
      signal:(itemId,version,revision,name,data)=>client.mutation(api.programs.signal,{token,itemId,version,revision,name,data}).catch(error=>{throw new Error(errorMessage(error));}),
      save:(itemId,version,revision,state)=>client.mutation(api.programs.save,{token,itemId,version,revision,state}).catch(error=>{throw new Error(errorMessage(error));}),
      interact:itemId=>client.mutation(api.programs.interact,{token,itemId}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    assets:{
      list:()=>client.query(api.assets.list,{}).catch(error=>{throw new Error(errorMessage(error));}),
      watch:(onList,onError)=>client.onUpdate(api.assets.list,{},onList,error=>onError(errorMessage(error))),
    },
    pairing:{
      get code(){return pairingCode;},
      clear(){pairingCode='';try{sessionStorage.removeItem(pairingStorage);}catch{}},
      watch:(onValue,onError)=>client.onUpdate(api.agentPairing.inspect,{token,code:pairingCode},onValue,error=>onError(errorMessage(error))),
      decide:approve=>client.mutation(api.agentPairing.decide,{token,code:pairingCode,approve}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    agents:{
      key:label=>client.mutation(api.agents.createKey,{token,label}).catch(error=>{throw new Error(errorMessage(error));}),
      attached:(onList,onError)=>client.onUpdate(api.agents.attached,{token},onList,error=>onError(errorMessage(error))),
      revoke:()=>client.mutation(api.agents.revoke,{token}).catch(error=>{throw new Error(errorMessage(error));}),
    },
    close(){closed=true;refreshConnection=null;population={people:null};depart();window.removeEventListener('pagehide',depart);window.removeEventListener('pageshow',restore);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);unsubscribe?.();unsubscribeRoom?.();clearInterval(heartbeat);client.close();},
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
