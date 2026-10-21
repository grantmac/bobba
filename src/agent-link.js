import {makeDraggable} from './draggable.js';
// Agent window: makes an agent key for the room's hosted MCP endpoint (shown once) and lists
// the agents attached to this player.
export function createAgentLink({network,focusRoom=()=>{}}){
  const mcpUrl=`${location.origin}/api/mcp`;
  const dialog=document.createElement('dialog');dialog.className='appearance-dialog agent-dialog';dialog.setAttribute('aria-label','Build with your agent');dialog.tabIndex=-1;
  dialog.innerHTML=`<header><h1>Build with your agent</h1><button type="button" class="appearance-close" aria-label="Close agent setup">×</button></header>
    <div class="agent-body">
      <p>Attach an AI agent to your player and it can turn any picture you hand it into a piece of furniture here. Everyone sees new pieces straight away.</p>
      <p>The room's MCP server is at <code class="agent-url"></code>. Make a key for your player and give it to your agent when it asks:</p>
      <div class="agent-key"><button type="button" class="agent-small agent-make-key">Create agent key</button><span class="agent-key-note"></span></div>
      <pre class="agent-key-value" hidden></pre>
      <div class="agent-key-help" hidden>
        <p><strong>Codex:</strong> install the Habbo Room plugin and paste the key when it asks. <strong>Claude Code:</strong></p>
        <pre class="agent-claude"></pre>
        <p>Then tell your agent: <em>"Add this picture as a piece in the room."</em> and paste the picture. The key is shown once; make another any time.</p>
      </div>
      <p class="agent-attached"></p>
      <button type="button" class="agent-small agent-revoke" hidden>Disconnect all agents</button>
    </div>`;
  document.body.append(dialog);makeDraggable(dialog,dialog.querySelector('header'));
  const $=selector=>dialog.querySelector(selector);
  const keyValue=$('.agent-key-value'),keyNote=$('.agent-key-note'),keyHelp=$('.agent-key-help'),claude=$('.agent-claude'),attached=$('.agent-attached'),revoke=$('.agent-revoke');
  $('.agent-url').textContent=mcpUrl;
  let stopAttached=null;
  async function makeKey(){
    keyNote.textContent='';
    try{
      const {agentToken}=await network.agents.key('Plugin');
      keyValue.textContent=agentToken;keyValue.hidden=false;keyHelp.hidden=false;
      claude.textContent=`claude mcp add --transport http habbo-room ${mcpUrl} --header "Authorization: Bearer ${agentToken}"`;
    }catch(error){keyNote.textContent=error.message;}
  }
  function close(){dialog.close();stopAttached?.();stopAttached=null;keyValue.hidden=true;keyHelp.hidden=true;keyValue.textContent='';focusRoom();}
  $('.appearance-close').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('.agent-make-key').onclick=makeKey;
  revoke.onclick=async()=>{try{await network.agents.revoke();}catch(error){attached.textContent=error.message;}};
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
