import {makeDraggable} from './draggable.js';

// The prompt contains a fresh agent key; keep it only while its setup view is open.
export function createAgentPrompt({network,root,onAttached=()=>{},enterRoom=true}){
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

Use this key only with the MCP server above. Call tools/list to discover its tools, then call status.

After status succeeds, tell me you're connected${enterRoom?' and remind me to click Enter room on the website':'. I am already in the room'}. Briefly explain that you can create my own space, style its floor and walls, turn pictures or ideas into furniture, and place or rearrange my furniture. Offer a few short examples, such as "make me a cosy reading corner", "turn this picture into a chair", or "give my space a checkerboard floor". Ask what I'd like to create first. Don't start building until I choose.`;
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

export function createAgentSetup({network,root,enterRoom=false,onAttached=()=>{}}){
  root.innerHTML=`<h2 class="entry-agent-title">Connect your agent</h2><p class="entry-agent-description">Use an agent to create a space and style it with your own furniture.</p><div class="entry-agent-setup"><button type="button" class="entry-connect agent-copy-prompt">Copy Agent Prompt</button><p class="agent-copy-status" role="status" aria-live="polite"></p><textarea class="agent-prompt" aria-label="Agent setup prompt" readonly spellcheck="false" hidden></textarea><p class="agent-attached" role="status" aria-live="polite" data-connected="false">Not connected</p></div><p class="entry-agent-note"></p>`;
  function update(list){
    const connected=list.some(agent=>agent.connectedAt!=null);
    root.dataset.agentConnected=String(connected);
    root.querySelector('.entry-agent-title').textContent=connected?"You're connected!":'Connect your agent';
    root.querySelector('.entry-agent-description').textContent=connected
      ?(enterRoom?'Enter the room to explore and bring your ideas to life with your agent.':'Bring your ideas to life with your agent.')
      :'Use an agent to create a space and style it with your own furniture.';
    root.querySelector('.entry-agent-note').textContent=connected
      ?(enterRoom?'Your agent will explain what you can create. Head into the room when you’re ready.':'Tell your agent what you’d like to create first.')
      :(enterRoom?'You can also do this later from the catalogue.':'Paste the prompt into your agent of choice to connect.');
    onAttached(list);
  }
  const setup=createAgentPrompt({network,root:root.querySelector('.entry-agent-setup'),enterRoom,onAttached:update});
  return {...setup,start(){update([]);setup.start();}};
}

export function createAgentLink({network,focusRoom=()=>{}}){
  const dialog=document.createElement('dialog');dialog.className='appearance-dialog agent-dialog';dialog.setAttribute('aria-label','Build with your agent');dialog.tabIndex=-1;
  dialog.innerHTML=`<header><h1>Build with your agent</h1><button type="button" class="appearance-close" aria-label="Close agent setup">×</button></header>
    <section class="entry-agent"></section>
    <button type="button" class="agent-small agent-revoke" hidden>Disconnect all agents</button>`;
  document.body.append(dialog);makeDraggable(dialog,dialog.querySelector('header'));
  const revoke=dialog.querySelector('.agent-revoke');
  const setup=createAgentSetup({network,root:dialog.querySelector('.entry-agent'),onAttached:list=>{revoke.hidden=!list.length;}});
  const attached=dialog.querySelector('.agent-attached');
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
