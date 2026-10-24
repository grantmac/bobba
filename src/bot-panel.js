import {makeDraggable} from './draggable.js';
import './bot-panel.css';

export function createBotPanel({api,admin=false,mount=document.querySelector('.bar-icons')}){
  const toggle=document.createElement('button');toggle.type='button';toggle.className='bar-icon resident-bot-toggle';toggle.textContent='Bot';toggle.title='Room bot';toggle.setAttribute('aria-label','Room bot');toggle.setAttribute('aria-expanded','false');if(admin)mount?.append(toggle);
  const panel=document.createElement('section');panel.className='voice-panel resident-bot-panel';panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Room bot');
  panel.innerHTML=`<header><h1>Room bot</h1><button type="button" class="appearance-close" aria-label="Close room bot">×</button></header>
    <div class="resident-bot-body"><p class="bot-summary" role="status">Connecting…</p>
    <p class="bot-disclosure">The resident bot hears typed chat within six tiles, or messages mentioning its name from anywhere. Mentioning its name lets you keep chatting from anywhere for 60 seconds; each reply to you renews that time. It can remember useful things you share, but does not listen to voice yet. Ask it to remember or forget something by name.</p>
    <div class="bot-admin" hidden><form class="bot-settings">
      <label>Name<input name="name" required maxlength="20" autocomplete="off"></label>
      <label>Personality<textarea name="personality" required maxlength="2000" rows="3"></textarea></label>
      <div class="bot-checks"><label><input type="checkbox" name="enabled"> Respond to chat</label><label><input type="checkbox" name="roaming"> Wander around</label></div>
      <label>Moderation<select name="moderation"><option value="kick">Warn, then remove for 10 minutes</option><option value="warn">Warnings only</option><option value="off">Off</option></select></label>
      <button type="submit">Save settings</button><small class="bot-model"></small>
    </form><h2>Memory</h2><p>Notes added here are protected from changes by visitors.</p>
    <form class="bot-memory-form"><label>Memory<textarea name="memory" required maxlength="600" rows="2" placeholder="Something the bot should know…"></textarea></label><button type="submit">Add memory</button><button type="button" class="bot-cancel-edit" hidden>Cancel edit</button></form>
    <ul class="bot-memories"></ul><h2>Moderation history</h2><ul class="bot-moderation"></ul></div>
    <p class="bot-feedback" role="status" aria-live="polite"></p></div>`;
  document.body.append(panel);makeDraggable(panel);
  const adminArea=panel.querySelector('.bot-admin'),settings=panel.querySelector('.bot-settings'),memoryForm=panel.querySelector('.bot-memory-form'),feedback=panel.querySelector('.bot-feedback'),memoryInput=memoryForm.elements.memory;
  adminArea.hidden=!admin;
  let stopStatus,stopManage,initialized=false,editingId=null,opener;
  const error=message=>{feedback.textContent=message;};
  async function perform(button,action,message){button.disabled=true;try{await action();feedback.textContent=message;}catch(e){error(e.message);}finally{button.disabled=false;}}
  function resetMemory(){editingId=null;memoryForm.reset();memoryForm.querySelector('[type=submit]').textContent='Add memory';panel.querySelector('.bot-cancel-edit').hidden=true;}
  function button(label,onClick){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>onClick(b);return b;}
  function render(data){
    if(!initialized){for(const name of ['name','personality','moderation'])settings.elements[name].value=data.settings[name];for(const name of ['enabled','roaming'])settings.elements[name].checked=data.settings[name];initialized=true;}
    panel.querySelector('.bot-model').textContent=`Fireworks · ${data.model.split('/').at(-1)}`;
    if(!data.ready)feedback.textContent='Add FIREWORKS_API_KEY to the backend environment to enable replies.';
    else if(data.settings.lastError)feedback.textContent=data.settings.lastError;
    const list=panel.querySelector('.bot-memories');list.replaceChildren();
    for(const m of data.memories){
      const li=document.createElement('li'),text=document.createElement('p'),source=document.createElement('small'),controls=document.createElement('div');
      text.textContent=m.text;source.textContent=`${m.locked?'Protected · ':''}${m.source} · ${new Date(m.updatedAt).toLocaleDateString()}`;
      controls.append(button('Edit',()=>{editingId=m._id;memoryInput.value=m.text;memoryForm.querySelector('[type=submit]').textContent='Save memory';panel.querySelector('.bot-cancel-edit').hidden=false;memoryInput.focus();}),button('Forget',b=>perform(b,async()=>{await api.forgetMemory(m._id);if(editingId===m._id)resetMemory();},'Memory removed.')));
      li.append(text,source,controls);list.append(li);
    }
    if(!data.memories.length){const li=document.createElement('li');li.textContent='No memories yet.';list.append(li);}
    const history=panel.querySelector('.bot-moderation');history.replaceChildren();
    const restored=new Set();
    for(const entry of data.moderation){
      const li=document.createElement('li'),text=document.createElement('p'),evidence=document.createElement('small');text.textContent=`${entry.name} · ${entry.decision==='kick'?'Removed':entry.decision==='warn'?'Warned':'Restored'} — ${entry.reason}`;
      evidence.textContent=entry.evidence?`“${entry.evidence}” · ${new Date(entry.createdAt).toLocaleTimeString()}`:new Date(entry.createdAt).toLocaleTimeString();li.append(text,evidence);
      if(entry.decision==='restore')restored.add(entry.playerId);
      if(entry.decision==='kick'&&entry.expiresAt>Date.now()&&!restored.has(entry.playerId))li.append(button('Allow back',b=>perform(b,()=>api.restore(entry.playerId),'Visitor can return.')));
      if(entry.voiceError){const issue=document.createElement('p');issue.textContent=entry.voiceError;li.append(issue);}
      history.append(li);
    }
    if(!data.moderation.length){const li=document.createElement('li');li.textContent='No warnings or removals.';history.append(li);}
  }
  settings.onsubmit=event=>{event.preventDefault();const fields=settings.elements;void perform(settings.querySelector('[type=submit]'),()=>api.configure({name:fields.name.value,personality:fields.personality.value,enabled:fields.enabled.checked,roaming:fields.roaming.checked,moderation:fields.moderation.value}),'Settings saved.');};
  memoryForm.onsubmit=event=>{event.preventDefault();void perform(memoryForm.querySelector('[type=submit]'),async()=>{await api.saveMemory(memoryInput.value,editingId);resetMemory();},'Memory saved.');};
  panel.querySelector('.bot-cancel-edit').onclick=resetMemory;
  function open(){
    if(!panel.hidden)return;opener=document.activeElement;panel.hidden=false;toggle.setAttribute('aria-expanded','true');initialized=false;feedback.textContent='';
    stopStatus=api.status(state=>{panel.querySelector('.bot-summary').textContent=`${state.name} · ${state.state}`;},error);
    if(admin)stopManage=api.watch(render,error);panel.focus();
  }
  function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');stopStatus?.();stopManage?.();stopStatus=stopManage=null;opener?.focus();}
  toggle.onclick=()=>panel.hidden?open():close();panel.querySelector('.appearance-close').onclick=close;
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
  return {open,close,destroy(){close();toggle.remove();panel.remove();}};
}
