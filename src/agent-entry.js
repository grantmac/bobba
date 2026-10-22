import {makeDraggable} from './draggable.js';

export function openAgentEntry(network){
  if(!network.pairing.code)return;
  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog agent-dialog agent-entry';dialog.setAttribute('aria-label','Connect your agent');
  dialog.innerHTML='<header><h1>Connect your agent</h1></header><div class="agent-body"><p class="pairing-description"></p><p class="pairing-verification"></p><p class="pairing-message" role="status" aria-live="polite">Checking the connection…</p><div class="pairing-actions"><button type="button" class="agent-small pairing-approve" hidden>Connect</button><button type="button" class="agent-small pairing-close">Cancel</button></div></div>';
  const $=selector=>dialog.querySelector(selector),approve=$('.pairing-approve'),close=$('.pairing-close'),message=$('.pairing-message');
  let current=null,busy=false,stop=()=>{},timer=null,closing=null,ended=false;
  function pause(){stop();clearInterval(timer);clearTimeout(closing);closing=null;}
  function finish(){if(ended)return;ended=true;pause();window.removeEventListener('pagehide',pause);window.removeEventListener('pageshow',resume);network.pairing.clear();dialog.close();dialog.remove();document.querySelector('#scene')?.focus({preventScroll:true});}
  function render(value){
    if(ended)return;current=value;
    const state=value.expiresAt<=Date.now()&&value.state!=='connected'?'expired':value.state;
    approve.hidden=state!=='pending';approve.disabled=busy;
    const client=value.client==='ChatGPT'?'ChatGPT / Codex':value.client==='Claude'?'Claude':'your agent';
    $('.pairing-description').textContent=`Connect ${client} as ${network.me.name}. It can build and manage your pieces and space, and open the room signed in as you when you ask. Connecting also keeps your character and reserves your name.`;
    $('.pairing-verification').textContent=value.verification?`Match this code with your chat: ${value.verification}`:'';
    approve.textContent=`Connect ${value.client==='Agent'?'agent':value.client??'agent'}`;
    close.textContent=['pending','approved'].includes(state)?'Cancel':'Enter room';
    message.textContent={pending:'Only connect if you started this request in your own chat.',approved:'Approved. Waiting for your agent to connect…',connected:"You're connected!",expired:'This link has expired. Ask your agent to open a new connection.',cancelled:'Connection cancelled.',revoked:'This connection was disconnected. Ask your agent to reconnect.',unavailable:'This link belongs to a different character. Ask your agent to start a new connection for this character.'}[state]??'This connection is unavailable.';
    if(state==='connected'&&!closing)closing=setTimeout(finish,1000);
  }
  approve.onclick=async()=>{
    if(busy||current?.state!=='pending')return;
    busy=true;approve.disabled=true;close.disabled=true;
    try{await network.pairing.decide(true);}
    catch(error){message.textContent=error.message;}
    finally{busy=false;approve.disabled=false;close.disabled=false;}
  };
  async function dismiss(){
    if(busy)return;
    if(current&&['pending','approved'].includes(current.state)&&current.expiresAt>Date.now()){
      busy=true;approve.disabled=true;close.disabled=true;
      try{await network.pairing.decide(false);}
      catch(error){message.textContent=error.message;busy=false;approve.disabled=false;close.disabled=false;return;}
    }
    finish();
  }
  close.onclick=dismiss;dialog.addEventListener('cancel',event=>{event.preventDefault();void dismiss();});
  document.body.append(dialog);makeDraggable(dialog);dialog.showModal();close.focus();
  function watch(){
    stop=network.pairing.watch(render,error=>{message.textContent=error;close.textContent='Close';});
    timer=setInterval(()=>{if(current?.expiresAt<=Date.now())render(current);},1000);
  }
  function resume(event){if(event.persisted&&!ended)watch();}
  watch();window.addEventListener('pagehide',pause);window.addEventListener('pageshow',resume);
}
