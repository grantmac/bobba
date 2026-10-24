import {createShare} from './share.js';
import {createSpaceNavigator} from './space-navigator.js';

export function createToolbar({onRoomEdit,onFurniture,onChat,onTyping,onAppearance,onGesture,onMusicMute,onMusicVolume,onNotificationMute,onTeleport,admin=true}) {
  const bar=document.createElement('div');bar.className='room-toolbar';
  bar.innerHTML=`<form class="room-chat">
    <div class="speech-picker"><button type="button" id="speech-mode" aria-label="Speech mode: Say" aria-haspopup="menu" aria-expanded="false"><span>Say</span><img src="/assets/bar/dropdown-arrow.png" alt=""></button>
    <div class="speech-menu" role="menu" aria-label="Speech mode" hidden><button type="button" role="menuitemradio" aria-checked="true">Say</button><button type="button" role="menuitemradio" aria-checked="false">Whisper</button><button type="button" role="menuitemradio" aria-checked="false">Shout</button></div></div>
    <label class="sr-only" for="chat-message">Chat message</label>
    <div class="chat-field"><input id="chat-message" maxlength="400" autocomplete="off" spellcheck="false" enterkeyhint="send"></div>
    <div class="bar-hint" role="status">Click to walk. Drag to pan. Scroll to zoom.</div>
  </form><button type="button" class="toolbar-menu-toggle" aria-label="Room controls" aria-expanded="false" aria-controls="toolbar-controls"><span aria-hidden="true"></span></button><div class="bar-icons" id="toolbar-controls" role="group" aria-label="Room controls"><div class="toolbar-menu-heading"><span>Room controls</span><button type="button" class="toolbar-menu-close" aria-label="Close room controls">×</button></div></div>`;
  const icons=bar.querySelector('.bar-icons');
  const toolsToggle=bar.querySelector('.toolbar-menu-toggle'),compact=matchMedia('(max-width:640px), (pointer:coarse)');
  function setToolsOpen(open){
    open=open&&compact.matches;bar.classList.toggle('toolbar-menu-open',open);toolsToggle.setAttribute('aria-expanded',String(open));
    if(open){setMusicOpen(false);setActionsOpen(false);setOpen(false);}
  }
  function positionPopup(panel,trigger){
    panel.style.right=`${compact.matches?8:Math.max(8,innerWidth-trigger.getBoundingClientRect().right)}px`;
  }
  const focusTrigger=trigger=>(compact.matches?toolsToggle:trigger).focus();
  toolsToggle.onclick=()=>setToolsOpen(!bar.classList.contains('toolbar-menu-open'));
  bar.querySelector('.toolbar-menu-close').onclick=()=>{setToolsOpen(false);toolsToggle.focus();};
  toolsToggle.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();setToolsOpen(true);icons.querySelector('.bar-icon:not(:disabled):not([hidden])')?.focus();}});
  bar.addEventListener('keydown',event=>{if(event.key==='Escape'&&bar.classList.contains('toolbar-menu-open')){setToolsOpen(false);toolsToggle.focus();event.stopPropagation();}});
  document.addEventListener('pointerdown',event=>{if(!icons.contains(event.target)&&!toolsToggle.contains(event.target))setToolsOpen(false);});
  // A Safari tap can blur without focusing its button. Let the click run;
  // outside presses still dismiss the drawer through pointerdown above.
  icons.addEventListener('focusout',event=>{if(event.relatedTarget&&!icons.contains(event.relatedTarget)&&!toolsToggle.contains(event.relatedTarget))setToolsOpen(false);});
  const music=document.createElement('div');music.className='music-picker';
  music.innerHTML='<button type="button" class="bar-icon music-toggle" title="Sound controls" aria-label="Sound controls" aria-haspopup="dialog" aria-expanded="false" aria-controls="music-controls"><img src="/assets/bar/music.png" width="32" height="40" alt=""></button><div id="music-controls" class="music-controls" role="dialog" aria-labelledby="music-title" hidden><header><h1 id="music-title">Sound</h1><button type="button" class="appearance-close" aria-label="Close sound controls">×</button></header><div class="music-body"><label for="music-volume">Music volume <output for="music-volume">79%</output></label><input id="music-volume" type="range" min="0" max="100" value="79"><button type="button" class="music-mute" aria-pressed="false">Mute music</button><button type="button" class="music-mute notification-mute" aria-pressed="false">Mute join &amp; message sounds</button></div></div>';
  const musicToggle=music.querySelector('.music-toggle'),musicPanel=music.querySelector('.music-controls'),musicVolume=music.querySelector('input'),musicMute=music.querySelector('.music-mute');
  // Popups live outside the mobile drawer so choosing a control can close the drawer.
  bar.append(musicPanel);
  const inMusic=target=>music.contains(target)||musicPanel.contains(target);
  const notificationMute=musicPanel.querySelector('.notification-mute');
  let notificationsMuted=false;
  notificationMute.hidden=!onNotificationMute;
  notificationMute.onclick=()=>onNotificationMute?.(!notificationsMuted);
  function setNotificationMuted(muted){
    notificationsMuted=muted;notificationMute.setAttribute('aria-pressed',String(muted));
    notificationMute.textContent=muted?'Unmute join & message sounds':'Mute join & message sounds';
  }
  let musicMuted=false;
  function setMusicOpen(open){musicPanel.hidden=!open;musicToggle.setAttribute('aria-expanded',String(open));if(open){positionPopup(musicPanel,musicToggle);setToolsOpen(false);musicVolume.focus();}}
  function setMusicState({muted,volume}){
    musicMuted=muted;musicVolume.value=Math.round(volume*100);musicPanel.querySelector('output').textContent=`${Math.round(volume*100)}%`;
    musicMute.textContent=muted?'Unmute music':'Mute music';musicMute.setAttribute('aria-pressed',String(muted));
    musicToggle.title=muted||volume===0?'Sound controls · music muted':'Sound controls';musicToggle.setAttribute('aria-label',musicToggle.title);
  }
  musicToggle.onclick=()=>setMusicOpen(musicPanel.hidden);
  musicPanel.querySelector('.appearance-close').onclick=()=>{setMusicOpen(false);focusTrigger(musicToggle);};
  musicMute.onclick=()=>onMusicMute?.(!musicMuted);
  musicVolume.oninput=()=>onMusicVolume?.(Number(musicVolume.value)/100);
  for(const element of [music,musicPanel]){
    element.addEventListener('keydown',event=>{if(event.key==='Escape'){setMusicOpen(false);focusTrigger(musicToggle);event.stopPropagation();}});
    // Safari taps can blur the slider without focusing the button. Keep the panel
    // open until its click runs; outside presses are handled by pointerdown below.
    element.addEventListener('focusout',event=>{if(event.relatedTarget&&!inMusic(event.relatedTarget))setMusicOpen(false);});
  }
  document.addEventListener('pointerdown',event=>{if(!inMusic(event.target))setMusicOpen(false);});
  if(onMusicMute||onMusicVolume||onNotificationMute)icons.append(music);
  // The original hand icon opens the actions menu: Wave and Dance.
  const actions=document.createElement('div');actions.className='actions-picker';
  actions.innerHTML='<button type="button" class="bar-icon actions-toggle" title="Actions" aria-label="Actions" aria-haspopup="menu" aria-expanded="false"><img src="/assets/bar/inventory.png" alt=""></button><div class="speech-menu actions-menu" role="menu" aria-label="Actions" hidden><button type="button" role="menuitem" data-gesture="wave">Wave</button><button type="button" role="menuitemcheckbox" aria-checked="false" data-gesture="dance">Dance</button><button type="button" role="menuitemcheckbox" aria-checked="false" data-gesture="breakdance">Breakdance</button></div>';
  const actionsToggle=actions.querySelector('.actions-toggle'),actionsMenu=actions.querySelector('.actions-menu');
  bar.append(actionsMenu);
  const inActions=target=>actions.contains(target)||actionsMenu.contains(target);
  const setActionsOpen=open=>{actionsMenu.hidden=!open;actionsToggle.setAttribute('aria-expanded',String(open));if(open){positionPopup(actionsMenu,actionsToggle);setToolsOpen(false);actionsMenu.querySelector('button').focus();}};
  actionsToggle.onclick=()=>setActionsOpen(actionsMenu.hidden);
  actionsMenu.querySelectorAll('button').forEach(button=>button.onclick=()=>{setActionsOpen(false);focusTrigger(actionsToggle);onGesture?.(button.dataset.gesture);});
  for(const element of [actions,actionsMenu]){
    element.addEventListener('keydown',event=>{if(event.key==='Escape'){setActionsOpen(false);focusTrigger(actionsToggle);event.stopPropagation();}});
    element.addEventListener('focusout',event=>{if(event.relatedTarget&&!inActions(event.relatedTarget))setActionsOpen(false);});
  }
  document.addEventListener('pointerdown',event=>{if(!inActions(event.target))setActionsOpen(false);});
  if(onGesture)icons.append(actions);
  const appearance=document.createElement('button');appearance.type='button';appearance.className='bar-icon appearance-toggle';appearance.disabled=true;appearance.title='Change appearance';appearance.setAttribute('aria-label','Change appearance');
  const portrait=document.createElement('canvas');portrait.width=96;portrait.height=120;portrait.setAttribute('aria-hidden','true');appearance.append(portrait);
  appearance.onclick=onAppearance;if(onAppearance)icons.append(appearance);
  const room=document.createElement('button');room.type='button';room.className='bar-icon';
  room.title='Edit room';room.setAttribute('aria-label','Edit room');
  room.innerHTML='<img src="/assets/bar/navigator.png" alt="">';
  room.onclick=onRoomEdit;icons.append(room);
  room.hidden=!admin;const adminButtons=[room];
  const furniture=document.createElement('button');furniture.type='button';furniture.className='bar-icon';
  furniture.title='Furniture';furniture.setAttribute('aria-label','Furniture');furniture.onclick=()=>onFurniture();
  furniture.innerHTML='<img src="/assets/bar/catalogue.png" alt="">';icons.append(furniture);
  const spaces=document.createElement('button');spaces.type='button';spaces.className='bar-icon spaces-toggle';spaces.disabled=true;spaces.title='Teleport';spaces.setAttribute('aria-label','Teleport');spaces.setAttribute('aria-haspopup','dialog');
  spaces.innerHTML='<img src="/assets/bar/teleport.png" width="32" height="40" alt="">';
  const navigator=onTeleport?createSpaceNavigator({onTeleport,onClose:()=>focusTrigger(spaces)}):null;
  spaces.onclick=()=>{setToolsOpen(false);setMusicOpen(false);setActionsOpen(false);setOpen(false);navigator.open();};
  if(navigator)icons.append(spaces);
  const share=document.createElement('button');share.type='button';share.className='bar-icon share-toggle';share.title='Share the room';share.setAttribute('aria-label','Share the room');share.setAttribute('aria-haspopup','dialog');
  share.innerHTML='<img src="/assets/bar/share.png" width="32" height="40" alt="">';
  const shareDialog=createShare({onClose:()=>focusTrigger(share)});
  share.onclick=()=>{setToolsOpen(false);setMusicOpen(false);setActionsOpen(false);setOpen(false);shareDialog.open();};
  icons.append(share);
  for(const [button,label] of [[musicToggle,'Sound'],[actionsToggle,'Actions'],[appearance,'My look'],[room,'Edit room'],[furniture,'Furniture'],[spaces,'Teleport'],[share,'Share']]){
    const text=document.createElement('span');text.className='toolbar-icon-label';text.textContent=label;button.append(text);
  }
  icons.addEventListener('click',event=>{if(event.target.closest('.bar-icon'))setToolsOpen(false);});
  compact.addEventListener('change',()=>{
    const focusedControl=icons.contains(document.activeElement);
    setToolsOpen(false);setMusicOpen(false);setActionsOpen(false);
    if(compact.matches&&focusedControl)toolsToggle.focus();
    else if(!compact.matches&&document.activeElement===toolsToggle)icons.querySelector('.bar-icon:not(:disabled):not([hidden])')?.focus();
  });
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
  return {setMusicState,setNotificationMuted,setSpaces(value){navigator?.receive(value);},setTeleportEnabled(value){spaces.disabled=!value;},setDancing(action){actionsMenu.querySelectorAll('[role=menuitemcheckbox]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.gesture===action)));},setAvatar(canvas){const ctx=portrait.getContext('2d');ctx.clearRect(0,0,portrait.width,portrait.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(canvas,24,16,48,60,0,0,portrait.width,portrait.height);},setAppearanceEnabled(value){appearance.disabled=!value;},setAdmin(value){adminButtons.forEach(button=>button.hidden=!value);},status(message){bar.querySelector('.bar-hint').textContent=message;}};
}
