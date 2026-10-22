import {makeDraggable} from './draggable.js';

// The prompt contains a fresh agent key; keep it only while its setup view is open.
export function createAgentPrompt({network,root,onAttached=()=>{}}){
  const roomUrl=import.meta.env.DEV?'https://chat.grantm.ac':location.origin;
  const mcpUrl=`${roomUrl}/api/mcp`;
  const $=selector=>root.querySelector(selector);
  const prompt=$('.agent-prompt'),copy=$('.agent-copy-prompt'),status=$('.agent-copy-status'),attached=$('.agent-attached');
  let stopAttached=null,generation=0;
  function clearPrompt(){generation++;prompt.value='';prompt.hidden=true;status.textContent='';copy.disabled=false;copy.textContent='Copy Agent Prompt';}
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
        if(request===generation){status.textContent='Prompt copied. Paste it into your agent of choice to connect.';if(root.classList.contains('entry-agent-setup'))prompt.hidden=true;}
      }catch{
        if(request!==generation)return;
        prompt.hidden=false;prompt.focus();prompt.select();status.textContent='Copy the selected prompt and paste it into your agent.';
      }
    }catch(error){if(request===generation)status.textContent=error.message;}
    finally{if(request===generation)copy.disabled=false;}
  }
  copy.onclick=copyPrompt;
  function stop(){stopAttached?.();stopAttached=null;clearPrompt();}
  function start(){
    stop();attached.dataset.connected='false';attached.textContent='Not connected';
    stopAttached=network.agents.attached(list=>{
      const connected=list.some(agent=>agent.connectedAt!=null);
      attached.dataset.connected=String(connected);
      attached.textContent=connected?'Agent connected':'Not connected';
      onAttached(list);
    },message=>{attached.dataset.connected='false';attached.textContent=`Connection status unavailable. ${message}`;});
  }
  return {start,stop,clearPrompt};
}

export function createAgentLink({network,focusRoom=()=>{}}){
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
  const attached=dialog.querySelector('.agent-attached'),revoke=dialog.querySelector('.agent-revoke');
  const setup=createAgentPrompt({network,root:dialog,onAttached:list=>{revoke.hidden=!list.length;}});
  function close(){dialog.close();setup.stop();focusRoom();}
  dialog.querySelector('.appearance-close').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  revoke.onclick=async()=>{try{await network.agents.revoke();setup.clearPrompt();}catch(error){attached.textContent=error.message;}};
  return {
    open(){
      if(dialog.open)return;
      dialog.showModal();dialog.focus();setup.start();
    },
    close,
  };
}
