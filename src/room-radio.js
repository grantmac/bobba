// Public Poolsuite ON AIR endpoint used by https://poolsuite.net/.
export const POOLSUITE_STREAM='https://s5.radio.co/sc9cb59935/listen';
export function createRoomRadio({audio=new Audio(),onState=()=>{}}={}){
  audio.preload='none';audio.volume=.7875;
  let active=false,muted=false,pending=false,generation=0,playing=false;
  const emit=()=>onState({active,muted,playing,volume:audio.volume});
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
    snapshot:()=>({muted,volume:audio.volume}),
    restore(state){if(!state)return;muted=state.muted===true;if(Number.isFinite(state.volume))audio.volume=Math.max(0,Math.min(1,state.volume));emit();},
    receive(items,joined){
      const next=joined&&items.some(item=>item.type==='custom_dj_decks'&&Number.isInteger(item.x)&&Number.isInteger(item.z)&&item.on!==false);
      if(next===active)return;active=next;if(active)void play();else stop();emit();
    },
    unlock:play,
    setMuted(value){muted=value;if(muted)stop();else void play();emit();},
    setVolume(value){audio.volume=Math.max(0,Math.min(1,value));emit();},
    close(){active=false;stop();emit();}
  };
}
