import {startRegistration,startAuthentication,browserSupportsWebAuthn} from '@simplewebauthn/browser';
import {makeDraggable} from './draggable.js';

export function createRoomKey({identity}){
  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog character-editor room-key-dialog';
  dialog.setAttribute('aria-labelledby','room-key-title');dialog.tabIndex=-1;
  dialog.innerHTML=`<header><h1 id="room-key-title">Your room key</h1><button type="button" class="appearance-close" aria-label="Close room key">×</button></header>
    <div class="room-key-body">
      <div class="room-key-emblem" aria-hidden="true">⚿</div>
      <h2 class="room-key-heading"></h2><p class="room-key-description"></p>
      <button type="button" class="room-key-passkey">Keep your character</button>
      <p class="room-key-support"></p>
      <section class="room-key-backup" hidden><h3>A spare key, just in case</h3><p>Keep a one-time backup code somewhere safe. It lets you return if you lose access to your passkey.</p>
        <button type="button" class="room-key-create-backup">Create backup code</button>
        <div class="room-key-code" hidden><label for="room-key-code">Your backup code</label><textarea id="room-key-code" readonly spellcheck="false" rows="4"></textarea><button type="button" class="room-key-copy">Copy code</button><p>Shown only here. Anyone with this code can enter as you. It works once; creating another replaces it.</p></div>
      </section>
      <form class="room-key-recover" hidden><label for="room-key-recover">Use a backup code</label><p>If you saved a spare code, paste it here.</p><textarea id="room-key-recover" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="100" rows="3" required placeholder="Your saved backup code"></textarea><button type="submit">Return to my character</button></form>
      <p class="room-key-status" role="status" aria-live="polite"></p>
    </div><footer><button type="button" class="room-key-done">Back to room</button></footer>`;
  document.body.append(dialog);makeDraggable(dialog,dialog.querySelector('header'));
  const find=selector=>dialog.querySelector(selector),heading=find('.room-key-heading'),description=find('.room-key-description'),passkey=find('.room-key-passkey'),support=find('.room-key-support'),backup=find('.room-key-backup'),form=find('form'),input=find('#room-key-recover'),status=find('.room-key-status'),done=find('.room-key-done'),code=find('#room-key-code'),codePanel=find('.room-key-code');
  let mode='save',busy=false,resolve=null,successful=false;
  function close(){if(busy)return;dialog.close();resolve?.(successful);resolve=null;}
  find('.appearance-close').onclick=close;done.onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  function message(error){
    const name=error.cause?.name??error.name;
    if(name==='NotAllowedError'||name==='AbortError'||error.code==='ERROR_CEREMONY_ABORTED')return 'No room key was used. You can try again whenever you’re ready.';
    if(name==='InvalidStateError')return 'This device already has a room key for your character.';
    return error.message||'Something went wrong. Please try again.';
  }
  async function run(task){
    if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');
    dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);
    try{await task();}catch(error){status.textContent=message(error);}
    finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);passkey.disabled=!browserSupportsWebAuthn();}
  }
  async function savedState(){
    const data=await identity.status();
    heading.textContent=data.saved?`${data.name} is yours to keep`:'Make yourself at home';
    description.textContent=data.saved?'Your name is reserved. Your look, space and belongings stay with this character.':'Save a room key to keep your name, look, space and belongings when you come back.';
    passkey.textContent=data.passkeys?'Add another room key':'Keep your character';
    support.textContent=browserSupportsWebAuthn()?'A room key is a passkey saved by your device or password manager. No password to remember.':'This browser cannot use passkeys. Save a backup code below, or use a browser that supports passkeys.';
    backup.hidden=!data.backupAvailable;form.hidden=true;
    find('.room-key-create-backup').textContent=data.hasBackup?'Replace backup code':'Create backup code';
    if(!data.backupAvailable)support.textContent+=' Keep your private entry link as your backup.';
    if(!identity.remembered)support.textContent+=' This browser cannot remember you after closing. Save a room key or backup code before leaving.';
  }
  passkey.onclick=()=>run(async()=>{
    status.textContent=mode==='save'?'Preparing your room key…':'Looking for your room key…';
    if(mode==='save'){
      const request=await identity.registrationOptions();
      const response=await startRegistration({optionsJSON:request.options});
      await identity.register(request.id,response);await savedState();
      status.textContent='Room key saved. Next time, use “Use my room key” at this same room address.';
    }else{
      const request=await identity.authenticationOptions();
      const response=await startAuthentication({optionsJSON:request.options});
      await identity.authenticate(request.id,response);successful=true;
      busy=false;close();
    }
  });
  find('.room-key-create-backup').onclick=()=>run(async()=>{
    status.textContent='Making your spare key…';
    const result=await identity.makeBackup();code.value=result.code;codePanel.hidden=false;
    await savedState();status.textContent='Your character is saved. Copy this code before closing. Any previous backup code has been replaced.';
  });
  find('.room-key-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(code.value);status.textContent='Copied. Keep the code in your password manager or another private place.';}
    catch{code.focus();code.select();status.textContent='Select and copy the code, then keep it somewhere private.';}
  };
  form.onsubmit=event=>{
    event.preventDefault();if(!form.reportValidity())return;
    void run(async()=>{
      status.textContent='Opening your character…';
      await identity.useBackup(input.value);successful=true;mode='save';input.value='';
      done.textContent='Enter room';find('h1').textContent='Welcome back';
      await savedState();
      status.textContent='You’re back. That backup code has been used. Save a passkey or create a new backup code before leaving.';
    });
  };
  async function open(nextMode='save'){
    if(dialog.open)return false;
    mode=nextMode;successful=false;status.textContent='';input.value='';code.value='';codePanel.hidden=true;
    backup.hidden=true;form.hidden=true;support.textContent='';
    heading.textContent='Your room key';description.textContent='Loading…';
    find('h1').textContent=mode==='save'?'Keep your character':'Welcome back';
    done.textContent=mode==='save'?'Back to room':'Back';
    dialog.showModal();dialog.focus();
    const finished=new Promise(r=>{resolve=r;});
    await run(async()=>{
      if(mode==='save')await savedState();
      else{
        heading.textContent='Pick up where you left off';description.textContent='Use your saved room key to return to your character.';passkey.textContent='Use my room key';
        support.textContent=browserSupportsWebAuthn()?'Choose the passkey you saved for this room address. Your device may also offer a QR code to use a key from your phone.':'This browser cannot use passkeys. Use a saved backup code below, or open the room in a supported browser.';
        form.hidden=false;
      }
    });
    return finished;
  }
  return {open};
}
