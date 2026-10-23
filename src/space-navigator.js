import {SPACE_LEVELS,levelName} from '../shared/spaces.js';
import {makeDraggable} from './draggable.js';
import {MAIN_ZONE} from '../shared/room-layout.js';

export function createSpaceNavigator({onTeleport,onLevelChange,onClose=()=>{}}){
  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog agent-dialog spaces-dialog';
  dialog.setAttribute('aria-labelledby','spaces-title');
  dialog.innerHTML='<header><h1 id="spaces-title">Teleport</h1><button type="button" class="appearance-close" aria-label="Close teleport">×</button></header><div class="agent-body"><p class="spaces-intro">Choose a space to visit. Stairs connect the levels at the end of the walkways.</p><ul class="spaces-list" aria-label="Destinations"></ul><p class="spaces-status" role="status" aria-live="polite"></p></div>';
  const list=dialog.querySelector('.spaces-list'),status=dialog.querySelector('.spaces-status');
  let spaces=[],busy=false;
  function render(){
    const focused=document.activeElement?.dataset.spaceId,focusedLevel=document.activeElement?.dataset.levelSpace;
    list.replaceChildren();
    for(const space of [{id:MAIN_ZONE,name:'Lobby',ownerName:'The main room'},...spaces]){
      const item=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.className='space-destination';button.dataset.spaceId=space.id;button.disabled=busy;
      const name=document.createElement('strong'),owner=document.createElement('span');
      name.textContent=space.name;owner.textContent=space.id===MAIN_ZONE?(space.ownerName??''):`${levelName(space.level??0)} level · ${space.ownerName??''}`;
      button.append(name,owner);item.append(button);list.append(item);
      if(space.canMove&&onLevelChange){
        const label=document.createElement('label');label.className='space-level';label.textContent='Level';
        const select=document.createElement('select');select.dataset.levelSpace=space.id;select.setAttribute('aria-label',`Level for ${space.name}`);select.disabled=busy;
        for(const level of [...SPACE_LEVELS].reverse()){
          const option=document.createElement('option');option.value=level;option.textContent=levelName(level);select.append(option);
        }
        select.value=space.level??0;label.append(select);item.append(label);
        select.onchange=async()=>{
          if(busy)return;
          busy=true;dialog.setAttribute('aria-busy','true');list.querySelectorAll('button,select').forEach(b=>b.disabled=true);
          const level=Number(select.value);status.textContent=`Moving ${space.name} to the ${levelName(level).toLowerCase()} level…`;
          try{await onLevelChange(space.id,level);spaces=spaces.map(s=>s.id===space.id?{...s,level}:s);status.textContent=`${space.name} is on the ${levelName(level).toLowerCase()} level.`;}
          catch(error){status.textContent=error.message||'Could not move the room. Please try again.';}
          finally{busy=false;dialog.removeAttribute('aria-busy');render();if(dialog.open)list.querySelector(`[data-level-space="${space.id}"]`)?.focus();}
        };
      }
      button.onclick=async()=>{
        if(busy)return;
        busy=true;dialog.setAttribute('aria-busy','true');
        list.querySelectorAll('button,select').forEach(b=>b.disabled=true);
        status.textContent=`Teleporting to ${space.name}…`;
        try{await onTeleport(space.id);dialog.close();}
        catch(error){status.textContent=error.message||'Could not teleport. Please try again.';}
        finally{
          busy=false;dialog.removeAttribute('aria-busy');
          list.querySelectorAll('button,select').forEach(b=>b.disabled=false);
          if(dialog.open)([...list.querySelectorAll('button,select')].find(b=>b.dataset.spaceId===space.id)??list.querySelector('button')).focus();
        }
      };
    }
    if(focusedLevel&&dialog.open)list.querySelector(`[data-level-space="${focusedLevel}"]`)?.focus();
    if(focused&&dialog.open)([...list.querySelectorAll('button,select')].find(b=>b.dataset.spaceId===focused)??list.querySelector('button'))?.focus();
  }
  dialog.querySelector('.appearance-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',onClose);
  document.body.append(dialog);makeDraggable(dialog);
  return {
    open(){if(dialog.open)return;if(!busy)status.textContent='';render();dialog.showModal();(list.querySelector('button:not(:disabled)')??dialog.querySelector('.appearance-close')).focus();},
    receive(value){spaces=value;if(dialog.open)render();},
  };
}
