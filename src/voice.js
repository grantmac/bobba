import {makeDraggable} from './draggable.js';
// Remote voices play through LiveKit's Web Audio mix so they can be boosted past an audio
// element's ceiling; a compressor ahead of the gain keeps loud talkers from clipping.
const VOICE_GAIN=2.5;
// Voice is always on: after a drop or a failed connection the call rejoins by itself,
// backing off to a slow retry rather than ever giving up.
const RETRY_DELAYS=[1500,3000,6000,10000,15000,30000,60000];
// LiveKit identities are the player id plus a per-tab tag (see convex/voice.js).
const playerIdOf=participant=>participant.identity.split('#')[0];
export function createVoice({credentials,onState=()=>{},onSpeaking=()=>{},loadSDK=()=>import('livekit-client'),createAudioContext=()=>new AudioContext()}){
  let audioContext=null;
  const tab=Math.random().toString(36).slice(2,10);
  const panel=document.createElement('section');panel.className='voice-panel';panel.hidden=true;panel.setAttribute('aria-label','Voice chat');
  panel.innerHTML='<header><h1>Voice chat</h1><button type="button" class="appearance-close" aria-label="Close voice chat">×</button></header><div class="voice-body"><p class="voice-status" role="status">Connecting to voice…</p><div class="voice-controls"><button type="button" data-voice="mic" disabled>Turn mic on</button><button type="button" data-voice="audio" hidden>Enable sound</button></div><ul aria-label="People in voice"></ul></div>';
  const audioRoot=document.createElement('div');audioRoot.hidden=true;document.body.append(panel,audioRoot);makeDraggable(panel);
  const button=kind=>panel.querySelector(`[data-voice="${kind}"]`),status=panel.querySelector('.voice-status');
  const rows=new Map(),muted=new Set(),markers=new Map(),audio=new Map();
  // `enabled` is whether this page should be on the call at all; `wantMic` survives reconnects.
  let room=null,generation=0,phase='idle',micBusy=false,message='',players=new Map(),sdk=null,joinTimeout=null;
  let enabled=false,wantMic=false,retryTimer=null,retryPending=false,retryCount=0,retryOnVisible=null;
  const speaking=new Set();
  function updateSpeakers(participants=[]){
    speaking.clear();participants.filter(p=>p.isMicrophoneEnabled).forEach(p=>speaking.add(playerIdOf(p)));
    onSpeaking(participants.some(p=>p.isMicrophoneEnabled&&p!==room?.localParticipant));
    for(const [id,marker] of markers)if(!speaking.has(id)){marker.remove();markers.delete(id);}
    for(const id of speaking)if(!markers.has(id)){
      const marker=document.createElement('span');marker.className='voice-speaking';marker.innerHTML='<i></i><i></i><i></i>';marker.setAttribute('aria-hidden','true');document.body.append(marker);markers.set(id,marker);
    }
    for(const [id,row] of rows)row.element.classList.toggle('is-speaking',speaking.has(id));
  }
  function participantsOf(id){return [...(room?.remoteParticipants.values()??[])].filter(p=>playerIdOf(p)===id);}
  function update(){
    const connected=phase==='connected',busy=phase==='connecting'||phase==='reconnecting';
    const microphone=!!room?.localParticipant.isMicrophoneEnabled;
    button('mic').disabled=!connected||micBusy;
    button('mic').textContent=microphone?'Mute mic':'Turn mic on';button('mic').setAttribute('aria-pressed',String(microphone));
    button('audio').hidden=!connected||room?.canPlaybackAudio!==false;
    const blocked=connected&&room?.canPlaybackAudio===false;
    status.textContent=message||(phase==='reconnecting'?'Reconnecting…':blocked?'Tap anywhere to hear voice.':connected?(microphone?'Your microphone is on.':'Listening · microphone off. Turn your mic on to talk.'):busy?'Connecting to voice…':retryPending?'Voice dropped. Reconnecting…':'Voice is off.');
    const participants=room&&connected?[room.localParticipant,...room.remoteParticipants.values()]:[];
    const ids=new Set(participants.map(playerIdOf));
    for(const [id,row] of rows)if(!ids.has(id)){row.element.remove();rows.delete(id);}
    for(const participant of participants){
      const id=playerIdOf(participant),self=participant===room.localParticipant;
      if(rows.has(id)&&!self&&rows.get(id).self)continue;
      let row=rows.get(id);
      if(!row){
        const element=document.createElement('li'),name=document.createElement('span'),control=document.createElement('button');control.type='button';
        element.append(name,control);panel.querySelector('ul').append(element);row={element,name,control,self};rows.set(id,row);
        control.onclick=()=>{if(muted.has(id))muted.delete(id);else muted.add(id);for(const p of participantsOf(id))p.setVolume(muted.has(id)?0:VOICE_GAIN);update();};
      }
      const name=players.get(id)?.name??'Visitor';
      row.name.textContent=`${name}${self?' (you)':''}${participant.isMicrophoneEnabled?'':' · mic off'}`;
      row.element.classList.toggle('is-speaking',speaking.has(id));row.control.hidden=self;
      row.control.textContent=muted.has(id)?'Unmute':'Mute';row.control.setAttribute('aria-label',`${muted.has(id)?'Unmute':'Mute'} ${name} for me`);row.control.setAttribute('aria-pressed',String(muted.has(id)));
    }
    onState({connected,microphone,phase,blocked});
  }
  function detach(track){const element=audio.get(track);if(element){track.detach(element);element.remove();audio.delete(track);}}
  function clean(){for(const track of [...audio.keys()])detach(track);updateSpeakers();}
  function cancelRetry(){
    clearTimeout(retryTimer);retryTimer=null;retryPending=false;
    if(retryOnVisible){document.removeEventListener('visibilitychange',retryOnVisible);retryOnVisible=null;}
  }
  // Tear down the current connection; the call comes back only through connect().
  function disconnect(){
    clearTimeout(joinTimeout);joinTimeout=null;
    generation++;const old=room;room=null;phase='idle';micBusy=false;clean();
    // LiveKit disconnect stops local capture, including pending microphone tracks.
    if(old)void old.disconnect().catch(()=>{});
  }
  function leave(){enabled=false;cancelRetry();disconnect();message='';update();}
  // Try again after a growing pause; a hidden tab waits until it is visible instead.
  function scheduleRetry(){
    if(!enabled||retryPending)return;retryPending=true;
    const delay=RETRY_DELAYS[Math.min(retryCount++,RETRY_DELAYS.length-1)];
    const attempt=()=>{cancelRetry();void connect();};
    if(document.hidden){retryOnVisible=()=>{if(!document.hidden)attempt();};document.addEventListener('visibilitychange',retryOnVisible);}
    else retryTimer=setTimeout(attempt,delay);
    update();
  }
  async function connect(){
    if(!enabled||phase!=='idle')return;
    cancelRetry();
    const attempt=++generation;phase='connecting';update();let candidate;
    joinTimeout=setTimeout(()=>{
      if(attempt!==generation)return;
      disconnect();message='Voice could not connect. Retrying… (Chrome works best.)';scheduleRetry();update();
    },25000);
    try{
      const [loaded,access]=await Promise.all([loadSDK(),credentials(tab)]);
      if(attempt!==generation)return;sdk=loaded;
      // The context is kept for the page's life; LiveKit resumes it after the first gesture.
      audioContext??=createAudioContext();
      candidate=new sdk.Room({audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},disconnectOnPageLeave:true,webAudioMix:{audioContext}});room=candidate;
      const current=()=>room===candidate&&attempt===generation;
      candidate.on(sdk.RoomEvent.TrackSubscribed,(track,_publication,participant)=>{
        if(!current()||track.kind!==sdk.Track.Kind.Audio)return;
        const element=track.attach();element.setAttribute('playsinline','');audioRoot.append(element);audio.set(track,element);
        if(typeof track.setWebAudioPlugins==='function'){
          const compressor=audioContext.createDynamicsCompressor();
          compressor.threshold.value=-18;compressor.knee.value=12;compressor.ratio.value=6;compressor.attack.value=.003;compressor.release.value=.2;
          track.setWebAudioPlugins([compressor]);
        }
        participant.setVolume(muted.has(playerIdOf(participant))?0:VOICE_GAIN);
      });
      candidate.on(sdk.RoomEvent.TrackUnsubscribed,track=>detach(track));
      candidate.on(sdk.RoomEvent.ActiveSpeakersChanged,participants=>{if(current())updateSpeakers(participants);});
      for(const event of [sdk.RoomEvent.ParticipantConnected,sdk.RoomEvent.ParticipantDisconnected,sdk.RoomEvent.TrackMuted,sdk.RoomEvent.TrackUnmuted,sdk.RoomEvent.LocalTrackPublished,sdk.RoomEvent.LocalTrackUnpublished,sdk.RoomEvent.AudioPlaybackStatusChanged])candidate.on(event,()=>{if(current()){updateSpeakers(candidate.activeSpeakers);update();}});
      candidate.on(sdk.RoomEvent.Reconnecting,()=>{if(current()){phase='reconnecting';updateSpeakers();update();}});
      candidate.on(sdk.RoomEvent.Reconnected,()=>{if(current()){phase='connected';message='';update();}});
      // The SDK gave up on its own reconnects (or the server dropped us): come straight back.
      candidate.on(sdk.RoomEvent.Disconnected,reason=>{
        if(!current())return;
        wantMic=!!candidate.localParticipant.isMicrophoneEnabled||wantMic;
        disconnect();message='';
        if(reason!==undefined&&reason===sdk.DisconnectReason?.DUPLICATE_IDENTITY)message='Voice moved to a newer tab of this room.';
        scheduleRetry();update();
      });
      await candidate.connect(access.url,access.token,{autoSubscribe:true});
      if(!current()){await candidate.disconnect();return;}
      clearTimeout(joinTimeout);joinTimeout=null;phase='connected';message='';retryCount=0;update();
      // Browsers only allow playback after a gesture: when it is blocked, the next tap or key anywhere unlocks it.
      const unlock=async()=>{if(!current()||candidate.canPlaybackAudio)return;try{await candidate.startAudio();}catch{}if(current())update();};
      candidate.on(sdk.RoomEvent.AudioPlaybackStatusChanged,()=>{if(current()&&!candidate.canPlaybackAudio){document.addEventListener('pointerdown',unlock,{once:true,capture:true});document.addEventListener('keydown',unlock,{once:true,capture:true});}});
      if(wantMic)await setMicrophone(true);
      if(!current())return;
      try{await candidate.startAudio();}catch{/* The Enable sound button handles browser playback restrictions. */}
      if(current())update();
    }catch(error){
      if(attempt!==generation){if(candidate)await candidate.disconnect().catch(()=>{});return;}
      disconnect();message=candidate?'Voice could not connect. Retrying…':`${error.message||'Voice could not connect.'} Retrying…`;scheduleRetry();update();
    }
  }
  async function setMicrophone(on){
    if(phase!=='connected'||micBusy)return;
    const active=room;micBusy=true;message='';update();
    try{await active.localParticipant.setMicrophoneEnabled(on);if(room===active)wantMic=on;}
    catch(error){if(room===active){wantMic=false;message=error.name==='NotAllowedError'?'Microphone access was blocked. Allow it in your browser to speak.':error.name==='NotFoundError'?'No microphone was found. You can still listen.':'Could not start the microphone. You can still listen.';}}
    finally{
      if(room===active){micBusy=false;update();}
      else await active.localParticipant.setMicrophoneEnabled(false).catch(()=>{});
    }
  }
  panel.querySelector('header button').onclick=()=>{panel.hidden=true;};
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;event.stopPropagation();}});
  button('mic').onclick=()=>setMicrophone(!room?.localParticipant.isMicrophoneEnabled);
  button('audio').onclick=async()=>{try{await room?.startAudio();message='';}catch{message='Sound could not start. Please try again.';}update();};
  window.addEventListener('pagehide',leave);
  update();
  return {open(){panel.hidden=!panel.hidden;},leave,
    // Everyone in the room is on the call from the moment they are in; the mic stays opt-in.
    listen(){enabled=true;retryCount=0;return connect();},
    get busy(){return phase==='connecting'||phase==='reconnecting'||micBusy;},
    snapshot(){return {connected:enabled,microphone:wantMic,mutedIds:[...muted]};},
    async restore(state){
      muted.clear();for(const id of Array.isArray(state?.mutedIds)?state.mutedIds.filter(id=>typeof id==='string'):[])muted.add(id);
      wantMic=state?.microphone===true;enabled=true;retryCount=0;await connect();
    },
    syncPlayers(next){players=new Map(next.map(p=>[p.id,p]));update();},
    positionSpeaker(id,x,y,visible=true){const marker=markers.get(id);if(marker){marker.style.left=`${x}px`;marker.style.top=`${y}px`;marker.hidden=!visible;}},
  };
}
