export function createToolbar({onRoomEdit,onFurniture,onChat,onTyping,onVoice,onAppearance,onGesture,admin=true}) {
  const bar=document.createElement('div');bar.className='room-toolbar';
  bar.innerHTML=`<form class="room-chat">
    <div class="speech-picker"><button type="button" id="speech-mode" aria-label="Speech mode: Say" aria-haspopup="menu" aria-expanded="false"><span>Say</span><img src="/assets/bar/dropdown-arrow.png" alt=""></button>
    <div class="speech-menu" role="menu" aria-label="Speech mode" hidden><button type="button" role="menuitemradio" aria-checked="true">Say</button><button type="button" role="menuitemradio" aria-checked="false">Whisper</button><button type="button" role="menuitemradio" aria-checked="false">Shout</button></div></div>
    <label class="sr-only" for="chat-message">Chat message</label>
    <div class="chat-field"><input id="chat-message" maxlength="400" autocomplete="off" spellcheck="false" enterkeyhint="send"></div>
    <div class="bar-hint" role="status">Click to walk. Drag to pan. Scroll to zoom.</div>
  </form><div class="bar-icons"></div>`;
  const icons=bar.querySelector('.bar-icons');
  // The original hand icon opens the actions menu: Wave and Dance.
  const actions=document.createElement('div');actions.className='actions-picker';
  actions.innerHTML='<button type="button" class="bar-icon actions-toggle" title="Actions" aria-label="Actions" aria-haspopup="menu" aria-expanded="false"><img src="/assets/bar/inventory.png" alt=""></button><div class="speech-menu actions-menu" role="menu" aria-label="Actions" hidden><button type="button" role="menuitem" data-gesture="wave">Wave</button><button type="button" role="menuitemcheckbox" aria-checked="false" data-gesture="dance">Dance</button><button type="button" role="menuitemcheckbox" aria-checked="false" data-gesture="breakdance">Breakdance</button></div>';
  const actionsToggle=actions.querySelector('.actions-toggle'),actionsMenu=actions.querySelector('.actions-menu');
  const setActionsOpen=open=>{actionsMenu.hidden=!open;actionsToggle.setAttribute('aria-expanded',String(open));};
  actionsToggle.onclick=()=>setActionsOpen(actionsMenu.hidden);
  actionsMenu.querySelectorAll('button').forEach(button=>button.onclick=()=>{setActionsOpen(false);onGesture?.(button.dataset.gesture);});
  actions.addEventListener('keydown',event=>{if(event.key==='Escape'){setActionsOpen(false);actionsToggle.focus();event.stopPropagation();}});
  document.addEventListener('pointerdown',event=>{if(!actions.contains(event.target))setActionsOpen(false);});
  actions.addEventListener('focusout',event=>{if(!actions.contains(event.relatedTarget))setActionsOpen(false);});
  if(onGesture)icons.append(actions);
  const voice=document.createElement('button');voice.type='button';voice.className='bar-icon voice-toggle';voice.disabled=true;voice.title='Voice chat';voice.setAttribute('aria-label','Voice chat');
  voice.innerHTML='<img src="/assets/bar/microphone.svg" width="32" height="40" alt="">';
  voice.onclick=onVoice;if(onVoice)icons.append(voice);
  const appearance=document.createElement('button');appearance.type='button';appearance.className='bar-icon appearance-toggle';appearance.disabled=true;appearance.title='Change appearance';appearance.setAttribute('aria-label','Change appearance');
  const portrait=document.createElement('canvas');portrait.width=32;portrait.height=40;portrait.setAttribute('aria-hidden','true');appearance.append(portrait);
  appearance.onclick=onAppearance;if(onAppearance)icons.append(appearance);
  const room=document.createElement('button');room.type='button';room.className='bar-icon';
  room.title='Edit room';room.setAttribute('aria-label','Edit room');
  room.innerHTML='<img src="/assets/bar/navigator.png" alt="">';
  room.onclick=onRoomEdit;icons.append(room);
  room.hidden=!admin;const adminButtons=[room];
  const furniture=document.createElement('button');furniture.type='button';furniture.className='bar-icon';
  furniture.title='Furniture';furniture.setAttribute('aria-label','Furniture');furniture.onclick=()=>onFurniture();
  furniture.innerHTML='<img src="/assets/bar/catalogue.png" alt="">';icons.append(furniture);
  const form=bar.querySelector('form'),input=bar.querySelector('input');
  // The indicator shows whenever there is an unsent message in the field, not just while
  // keys are moving: a heartbeat keeps the server's short typing window alive until the
  // text is sent or cleared, or the page is hidden.
  let typing=false,lastTypingSent=-Infinity,typingTimer;
  function publishTyping(value){
    const now=performance.now();
    if(value===typing&&(!value||now-lastTypingSent<1500))return;
    typing=value;lastTypingSent=now;onTyping?.(value);
  }
  function stopTyping(){clearInterval(typingTimer);typingTimer=null;publishTyping(false);}
  function syncTyping(){
    if(!input.value.trim()||document.hidden){stopTyping();return;}
    publishTyping(true);
    if(!typingTimer)typingTimer=setInterval(()=>publishTyping(true),2500);
  }
  input.addEventListener('input',syncTyping);
  document.addEventListener('visibilitychange',syncTyping);
  window.addEventListener('pagehide',stopTyping);
  let mode='Say';
  const picker=bar.querySelector('.speech-picker'),toggle=bar.querySelector('#speech-mode'),menu=bar.querySelector('.speech-menu');
  function setOpen(open){menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));}
  toggle.onclick=()=>setOpen(menu.hidden);
  const choices=[...menu.querySelectorAll('button')];
  choices.forEach(button=>button.onclick=()=>{
    mode=button.textContent;toggle.querySelector('span').textContent=mode;toggle.setAttribute('aria-label',`Speech mode: ${mode}`);
    choices.forEach(b=>b.setAttribute('aria-checked',String(b===button)));setOpen(false);input.focus();
  });
  picker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){setOpen(false);toggle.focus();event.stopPropagation();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();setOpen(true);const index=choices.indexOf(document.activeElement);
      choices[(index+(event.key==='ArrowDown'?1:choices.length-1)+choices.length)%choices.length].focus();
    }
  });
  document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))setOpen(false);});
  picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))setOpen(false);});
  form.onsubmit=async event=>{
    event.preventDefault();const message=input.value.trim();if(!message)return;
    input.value='';stopTyping();
    // On touch screens, sending also dismisses the keyboard.
    if(matchMedia('(pointer: coarse)').matches)input.blur();
    try{await onChat(message,mode);}catch(error){input.value=message;bar.querySelector('.bar-hint').textContent=error.message;}
  };
  icons.querySelectorAll('button').forEach(button=>{
    button.addEventListener('pointerenter',()=>bar.querySelector('.bar-hint').textContent=button.title);
    button.addEventListener('pointerleave',()=>bar.querySelector('.bar-hint').textContent='Click to walk. Drag to pan. Scroll to zoom.');
  });
  document.body.append(bar);
  return {setDancing(action){actionsMenu.querySelectorAll('[role=menuitemcheckbox]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.gesture===action)));},setAvatar(canvas){const ctx=portrait.getContext('2d');ctx.clearRect(0,0,32,40);ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,24,16,48,60,0,0,32,40);},setAppearanceEnabled(value){appearance.disabled=!value;},setVoiceEnabled(value){voice.disabled=!value;},setVoiceState({connected,microphone,blocked=false}){voice.classList.toggle('voice-connected',connected);voice.classList.toggle('voice-microphone',microphone);
    // Playback blocked until a gesture: say so in the hint strip, since the voice panel is usually closed.
    const hint=bar.querySelector('.bar-hint');if(blocked)hint.textContent='Tap anywhere to hear voice.';else if(hint.textContent==='Tap anywhere to hear voice.')hint.textContent='Click to walk. Drag to pan. Scroll to zoom.';voice.title=microphone?'Voice chat · microphone on':connected?'Voice chat · listening':'Voice chat';voice.setAttribute('aria-label',voice.title);},setAdmin(value){adminButtons.forEach(button=>button.hidden=!value);},status(message){bar.querySelector('.bar-hint').textContent=message;}};
}
