export function createToolbar({onRoomEdit,onFurniture,onChat,onVoice,admin=true}) {
  const bar=document.createElement('div');bar.className='room-toolbar';
  bar.innerHTML=`<form class="room-chat">
    <div class="speech-picker"><button type="button" id="speech-mode" aria-label="Speech mode: Say" aria-haspopup="menu" aria-expanded="false"><span>Say</span><img src="/assets/bar/dropdown-arrow.png" alt=""></button>
    <div class="speech-menu" role="menu" aria-label="Speech mode" hidden><button type="button" role="menuitemradio" aria-checked="true">Say</button><button type="button" role="menuitemradio" aria-checked="false">Whisper</button><button type="button" role="menuitemradio" aria-checked="false">Shout</button></div></div>
    <label class="sr-only" for="chat-message">Chat message</label>
    <div class="chat-field"><input id="chat-message" maxlength="400" autocomplete="off" spellcheck="false"></div>
    <div class="bar-hint" role="status">Click to walk. Scroll to zoom.</div>
  </form><div class="bar-icons"></div>`;
  const icons=bar.querySelector('.bar-icons');
  const voice=document.createElement('button');voice.type='button';voice.className='bar-icon voice-toggle';voice.disabled=true;voice.title='Voice chat';voice.setAttribute('aria-label','Voice chat');
  voice.innerHTML='<svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><path d="M9 2h8v2h2v16h-2v2H9v-2H7V4h2z" fill="#ddd" stroke="#161616" stroke-width="2"/><path d="M3 15v7l5 5h10l5-5v-7M13 27v5M7 32h12" fill="none" stroke="#161616" stroke-width="3"/><path d="M10 6h6M10 10h6M10 14h6" stroke="#777" stroke-width="2"/></svg>';
  voice.onclick=onVoice;if(onVoice)icons.append(voice);
  const room=document.createElement('button');room.type='button';room.className='bar-icon';
  room.title='Edit room';room.setAttribute('aria-label','Edit room');
  room.innerHTML='<img src="/assets/bar/navigator.png" alt="">';
  room.onclick=onRoomEdit;icons.append(room);
  room.hidden=!admin;const adminButtons=[room];
  for(const [file,label] of [['messenger','Friends'],['credits','Credits'],['catalogue','Catalogue'],['inventory','Inventory']]){
    const button=document.createElement('button');button.type='button';button.className='bar-icon';
    const available=file==='catalogue'||file==='inventory';
    button.disabled=!available;button.title=available?label:label+' — not available yet';button.setAttribute('aria-label',button.title);
    if(available)button.onclick=()=>onFurniture(label);
    if(available){button.hidden=!admin;adminButtons.push(button);}
    button.innerHTML=`<img src="/assets/bar/${file}.png" alt="">`;icons.append(button);
  }
  const form=bar.querySelector('form'),input=bar.querySelector('input');
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
    input.value='';
    try{await onChat(message,mode);}catch(error){input.value=message;bar.querySelector('.bar-hint').textContent=error.message;}
  };
  icons.querySelectorAll('button').forEach(button=>{
    button.addEventListener('pointerenter',()=>bar.querySelector('.bar-hint').textContent=button.title);
    button.addEventListener('pointerleave',()=>bar.querySelector('.bar-hint').textContent='Click to walk. Scroll to zoom.');
  });
  document.body.append(bar);
  return {setVoiceEnabled(value){voice.disabled=!value;},setVoiceState({connected,microphone}){voice.classList.toggle('voice-connected',connected);voice.classList.toggle('voice-microphone',microphone);voice.title=microphone?'Voice chat · microphone on':connected?'Voice chat · listening':'Voice chat';voice.setAttribute('aria-label',voice.title);},setAdmin(value){adminButtons.forEach(button=>button.hidden=!value);},status(message){bar.querySelector('.bar-hint').textContent=message;}};
}
