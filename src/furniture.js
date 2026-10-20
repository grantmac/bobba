import {footprint,isPlaced,canPlace,blocksTile,restoreItems} from './furniture-model.js';

const ROOT='/assets/furniture/';
export async function createFurniture({prepareImage,makeVisual,disposeVisual,positionVisual,markTiles,worldPoint,isTile,getAvatar,stopWalking,onChanged,onSit,focusRoom,initialItems=[]}){
  const response=await fetch(ROOT+'catalog.json');
  if(!response.ok)throw new Error('Furniture could not be loaded.');
  const catalog=await response.json(),definitions=new Map(catalog.map(d=>[d.id,d]));
  const frames=new Map(),loading=new Map();
  function loadDefinition(def){
    if(loading.has(def.id))return loading.get(def.id);
    const promise=(async()=>{
    const parts=await Promise.all(def.parts.map(part=>new Promise((resolve,reject)=>{
      const image=new Image();image.onload=()=>resolve({...part,canvas:prepareImage(image,{matte:!part.alphaPrepared})});image.onerror=()=>reject(new Error(`Could not load ${part.file}`));image.src=ROOT+part.file;
    })));
    for(const view of def.views){
      const layers=parts.filter(p=>p.direction===view.source).sort((a,b)=>a.z-b.z||a.layer.localeCompare(b.layer));
      let left=Math.min(...layers.map(p=>-p.reg.x)),top=Math.min(...layers.map(p=>-p.reg.y));
      let right=Math.max(...layers.map(p=>-p.reg.x+p.width)),bottom=Math.max(...layers.map(p=>-p.reg.y+p.height));
      const canvas=document.createElement('canvas');canvas.width=right-left;canvas.height=bottom-top;
      const ctx=canvas.getContext('2d');
      if(view.mirror){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
      layers.forEach(p=>ctx.drawImage(p.canvas,-p.reg.x-left,-p.reg.y-top));
      if(view.mirror)left=64-right;
      frames.set(`${def.id}:${view.direction}`,{canvas,left:left-32,top:top+16,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data});
    }
    })();
    loading.set(def.id,promise);return promise;
  }
  await Promise.all([...new Set(initialItems.filter(isPlaced).map(i=>i.type))].filter(id=>definitions.has(id)).map(id=>loadDefinition(definitions.get(id))));
  let page=0;const pageSize=48;
  let items=[],history=[],selected=null,pending=null,visuals=[],tab='Catalogue',filter='',category='All',editable=true,networkSave=null,saving=false;
  items=restoreItems(initialItems,definitions);
  function fitStoredItems(){
    const fitted=[];
    for(const item of items){
      if(isPlaced(item)&&!canPlace(item,fitted,definitions,isTile)){item.x=null;item.z=null;}
      fitted.push(item);
    }
  }
  fitStoredItems();
  const panel=document.createElement('section');panel.className='furniture-panel';panel.hidden=true;panel.setAttribute('aria-label','Furniture');
  panel.innerHTML=`<header><h1>Furniture</h1><button class="furniture-close" aria-label="Close furniture">×</button></header><nav aria-label="Furniture views">${['Catalogue','Inventory','In room'].map(name=>`<button type="button" data-tab="${name}">${name}</button>`).join('')}</nav><div class="furniture-filters"><input type="search" aria-label="Search furniture" placeholder="Search furniture"><select aria-label="Furniture category">${['All',...new Set(catalog.map(d=>d.category))].map(name=>`<option>${name}</option>`).join('')}</select></div><p class="furniture-description"></p><div class="furniture-grid"></div><div class="furniture-pages"><button type="button" aria-label="Previous furniture page">◀</button><span></span><button type="button" aria-label="Next furniture page">▶</button></div><footer><button class="furniture-undo">Undo</button><span class="furniture-count"></span></footer>`;
  const actions=document.createElement('section');actions.className='furniture-actions';actions.hidden=true;actions.setAttribute('aria-label','Selected furniture');
  actions.innerHTML=`<button class="furniture-close" aria-label="Deselect furniture">×</button><img alt=""><strong></strong><span class="furniture-location"></span><div>${['Move','Rotate','Pick up','Delete'].map(name=>`<button data-action="${name}">${name}</button>`).join('')}</div>`;
  const placement=document.createElement('section');placement.className='furniture-placement';placement.hidden=true;
  placement.innerHTML='<span></span><button data-placement="rotate">Rotate (R)</button><button data-placement="cancel">Cancel (Esc)</button>';
  const confirmation=document.createElement('dialog');confirmation.className='appearance-dialog furniture-confirm';
  confirmation.setAttribute('aria-labelledby','furniture-confirm-title');confirmation.setAttribute('aria-describedby','furniture-confirm-message');
  confirmation.innerHTML='<header><h1 id="furniture-confirm-title">Confirm delete</h1><button class="appearance-close" aria-label="Close delete confirmation">×</button></header><div class="furniture-confirm-body"><img alt=""><strong></strong><p id="furniture-confirm-message">Are you absolutely sure you want to delete this item?</p></div><footer><button data-confirm="cancel">Cancel</button><button data-confirm="delete">Delete</button></footer>';
  document.body.append(panel,actions,placement,confirmation);
  let deleteId=null;
  function closeConfirmation(){confirmation.close();deleteId=null;actions.querySelector('[data-action="Delete"]').focus();}
  confirmation.querySelector('[data-confirm="cancel"]').onclick=closeConfirmation;
  confirmation.querySelector('.appearance-close').onclick=closeConfirmation;
  confirmation.addEventListener('cancel',event=>{event.preventDefault();closeConfirmation();});
  confirmation.querySelector('[data-confirm="delete"]').onclick=()=>{
    const id=deleteId;confirmation.close();deleteId=null;
    if(!items.some(item=>item.id===id))return;
    change(()=>{items=items.filter(item=>item.id!==id);selected=null;});
    focusRoom();
  };
  async function change(mutate,record=true){
    if(!editable||saving||!networkSave)return;
    stopWalking();const previous=structuredClone(items),oldHistory=[...history];if(record){history.push(previous);history=history.slice(-10);}mutate();onChanged();render();
    if(networkSave){
      saving=true;render();
      let message='';
      try{await networkSave(structuredClone(items));}catch(error){items=previous;history=oldHistory;message=error.message;}
      finally{saving=false;render();if(message)panel.querySelector('.furniture-description').textContent=message;}
    }
  }
  function frameFor(item){return frames.get(`${item.type}:${item.rotation}`);}
  function visible(item){return isPlaced(item)&&footprint(item,definitions.get(item.type)).every(([x,z])=>isTile(x,z));}
  function redraw(){
    visuals.forEach(v=>disposeVisual(v.mesh));visuals=[];
    for(const item of items){
      if(!visible(item)||pending?.id===item.id)continue;
      const frame=frameFor(item);
      if(!frame){loadDefinition(definitions.get(item.type)).then(redraw).catch(error=>{panel.querySelector('.furniture-description').textContent=error.message;});continue;}
      const mesh=makeVisual(frame.canvas);visuals.push({item,frame,mesh});
    }
    if(pending&&isPlaced(pending)){const frame=frameFor(pending);if(frame){const mesh=makeVisual(frame.canvas);mesh.material.opacity=.65;visuals.push({item:pending,frame,mesh});}else loadDefinition(definitions.get(pending.type)).then(redraw).catch(error=>{panel.querySelector('.furniture-description').textContent=error.message;});}
    refreshPositions();
  }
  function refreshPositions(){
    for(const {item,frame,mesh} of visuals){
      const def=definitions.get(item.type),p=worldPoint(item.x,item.z),cells=footprint(item,def);
      const order=def.category==='Rugs'?20:300+Math.max(...cells.map(([x,z])=>x+z))*10+9;
      positionVisual(mesh,p.x+frame.left,p.y+frame.top,frame.canvas.width,frame.canvas.height,order);
    }
    const item=pending||items.find(i=>i.id===selected);
    const cells=item&&visible(item)?footprint(item,definitions.get(item.type)):[];
    markTiles(cells,pending?(canPlace(pending,items,definitions,isTile,getAvatar())?'#65e58c':'#ff7777'):'#f8e39a');
  }
  function renderList(){
    panel.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
    panel.querySelector('.furniture-description').textContent=tab==='Catalogue'?'Choose a piece, then click a floor tile to place it.':tab==='Inventory'?'Furniture you have picked up. Click a piece to put it back.':'Select a piece to move, rotate, pick up, or delete it.';
    const grid=panel.querySelector('.furniture-grid');grid.replaceChildren();
    const entries=tab==='Catalogue'?catalog.map(def=>({def})):items.filter(i=>tab==='Inventory'?!isPlaced(i):isPlaced(i)).map(item=>({def:definitions.get(item.type),item}));
    const matching=entries.filter(({def})=>(category==='All'||category===def.category)&&`${def.name} ${def.id}`.toLowerCase().includes(filter));
    const pages=Math.max(1,Math.ceil(matching.length/pageSize));page=Math.max(0,Math.min(page,pages-1));
    panel.querySelector('.furniture-pages span').textContent=`${page+1} / ${pages} · ${matching.length} pieces`;
    const pageButtons=panel.querySelectorAll('.furniture-pages button');pageButtons[0].disabled=page===0;pageButtons[1].disabled=page===pages-1;
    for(const {def,item} of matching.slice(page*pageSize,(page+1)*pageSize)){
      const button=document.createElement('button');button.className='furniture-card';button.type='button';button.setAttribute('aria-label',`${tab==='In room'?'Select':'Place'} ${def.name}`);
      if(item){button.dataset.itemId=item.id;button.dataset.cell=isPlaced(item)?`${item.x},${item.z}`:'inventory';button.dataset.rotation=item.rotation;button.setAttribute('aria-pressed',String(selected===item.id));}
      const img=document.createElement('img');img.src=ROOT+def.icon;img.alt='';img.loading='lazy';const label=document.createElement('span');label.textContent=def.name;button.append(img,label);
      button.onclick=()=>{if(tab==='In room'){cancel();selected=item.id;render();}else begin(item||{id:crypto.randomUUID(),type:def.id,rotation:def.views.find(v=>v.direction===2)?.direction??def.views[0].direction,x:null,z:null});};
      grid.append(button);
    }
    if(!matching.length){const empty=document.createElement('p');empty.className='furniture-empty';empty.textContent=filter?'No matching furniture.':tab==='Inventory'?'Your hand is empty. Pick up furniture from your room to store it here.':'No furniture here yet.';grid.append(empty);}
    panel.querySelector('.furniture-count').textContent=`${items.filter(isPlaced).length} in room · ${items.filter(i=>!isPlaced(i)).length} in hand`;
    panel.querySelector('.furniture-undo').disabled=!history.length;
  }
  function render(){
    renderList();redraw();const item=items.find(i=>i.id===selected),def=item&&definitions.get(item.type);
    actions.hidden=!editable||!item||!isPlaced(item)||!!pending;
    if(!actions.hidden){actions.querySelector('img').src=ROOT+def.icon;actions.querySelector('strong').textContent=def.name;actions.querySelector('.furniture-location').textContent=`Tile ${item.x+1}, ${item.z+1}`;actions.querySelector('[data-action="Rotate"]').disabled=def.views.length<2;}
    actions.querySelectorAll('[data-action]').forEach(button=>{button.hidden=!editable;if(saving)button.disabled=true;else if(button.dataset.action!=='Rotate')button.disabled=false;});
    placement.hidden=!pending;
    if(pending){placement.querySelector('span').textContent=definitions.get(pending.type).name;placement.querySelector('[data-placement="rotate"]').disabled=definitions.get(pending.type).views.length<2;}
  }
  function begin(item){
    if(!editable||saving)return;
    if(items.length>=200&&!items.some(i=>i.id===item.id)){panel.querySelector('.furniture-description').textContent='Furniture limit reached (200 items).';return;}
    stopWalking();selected=null;pending={...item};panel.hidden=true;
    if(!isPlaced(pending)){
      const avatar=getAvatar(),candidates=[];
      for(let x=0;x<30;x++)for(let z=0;z<30;z++)if(isTile(x,z))candidates.push({x,z});
      candidates.sort((a,b)=>Math.hypot(a.x-avatar.x,a.z-avatar.z)-Math.hypot(b.x-avatar.x,b.z-avatar.z));
      const first=candidates.find(cell=>canPlace({...pending,...cell},items,definitions,isTile,avatar));
      if(first)Object.assign(pending,first);
    }
    render();focusRoom();
  }
  function cancel(){pending=null;render();}
  function commit(){
    if(!pending)return false;
    if(!canPlace(pending,items,definitions,isTile,getAvatar())){return true;}
    const item={...pending};pending=null;selected=item.id;
    change(()=>{const index=items.findIndex(i=>i.id===item.id);if(index>=0)items[index]=item;else items.push(item);});return true;
  }
  function rotate(){
    const item=pending||items.find(i=>i.id===selected);if(!item)return;
    const views=definitions.get(item.type).views;if(views.length<2)return;
    const rotation=views[(views.findIndex(v=>v.direction===item.rotation)+1)%views.length].direction;
    if(pending){pending.rotation=rotation;render();return;}
    if(!canPlace({...item,rotation},items,definitions,isTile,getAvatar())){return;}
    change(()=>item.rotation=rotation);
  }
  panel.querySelector('.furniture-close').onclick=()=>{panel.hidden=true;focusRoom();};
  panel.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;page=0;renderList();});
  panel.querySelector('input').oninput=event=>{filter=event.target.value.toLowerCase().trim();page=0;renderList();};
  panel.querySelector('select').onchange=event=>{category=event.target.value;page=0;renderList();};
  panel.querySelectorAll('.furniture-pages button').forEach((button,i)=>button.onclick=()=>{page+=i?1:-1;renderList();});
  panel.querySelector('.furniture-undo').onclick=()=>{
    if(!history.length||saving||!editable)return;
    const previous=history.at(-1);change(()=>{history.pop();items=previous;fitStoredItems();selected=null;},false);
  };
  actions.querySelector('.furniture-close').onclick=()=>{selected=null;render();};
  actions.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>{
    const item=items.find(i=>i.id===selected);if(!item)return;
    switch(button.dataset.action){
      case 'Move':begin(item);break;
      case 'Rotate':rotate();break;
      case 'Pick up':change(()=>{item.x=null;item.z=null;selected=null;});break;
      case 'Delete':{
        deleteId=item.id;const def=definitions.get(item.type);
        confirmation.querySelector('img').src=ROOT+def.icon;confirmation.querySelector('strong').textContent=def.name;
        confirmation.showModal();confirmation.querySelector('[data-confirm="cancel"]').focus();break;
      }
    }
  });
  placement.querySelector('[data-placement="cancel"]').onclick=cancel;placement.querySelector('[data-placement="rotate"]').onclick=rotate;
  function open(view){if(!editable)return;cancel();selected=null;tab=view;page=0;panel.hidden=false;render();panel.querySelector('input').focus();}
  function pointer(point,cell,click=false){
    if(pending){
      const changed=pending.x!==(cell?.x??null)||pending.z!==(cell?.z??null);
      if(cell){pending.x=cell.x;pending.z=cell.z;}else{pending.x=null;pending.z=null;}
      if(changed)redraw();if(click){commit();render();}return true;
    }
    const hit=[...visuals].sort((a,b)=>b.mesh.renderOrder-a.mesh.renderOrder).find(({item,frame})=>{
      const p=worldPoint(item.x,item.z),x=Math.floor(point.x-p.x-frame.left),y=Math.floor(point.y-p.y-frame.top);
      return x>=0&&y>=0&&x<frame.canvas.width&&y<frame.canvas.height&&frame.pixels[(y*frame.canvas.width+x)*4+3]>40;
    });
    if(click){selected=editable?(hit?.item.id??null):null;render();if(hit&&definitions.get(hit.item.type).category==='Seating')onSit(seat(hit.item.id));}
    return !!hit&&definitions.get(hit.item.type).category!=='Rugs';
  }
  function key(event){
    if(event.key==='Escape'){cancel();selected=null;panel.hidden=true;render();return true;}
    if(!pending)return false;
    if(event.key.toLowerCase()==='r'){rotate();return true;}
    if(event.key==='Enter'){commit();return true;}
    const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
    if(delta){pending.x=(pending.x??0)+delta[0];pending.z=(pending.z??0)+delta[1];redraw();return true;}
    return false;
  }
  function roomChanged(commit=false){
    cancel();selected=null;
    if(commit&&!networkSave){
      const displaced=items.filter(item=>isPlaced(item)&&!visible(item));
      if(displaced.length){change(()=>displaced.forEach(item=>{item.x=null;item.z=null;}));}
    }
    render();
  }
  function seat(id){
    const item=items.find(i=>i.id===id);
    if(!item||!visible(item)||definitions.get(item.type).category!=='Seating')return null;
    return {id,cells:footprint(item,definitions.get(item.type)),direction:item.rotation,offsetY:item.type==='throne'?4:16};
  }
  render();
  return {open,pointer,key,roomChanged,redraw,seat,blocks:(x,z)=>blocksTile(x,z,items,definitions),close:()=>{cancel();selected=null;panel.hidden=true;render();},get placing(){return !!pending;},
    getItems:()=>structuredClone(items),
    connect({admin,onSave}){editable=admin;networkSave=onSave;history=[];render();},
    receive(next){items=restoreItems(next,definitions);if(pending&&selected&&!items.some(i=>i.id===selected))pending=null;render();}
  };
}
