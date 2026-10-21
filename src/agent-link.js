import {makeDraggable} from './draggable.js';
// The copied prompt contains a fresh agent key; keep it only while this window is open.
export function createAgentLink({network,focusRoom=()=>{}}){
  const roomUrl=import.meta.env.DEV?'https://chat.grantm.ac':location.origin;
  const mcpUrl=`${roomUrl}/api/mcp`;
  const dialog=document.createElement('dialog');dialog.className='appearance-dialog agent-dialog';dialog.setAttribute('aria-label','Build with your agent');dialog.tabIndex=-1;
  dialog.innerHTML=`<header><h1>Build with your agent</h1><button type="button" class="appearance-close" aria-label="Close agent setup">×</button></header>
    <div class="agent-body">
      <p>Copy this prompt into your agent, then send it a picture of what you'd like to build.</p>
      <p>The prompt includes a key that lets your agent build for your player.</p>
      <button type="button" class="agent-small agent-copy-prompt">Copy agent prompt</button>
      <p class="agent-copy-status" role="status"></p>
      <textarea class="agent-prompt" aria-label="Agent setup prompt" readonly spellcheck="false" hidden></textarea>
      <p class="agent-attached"></p>
      <button type="button" class="agent-small agent-revoke" hidden>Disconnect all agents</button>
    </div>`;
  document.body.append(dialog);makeDraggable(dialog,dialog.querySelector('header'));
  const $=selector=>dialog.querySelector(selector);
  const prompt=$('.agent-prompt'),copy=$('.agent-copy-prompt'),status=$('.agent-copy-status'),attached=$('.agent-attached'),revoke=$('.agent-revoke');
  let stopAttached=null,generation=0;
  function clearPrompt(){generation++;prompt.value='';prompt.hidden=true;status.textContent='';copy.disabled=false;}
  async function copyPrompt(){
    const request=++generation;copy.disabled=true;status.textContent='Preparing prompt…';
    try{
      if(!prompt.value){
        const {agentToken}=await network.agents.key('Agent prompt');
        if(request!==generation)return;
        prompt.value=`Help me build furniture for my room at ${roomUrl}.

Connect to this HTTP MCP server:
${mcpUrl}
Authorization: Bearer ${agentToken}

Use this key only with the MCP server above. Call tools/list to discover its tools, then call status.`;
        prompt.hidden=false;
      }
      try{
        await navigator.clipboard.writeText(prompt.value);
        if(request===generation)status.textContent='Copied. Paste it into your agent, then send a picture.';
      }catch{
        if(request!==generation)return;
        prompt.focus();prompt.select();status.textContent='Copy the selected prompt and paste it into your agent.';
      }
    }catch(error){if(request===generation)status.textContent=error.message;}
    finally{if(request===generation)copy.disabled=false;}
  }
  function close(){dialog.close();stopAttached?.();stopAttached=null;clearPrompt();focusRoom();}
  $('.appearance-close').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  copy.onclick=copyPrompt;
  revoke.onclick=async()=>{try{await network.agents.revoke();clearPrompt();}catch(error){attached.textContent=error.message;}};
  return {
    open(){
      if(dialog.open)return;
      dialog.showModal();dialog.focus();
      stopAttached=network.agents.attached(list=>{
        attached.textContent=list.length?`Attached: ${list.map(a=>a.label).join(', ')}.`:'No agent attached yet.';revoke.hidden=!list.length;
      },message=>{attached.textContent=message;});
    },
    close,
  };
}
