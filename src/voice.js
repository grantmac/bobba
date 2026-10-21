export function createVoice({credentials,onState=()=>{},loadSDK=()=>import('livekit-client')}){
  const panel=document.createElement('section');panel.className='voice-panel';panel.hidden=true;panel.setAttribute('aria-label','Voice chat');
  panel.innerHTML='<header><strong>Voice chat</strong><button type="button" aria-label="Close voice chat">×</button></header><p class="voice-status" role="status">Join to listen. Your microphone starts off.</p><div class="voice-controls"><button type="button" data-voice="join">Join voice</button><button type="button" data-voice="mic" hidden>Turn mic on</button><button type="button" data-voice="audio" hidden>Enable sound</button><button type="button" data-voice="leave" hidden>Leave voice</button></div><ul aria-label="People in voice"></ul>';
  const audioRoot=document.createElement('div');audioRoot.hidden=true;document.body.append(panel,audioRoot);
  const button=kind=>panel.querySelector(`[data-voice="${kind}"]`),status=panel.querySelector('.voice-status');
  const rows=new Map(),muted=new Set(),markers=new Map(),audio=new Map();
  let room=null,generation=0,phase='idle',micBusy=false,message='',players=new Map(),sdk=null;
  const speaking=new Set();
  function updateSpeakers(participants=[]){
    speaking.clear();participants.forEach(p=>speaking.add(p.identity));
    for(const [id,marker] of markers)if(!speaking.has(id)){marker.remove();markers.delete(id);}
    for(const id of speaking)if(!markers.has(id)){
      const marker=document.createElement('span');marker.className='voice-speaking';marker.textContent='♫';marker.setAttribute('aria-hidden','true');document.body.append(marker);markers.set(id,marker);
    }
    for(const [id,row] of rows)row.element.classList.toggle('is-speaking',speaking.has(id));
  }
  function update(){
    const connected=phase==='connected',busy=phase==='connecting'||phase==='reconnecting';
    button('join').hidden=connected||phase==='reconnecting';button('join').disabled=busy;button('join').textContent=busy?'Connecting…':'Join voice';
    button('mic').hidden=!connected;button('mic').disabled=micBusy;
    const microphone=!!room?.localParticipant.isMicrophoneEnabled;
    button('mic').textContent=microphone?'Mute mic':'Turn mic on';button('mic').setAttribute('aria-pressed',String(microphone));
    button('leave').hidden=phase==='idle';button('leave').textContent=phase==='connecting'?'Cancel':'Leave voice';
    button('audio').hidden=!connected||room?.canPlaybackAudio!==false;
    status.textContent=message||(phase==='reconnecting'?'Reconnecting…':connected?(microphone?'Your microphone is on.':'Listening · microphone off.'):busy?'Connecting to voice…':'Join to listen. Your microphone starts off.');
    const participants=room&&connected?[room.localParticipant,...room.remoteParticipants.values()]:[];
    const ids=new Set(participants.map(p=>p.identity));
    for(const [id,row] of rows)if(!ids.has(id)){row.element.remove();rows.delete(id);}
    for(const participant of participants){
      const id=participant.identity,self=participant===room.localParticipant;
      let row=rows.get(id);
      if(!row){
        const element=document.createElement('li'),name=document.createElement('span'),control=document.createElement('button');control.type='button';
        element.append(name,control);panel.querySelector('ul').append(element);row={element,name,control};rows.set(id,row);
        control.onclick=()=>{if(muted.has(id))muted.delete(id);else muted.add(id);room?.remoteParticipants.get(id)?.setVolume(muted.has(id)?0:1);update();};
      }
      const name=players.get(id)?.name??'Visitor';
      row.name.textContent=`${name}${self?' (you)':''}${participant.isMicrophoneEnabled?'':' · mic off'}`;
      row.element.classList.toggle('is-speaking',speaking.has(id));row.control.hidden=self;
      row.control.textContent=muted.has(id)?'Unmute':'Mute';row.control.setAttribute('aria-label',`${muted.has(id)?'Unmute':'Mute'} ${name} for me`);row.control.setAttribute('aria-pressed',String(muted.has(id)));
    }
    onState({connected,microphone,phase});
  }
  function detach(track){const element=audio.get(track);if(element){track.detach(element);element.remove();audio.delete(track);}}
  function clean(){for(const track of [...audio.keys()])detach(track);updateSpeakers();muted.clear();}
  function leave(){
    generation++;const old=room;room=null;phase='idle';micBusy=false;message='';clean();update();
    // LiveKit disconnect stops local capture, including pending microphone tracks.
    if(old)void old.disconnect().catch(()=>{});
  }
  async function join(){
    if(phase!=='idle')return;
    const attempt=++generation;phase='connecting';message='';update();let candidate;
    try{
      const [loaded,access]=await Promise.all([loadSDK(),credentials()]);
      if(attempt!==generation)return;sdk=loaded;
      candidate=new sdk.Room({audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},disconnectOnPageLeave:true});room=candidate;
      const current=()=>room===candidate&&attempt===generation;
      candidate.on(sdk.RoomEvent.TrackSubscribed,(track,_publication,participant)=>{
        if(!current()||track.kind!==sdk.Track.Kind.Audio)return;
        const element=track.attach();element.setAttribute('playsinline','');audioRoot.append(element);audio.set(track,element);
        participant.setVolume(muted.has(participant.identity)?0:1);
      });
      candidate.on(sdk.RoomEvent.TrackUnsubscribed,track=>detach(track));
      candidate.on(sdk.RoomEvent.ActiveSpeakersChanged,participants=>{if(current())updateSpeakers(participants);});
      for(const event of [sdk.RoomEvent.ParticipantConnected,sdk.RoomEvent.ParticipantDisconnected,sdk.RoomEvent.TrackMuted,sdk.RoomEvent.TrackUnmuted,sdk.RoomEvent.LocalTrackPublished,sdk.RoomEvent.LocalTrackUnpublished,sdk.RoomEvent.AudioPlaybackStatusChanged])candidate.on(event,()=>{if(current()){updateSpeakers(candidate.activeSpeakers);update();}});
      candidate.on(sdk.RoomEvent.Reconnecting,()=>{if(current()){phase='reconnecting';updateSpeakers();update();}});
      candidate.on(sdk.RoomEvent.Reconnected,()=>{if(current()){phase='connected';message='';update();}});
      candidate.on(sdk.RoomEvent.Disconnected,()=>{if(current()){leave();message='Voice disconnected. You can join again.';update();}});
      await candidate.connect(access.url,access.token,{autoSubscribe:true});
      if(!current()){await candidate.disconnect();return;}
      phase='connected';update();
      try{await candidate.startAudio();}catch{/* The Enable sound button handles browser playback restrictions. */}
      if(current())update();
    }catch(error){
      if(attempt!==generation){if(candidate)await candidate.disconnect().catch(()=>{});return;}
      leave();message=candidate?'Could not connect to voice. Please try again.':error.message||'Could not connect to voice.';update();
    }
  }
  async function toggleMicrophone(){
    if(phase!=='connected'||micBusy)return;
    const active=room;micBusy=true;message='';update();
    try{await active.localParticipant.setMicrophoneEnabled(!active.localParticipant.isMicrophoneEnabled);}
    catch(error){if(room===active)message=error.name==='NotAllowedError'?'Microphone access was blocked. Allow it in your browser to speak.':error.name==='NotFoundError'?'No microphone was found. You can still listen.':'Could not start the microphone. You can still listen.';}
    finally{
      if(room===active){micBusy=false;update();}
      else await active.localParticipant.setMicrophoneEnabled(false).catch(()=>{});
    }
  }
  panel.querySelector('header button').onclick=()=>{panel.hidden=true;};
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){panel.hidden=true;event.stopPropagation();}});
  button('join').onclick=join;button('mic').onclick=toggleMicrophone;button('leave').onclick=leave;
  button('audio').onclick=async()=>{try{await room?.startAudio();message='';}catch{message='Sound could not start. Please try again.';}update();};
  window.addEventListener('pagehide',leave);
  update();
  return {open(){panel.hidden=!panel.hidden;},leave,
    syncPlayers(next){players=new Map(next.map(p=>[p.id,p]));update();},
    positionSpeaker(id,x,y,visible=true){const marker=markers.get(id);if(marker){marker.style.left=`${x}px`;marker.style.top=`${y}px`;marker.hidden=!visible;}},
  };
}
