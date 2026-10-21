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
  let token='',me=null,state=null,unsubscribe=null,heartbeat=null,offset=0;
  try{token=localStorage.getItem(KEY)||'';}catch{}
  function errorMessage(error){return typeof error?.data==='string'?error.data:error?.message?.replace(/\[CONVEX[^\]]*\]\s*/,'').split('\n')[0]||'The room could not be reached.';}
  async function mutate(name,args={}){try{return await client.mutation(api.room[name],{token,...args});}catch(error){throw new Error(errorMessage(error));}}
  function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
  const connectionId=randomToken();
  const depart=()=>{if(token&&me)navigator.sendBeacon(import.meta.env.VITE_CONVEX_SITE_URL+'/disconnect',JSON.stringify({token,connectionId}));};
  window.addEventListener('pagehide',depart);
  window.addEventListener('pageshow',event=>{if(event.persisted&&me)mutate('heartbeat',{connectionId,pageOrigin:location.origin}).catch(()=>{});});
  return {
    get adminEntry(){return !!entryCode;},get me(){return me;},get state(){return state;},now:()=>Date.now()+offset,
    async resume(){if(entryCode||!token)return null;try{me=await client.query(api.room.me,{token});return me;}catch(error){if(error?.data){token='';try{localStorage.removeItem(KEY);}catch{}return null;}throw new Error('The room server could not be reached. Please try again.');}},
    async entryAppearance(){if(!entryCode)return null;try{return await client.query(api.room.entryAppearance,{entryCode});}catch(error){throw new Error(errorMessage(error));}},
    async join(name,look,{appearanceChanged=false}={}){
      if(!token||entryCode)token=randomToken();
      try{me=await client.mutation(api.room.join,{token,name,look,pageOrigin:location.origin,...(entryCode?{entryCode,replaceLook:appearanceChanged}:{})});}catch(error){throw new Error(errorMessage(error));}
      entryCode='';try{localStorage.setItem(KEY,token);}catch{}return me;
    },
    loadPreview:()=>client.query(api.room.preview,{}),
    preview(onState,onError){return client.onUpdate(api.room.preview,{},value=>{offset=value.serverTime-Date.now();onState(value);},error=>onError(errorMessage(error)));},
    async watch(onState,onError){
      try{await mutate('heartbeat',{connectionId,pageOrigin:location.origin});}catch(error){onError(error.message);return;}
      unsubscribe?.();unsubscribe=client.onUpdate(api.room.state,{token},value=>{state=value;me=value.me;offset=value.serverTime-Date.now();onState(value);},error=>onError(errorMessage(error)));
      clearInterval(heartbeat);heartbeat=setInterval(()=>mutate('heartbeat',{connectionId,pageOrigin:location.origin}).catch(error=>onError(error.message)),15000);
    },
    appearance:look=>mutate('appearance',{look}),
    async voiceCredentials(){try{return await client.action(api.voice.connect,{token});}catch(error){throw new Error(errorMessage(error));}},
    move:(x,z,seatId)=>mutate('move',{x,z,...(seatId?{seatId}:{})}),
    gesture:action=>mutate('gesture',{action}),
    chat:(body,mode)=>mutate('chat',{body,mode}),
    furniture:items=>mutate('setFurniture',{items,revision:state.room.revision}),
    options:options=>mutate('setOptions',{options,revision:state.room.revision}),
    danceFloor:on=>mutate('setDanceFloor',{on}),
    createSticky:(id,position,poster)=>mutate('createSticky',{id,position,...(poster?{poster}:{})}),
    editSticky:note=>mutate('editSticky',note),
    appendSticky:(id,text)=>mutate('appendSticky',{id,text}),
    deleteSticky:(id,revision)=>mutate('deleteSticky',{id,revision}),
    seed:(options,items)=>mutate('seed',{options,items}),
    close(){depart();window.removeEventListener('pagehide',depart);unsubscribe?.();clearInterval(heartbeat);client.close();},
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
