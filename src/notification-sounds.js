// Schedule on the audio clock, not animation frames or timers: hidden tabs still chime.
export function createNotificationSounds({createContext=()=>new (window.AudioContext||window.webkitAudioContext)(),storage}={}){
  const key='habbo-room-notifications-muted',active=new Set();
  let context=null,nextAt=0,muted=false;
  try{storage??=globalThis.localStorage;muted=storage?.getItem(key)==='true';}catch{}
  async function unlock(){
    try{
      context??=createContext();
      if(context.state!=='running')await context.resume();
    }catch{} // A later user gesture can retry if the browser blocked audio.
  }
  async function play(kind='join'){
    if(!context||muted)return; // Never replay notifications missed before the first user gesture.
    const audio=context,receivedAt=Date.now();
    try{
      if(audio.state!=='running')await audio.resume();
      if(audio!==context||muted||audio.state!=='running'||Date.now()-receivedAt>2000)return;
      const start=Math.max(audio.currentTime,nextAt);nextAt=start+.5;
      for(const [offset,frequency] of kind==='message'?[[0,523.25]]:[[0,659.25],[.14,880]]){
        const oscillator=audio.createOscillator(),gain=audio.createGain(),at=start+offset;
        oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,at);
        gain.gain.setValueAtTime(0,at);
        gain.gain.linearRampToValueAtTime(.12,at+.012);
        gain.gain.exponentialRampToValueAtTime(.001,at+.32);
        oscillator.connect(gain);gain.connect(audio.destination);
        active.add(oscillator);
        oscillator.onended=()=>{active.delete(oscillator);oscillator.disconnect();gain.disconnect();};
        oscillator.start(at);oscillator.stop(at+.34);
      }
    }catch{} // A browser audio interruption must not interrupt presence updates.
  }
  function setMuted(value){
    muted=!!value;try{storage?.setItem(key,String(muted));}catch{}
    if(muted){for(const oscillator of active)oscillator.stop();active.clear();nextAt=0;}
  }
  function close(){const audio=context;context=null;active.clear();nextAt=0;if(audio)void audio.close().catch(()=>{});}
  return {unlock,play,close,setMuted,get muted(){return muted;}};
}
