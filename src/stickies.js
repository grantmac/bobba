import {STICKY_COLORS,STICKY_TEXT_LIMIT,wallExists} from '../shared/stickies.js';

export async function createStickies({network,prepareImage,makeVisual,disposeVisual,positionVisual,worldPoint,getTiles,focusRoom,onPlace}){
  const images=await Promise.all(['left','right'].map(side=>new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Sticky note images could not be loaded.'));image.src=`/assets/stickies/${side}.png`;
  })));
  const frames=new Map();
  for(const [i,side] of ['left','right'].entries())for(const color of STICKY_COLORS)frames.set(side+color,prepareImage(images[i],{matte:true,tint:color}));
  let notes=[],visuals=[],admin=false,joined=false,pending=null,target=null,active=null,busy=false;
  const dialog=document.createElement('dialog');dialog.className='sticky-dialog';dialog.setAttribute('aria-label','Sticky note');
  dialog.innerHTML=`<header><span>Sticky note</span><button type="button" aria-label="Close sticky note"><img src="/assets/stickies/close.png" alt=""></button></header>
    <textarea aria-label="Note text" maxlength="${STICKY_TEXT_LIMIT}" spellcheck="false"></textarea>
    <footer><div class="sticky-colors">${STICKY_COLORS.map((color,i)=>`<button type="button" aria-label="${['Yellow','Green','Pink','Blue'][i]} note" data-color="${color}" style="background:${color}"></button>`).join('')}</div><button type="button" class="sticky-move">Move</button><button type="button" class="sticky-delete" aria-label="Delete sticky note"><img src="/assets/stickies/trash.png" alt=""></button></footer>
    <p class="sticky-error" role="alert" hidden></p><button type="button" class="sticky-discard" hidden>Close without saving</button>`;
  const placing=document.createElement('section');placing.className='furniture-placement sticky-placement';placing.hidden=true;
  placing.innerHTML='<span>Click a wall to place the sticky note.</span><button type="button">Cancel</button>';
  document.body.append(dialog,placing);
  const text=dialog.querySelector('textarea'),error=dialog.querySelector('.sticky-error'),discard=dialog.querySelector('.sticky-discard');
  let draftColor=STICKY_COLORS[0],acceptedText='';
  function color(value){draftColor=value;dialog.style.setProperty('--note-color',value);dialog.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===value)));}
  function close(){dialog.close();active=null;focusRoom();}
  function showError(e){error.hidden=false;error.textContent=e.message;discard.hidden=false;}
  function setBusy(value){busy=value;text.readOnly=value||!joined;dialog.querySelectorAll('button').forEach(b=>b.disabled=value);}
  function open(note){
    if(busy)return;
    active=structuredClone(note);acceptedText=note.text;text.value=note.text;text.readOnly=!joined;color(note.color);
    error.hidden=true;discard.hidden=true;
    dialog.querySelector('.sticky-colors').hidden=!admin;
    dialog.querySelector('.sticky-delete').hidden=!admin;dialog.querySelector('.sticky-move').hidden=!admin;
    text.setAttribute('aria-label',admin?'Note text':joined?'Note text — add to the end':'Note text');
    dialog.showModal();text.focus();text.setSelectionRange(text.value.length,text.value.length);
  }
  async function save(){
    if(!active||!joined)return active;
    const changed=text.value!==active.text||draftColor!==active.color;
    if(!changed)return active;
    if(admin){
      await network.editSticky({id:active.id,revision:active.revision,text:text.value,color:draftColor});
      return {...active,text:text.value,color:draftColor,revision:active.revision+1};
    }
    await network.appendSticky(active.id,text.value.slice(active.text.length));
    return active;
  }
  async function finish(){
    if(busy)return;setBusy(true);
    try{await save();close();}catch(e){showError(e);}finally{setBusy(false);}
  }
  dialog.querySelector('header button').onclick=finish;
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
  discard.onclick=close;
  text.addEventListener('input',()=>{
    if(!admin&&active&&!text.value.startsWith(active.text)){
      text.value=acceptedText;text.setSelectionRange(text.value.length,text.value.length);
    }else acceptedText=text.value;
  });
  dialog.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>color(button.dataset.color));
  dialog.querySelector('.sticky-delete').onclick=async()=>{
    if(busy)return;setBusy(true);
    try{await network.deleteSticky(active.id,active.revision);close();}catch(e){showError(e);}finally{setBusy(false);}
  };
  dialog.querySelector('.sticky-move').onclick=async()=>{
    if(busy)return;setBusy(true);
    try{const note=await save();close();setBusy(false);begin(note);}catch(e){showError(e);}finally{setBusy(false);}
  };
  function cancel(){pending=null;target=null;placing.hidden=true;redraw();focusRoom();}
  placing.querySelector('button').onclick=()=>{if(!busy)cancel();};
  function begin(note=null){
    if(!admin||busy)return;
    onPlace();pending=note??{id:crypto.randomUUID(),text:'',color:STICKY_COLORS[0],revision:0,new:true};target=null;
    placing.querySelector('span').textContent='Click a wall to place the sticky note.';placing.hidden=false;redraw();focusRoom();
  }
  function screenPosition(note){
    const p=worldPoint(note.x,note.z);
    return {x:p.x+(note.side==='left'?-1:1)*note.u*32-7,y:p.y+note.u*16-note.height-9};
  }
  function redraw(){
    visuals.forEach(v=>disposeVisual(v.mesh));visuals=[];
    const tiles=getTiles();
    const shown=notes.filter(n=>n.id!==pending?.id&&wallExists(n,tiles));
    if(pending&&target)shown.push({...pending,...target,ghost:true});
    for(const note of shown){
      const canvas=frames.get(note.side+note.color);if(!canvas)continue;
      const mesh=makeVisual(canvas),p=screenPosition(note);mesh.material.opacity=note.ghost?.65:1;
      positionVisual(mesh,p.x,p.y,canvas.width,canvas.height,95);
      visuals.push({note,mesh,p,width:canvas.width,height:canvas.height});
    }
  }
  function wallAt(point){
    const tiles=getTiles(),hits=[];
    for(const key of tiles){
      const [x,z]=key.split(',').map(Number),p=worldPoint(x,z);
      for(const side of ['left','right']){
        if(!wallExists({x,z,side},tiles))continue;
        const u=(point.x-p.x)/32*(side==='left'?-1:1),height=p.y+u*16-point.y;
        if(u>=0&&u<=1&&height>=12&&height<=112)hits.push({x,z,side,u:Math.max(.25,Math.min(.75,u)),height:Math.max(24,Math.min(100,height))});
      }
    }
    return hits.sort((a,b)=>(b.x+b.z)-(a.x+a.z))[0]??null;
  }
  async function place(){
    if(!target||busy)return;
    const note={...pending,...target};setBusy(true);placing.querySelector('button').disabled=true;
    try{
      const {x,z,side,u,height}=target;
      if(pending.new)await network.createSticky(note.id,{x,z,side,u,height});
      else await network.editSticky({id:note.id,revision:note.revision,text:note.text,color:note.color,position:{x,z,side,u,height}});
      pending=null;target=null;placing.hidden=true;redraw();
      setBusy(false);if(note.new)open({...note,revision:0});
    }catch(e){placing.querySelector('span').textContent=e.message;}
    finally{setBusy(false);placing.querySelector('button').disabled=false;}
  }
  return {
    begin,redraw,
    connect(isAdmin){admin=isAdmin;joined=true;},
    receive(value){
      const changed=JSON.stringify(value)!==JSON.stringify(notes),wasPresent=active&&notes.some(n=>n.id===active.id);notes=structuredClone(value);
      if(active&&wasPresent&&!notes.some(n=>n.id===active.id)&&!busy)close();
      if(changed)redraw();
    },
    pointer(point,click=false){
      if(pending){if(!busy){target=wallAt(point);redraw();if(click)place();}return true;}
      const hit=[...visuals].reverse().find(v=>point.x>=v.p.x-3&&point.x<v.p.x+v.width+3&&point.y>=v.p.y-3&&point.y<v.p.y+v.height+3);
      if(hit&&click)open(hit.note);return !!hit;
    },
    key(event){if(pending&&event.key==='Escape'){if(!busy)cancel();return true;}return false;},
  };
}
