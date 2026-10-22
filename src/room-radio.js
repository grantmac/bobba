// Public Poolsuite ON AIR endpoint used by https://poolsuite.net/.
export const POOLSUITE_STREAM='https://s5.radio.co/sc9cb59935/listen';
// While someone has their mic on the music ducks to this share of its level, easing down
// quickly and back up slowly, with a short hold so it does not pump between words.
const DUCK_LEVEL=.08,DUCK_HOLD=900;
export function createRoomRadio({audio=new Audio(),onState=()=>{},now=()=>performance.now(),schedule=fn=>requestAnimationFrame(fn)}={}){
  audio.preload='none';
  let active=false,muted=false,pending=false,generation=0,playing=false,level=.7875,ducked=false,duckFactor=1,duckTimer=null,easing=false;
  const applyVolume=()=>{
    // iOS ignores programmatic volume changes, so zero must also mute the element.
    audio.muted=muted||level===0;
    audio.volume=Math.max(0,Math.min(1,level*duckFactor));
  };
  applyVolume();
  const emit=()=>onState({active,muted,playing,volume:level});
  function ease(){
    const target=ducked?DUCK_LEVEL:1,step=ducked?.12:.03;
    duckFactor=duckFactor>target?Math.max(target,duckFactor-step):Math.min(target,duckFactor+step);
    applyVolume();
    if(duckFactor!==target)schedule(ease);else easing=false;
  }
  function setDucked(value){
    if(value===ducked)return;ducked=value;
    if(!easing){easing=true;schedule(ease);}
  }
  function stop(){generation++;pending=false;playing=false;audio.pause();audio.removeAttribute('src');audio.load();}
  async function play(){
    if(!active||muted||pending||playing)return;
    const attempt=++generation;pending=true;
    // A fresh connection rejoins the live broadcast instead of buffered audio.
    if(!audio.src)audio.src=POOLSUITE_STREAM;
    try{await audio.play();if(attempt===generation)playing=true;}
    catch{if(attempt===generation)playing=false;}
    finally{if(attempt===generation){pending=false;emit();}}
  }
  for(const event of ['error','ended'])audio.addEventListener(event,()=>{stop();emit();});
  return {
    snapshot:()=>({muted,volume:level}),
    restore(state){if(!state)return;muted=state.muted===true;if(Number.isFinite(state.volume))level=Math.max(0,Math.min(1,state.volume));applyVolume();emit();},
    receive(musicOn,joined){
      const next=joined&&musicOn===true;
      if(next===active)return;active=next;if(active)void play();else stop();emit();
    },
    unlock:play,
    setMuted(value){muted=value;applyVolume();if(muted)stop();else void play();emit();},
    setVolume(value){level=Math.max(0,Math.min(1,value));applyVolume();emit();},
    // Voice activity: duck at once, release after a hold.
    duck(speaking){clearTimeout(duckTimer);duckTimer=null;if(speaking)setDucked(true);else duckTimer=setTimeout(()=>setDucked(false),DUCK_HOLD);},
    get ducked(){return ducked;},
    get audible(){return active&&playing&&!muted&&level>0&&!audio.paused&&audio.readyState>=3;},
    close(){active=false;stop();emit();}
  };
}
