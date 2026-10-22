import {makeDraggable} from './draggable.js';

export function createShare({onClose=()=>{}}={}){
  const roomUrl=import.meta.env.DEV?'https://chat.grantm.ac':location.origin;
  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog agent-dialog share-dialog';
  dialog.setAttribute('aria-labelledby','share-title');
  dialog.innerHTML=`<header><h1 id="share-title">Share the room</h1><button type="button" class="appearance-close" aria-label="Close share">×</button></header>
    <div class="agent-body"><p>Invite a friend to join. Send them this prompt to paste into their agent.</p>
    <textarea class="agent-prompt" aria-label="Agent prompt to join" readonly spellcheck="false"></textarea>
    <button type="button" class="agent-small share-copy">Copy prompt</button>
    <p class="agent-copy-status" role="status" aria-live="polite"></p></div>`;
  const prompt=dialog.querySelector('textarea'),copy=dialog.querySelector('.share-copy'),status=dialog.querySelector('.agent-copy-status');
  // Share the public entry guide, never a player's key or the current URL's private entry parameters.
  prompt.value=`Join this room: ${roomUrl}/connect`;
  let generation=0;
  copy.onclick=async()=>{
    const request=++generation;
    copy.disabled=true;
    try{
      await navigator.clipboard.writeText(prompt.value);
      if(request===generation)status.textContent='Prompt copied. Send it to a friend!';
    }catch{
      if(request===generation){prompt.focus();prompt.select();status.textContent='Copy the selected prompt and send it to a friend.';}
    }finally{if(request===generation)copy.disabled=false;}
  };
  dialog.querySelector('.appearance-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{generation++;copy.disabled=false;status.textContent='';onClose();});
  document.body.append(dialog);makeDraggable(dialog);
  return {open(){if(dialog.open)return;dialog.showModal();copy.focus();}};
}
