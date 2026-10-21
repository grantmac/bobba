const SESSION_KEY='habbo-room-update-v1';
export function saveUpdateSession(state,storage=sessionStorage,now=Date.now()){
  try{storage.setItem(SESSION_KEY,JSON.stringify({...state,savedAt:now}));}catch{}
}
export function takeUpdateSession(playerId,storage=sessionStorage,now=Date.now()){
  try{
    const value=storage.getItem(SESSION_KEY);storage.removeItem(SESSION_KEY);
    const state=JSON.parse(value);
    return state?.playerId===playerId&&Number.isFinite(state.savedAt)&&now-state.savedAt>=0&&now-state.savedAt<120000?state:null;
  }catch{return null;}
}
export function installAutoUpdate({version,canReload=()=>true,beforeReload=()=>{},reload=()=>location.reload(),
  fetchVersion=async()=>{const response=await fetch('/version.json',{cache:'no-store'});if(!response.ok)throw Error('Version unavailable');return (await response.json()).version;},
  visible=()=>document.visibilityState==='visible',events=window,visibilityEvents=document,interval=30000}){
  let stopped=false,checking=false,reloading=false,pending=false,retry;
  function refresh(){
    if(stopped||reloading||!pending||!visible())return;
    if(!canReload()){clearTimeout(retry);retry=setTimeout(refresh,2000);return;}
    beforeReload();reloading=true;stop();reload();
  }
  async function check(){
    if(stopped||checking||!visible())return;
    if(pending){refresh();return;}
    checking=true;
    try{
      const latest=await fetchVersion();
      if(!stopped&&typeof latest==='string'&&latest.length>0&&latest.length<128&&latest!==version){pending=true;refresh();}
    }catch{/* Offline or failed deploy checks leave the current room running. */}
    finally{checking=false;}
  }
  function stop(){stopped=true;clearInterval(timer);clearTimeout(retry);events.removeEventListener('online',check);events.removeEventListener('pageshow',check);visibilityEvents.removeEventListener('visibilitychange',check);}
  const timer=setInterval(check,interval);
  events.addEventListener('online',check);events.addEventListener('pageshow',check);visibilityEvents.addEventListener('visibilitychange',check);
  void check();
  return {check,stop};
}
