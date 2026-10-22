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
  let token='',me=null,state=null,room=null,unsubscribe=null,unsubscribeRoom=null,unsubscribePong=null,heartbeat=null,offset=0;
  try{token=localStorage.getItem(KEY)||'';}catch{}
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
    async resume(){if(entryCode||!token)return null;try{me=await client.query(api.room.me,{token});return me;}catch(error){if(error?.data){token='';try{localStorage.removeItem(KEY);}catch{}return null;}throw new Error('The room server could not be reached. Please try again.');}},
    async entryAppearance(){if(!entryCode)return null;try{return await client.query(api.room.entryAppearance,{entryCode});}catch(error){throw new Error(errorMessage(error));}},
    async checkName(name){try{return await client.query(api.room.checkName,{name,...(entryCode?{entryCode}:{})});}catch(error){throw new Error(errorMessage(error));}},
    async join(name,look,{appearanceChanged=false}={}){
      if(!token||entryCode)token=randomToken();
      try{me=await client.mutation(api.room.join,{token,name,look,pageOrigin:location.origin,...(entryCode?{entryCode,replaceLook:appearanceChanged}:{})});}catch(error){throw new Error(errorMessage(error));}
      entryCode='';try{localStorage.setItem(KEY,token);}catch{}return me;
    },
    async loadPreview(){const value=await client.query(api.room.preview,{});offset=value.serverTime-Date.now();return value;},
    preview(onState,onError){
      let presence=null,scene=null;const error=e=>onError(errorMessage(e));
      const emit=()=>{if(presence&&scene)onState({...presence,room:scene});};
      const stops=[client.onUpdate(api.room.presence,{},value=>{presence=value;emit();},error),client.onUpdate(api.room.scene,{},value=>{scene=value;emit();},error)];
      return ()=>stops.forEach(stop=>stop());
    },
    async watch(onState,onError,onRoom,onPong){
      try{await mutate('heartbeat',{connectionId,pageOrigin:location.origin});}catch(error){onError(error.message);return;}
      unsubscribe?.();unsubscribeRoom?.();
      let presence=null,messages=null;const error=e=>onError(errorMessage(e));
      const emit=()=>{
        if(!presence||messages===null)return;
        me=presence.players.find(p=>p.id===me.id)??me;
        state={...presence,me,messages};onState(state);
      };
      const stops=[
        client.onUpdate(api.room.session,{token},()=>{},error),
        client.onUpdate(api.room.presence,{},value=>{presence=value;emit();},error),
        client.onUpdate(api.room.chatFeed,{token},value=>{messages=value;emit();},error)
      ];
      unsubscribe=()=>stops.forEach(stop=>stop());
      unsubscribePong?.();unsubscribePong=client.onUpdate(api.pong.state,{},value=>onPong?.(value),error);
      unsubscribeRoom=client.onUpdate(api.room.roomState,{token},value=>{room=value;onRoom?.(value);},error);
      clearInterval(heartbeat);heartbeat=setInterval(()=>mutate('heartbeat',{connectionId,pageOrigin:location.origin}).catch(error=>onError(error.message)),15000);
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
    typing:typing=>mutate('setTyping',{typing}),
    furniture:items=>mutate('setFurniture',{items,revision:room.revision,knowsAssets:true}),
    options:options=>mutate('setOptions',{options,revision:room.revision}),
    danceFloor:on=>mutate('setDanceFloor',{on}),
    deckPower:(id,on)=>mutate('setDeckPower',{id,on}),
    createSticky:(id,position,poster)=>mutate('createSticky',{id,position,...(poster?{poster}:{})}),
    editSticky:note=>mutate('editSticky',note),
    appendSticky:(id,text)=>mutate('appendSticky',{id,text}),
    deleteSticky:(id,revision)=>mutate('deleteSticky',{id,revision}),
    seed:(options,items)=>mutate('seed',{options,items}),
    // Player-built catalogue pieces, live: a new piece reaches every open room at once.
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
