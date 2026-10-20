import {footprint,isPlaced,canPlace,blocksTile,restoreItems,canStack,surfaceHeight,moveWithContents,pickupWithContents} from './furniture-model.js';
import {LinearFilter} from 'three';
import {POSTERS} from '../shared/stickies.js';
import {drawMacintoshScreen,macintoshScreenPhase} from './macintosh-screen.js';

const ROOT='/assets/furniture/';
export async function createFurniture({prepareImage,makeVisual,disposeVisual,positionVisual,markTiles,worldPoint,isTile,getAvatar,stopWalking,onChanged,onSit,focusRoom,onPlaceSticky,onPlacePoster,initialItems=[]}){
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
      const density=def.spriteDensity??1;
      function paint(parts,phase=5,existing){
        const canvas=existing??document.createElement('canvas');canvas.width=(right-left)*density;canvas.height=(bottom-top)*density;
        const ctx=canvas.getContext('2d');
        ctx.imageSmoothingEnabled=density>1;ctx.scale(density,density);
        if(view.mirror){ctx.translate(right-left,0);ctx.scale(-1,1);}
        parts.forEach(p=>{
          const x=-p.reg.x-left,y=-p.reg.y-top;
          ctx.drawImage(p.canvas,x,y,p.width,p.height);
          if(def.id==='custom_macintosh')drawMacintoshScreen(ctx,x,y,p.width,p.height,phase,view.mirror);
        });
        return {canvas,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      }
      const full=paint(layers);
      // Original chair/sofa layers straddle the seated avatar's depth.
      const slices=def.category==='Seating'?layers.filter(p=>p.width>1&&p.height>1).map(p=>({...paint([p]),orderShift:p.z/100})):null;
      const frame={...full,density,left:(view.mirror?64-right:left)-32,top:top+16};
      if(def.id==='custom_macintosh')frame.animate=phase=>paint(layers,phase,frame.canvas);
      if(slices?.length)frame.slices=slices.map(slice=>({...frame,...slice}));
      frames.set(`${def.id}:${view.direction}`,frame);
    }
    })();
    loading.set(def.id,promise);return promise;
  }
  await Promise.all([...new Set(initialItems.filter(isPlaced).map(i=>i.type))].filter(id=>definitions.has(id)).map(id=>loadDefinition(definitions.get(id))));
  let page=0;const pageSize=48;
  let viewItems=[],items=[],history=[],selected=null,pending=null,visuals=[],tab='Catalogue',filter='',category='All',editable=true,networkSave=null,saving=false;
  items=restoreItems(initialItems,definitions);
  function fitStoredItems(){
    const fitted=[];
    for(const item of [...items].sort((a,b)=>Number(!!a.supportId)-Number(!!b.supportId))){
      if(isPlaced(item)&&!canPlace(item,fitted,definitions,isTile)){item.x=null;item.z=null;delete item.supportId;}
      fitted.push(item);
    }
  }
  fitStoredItems();
  const panel=document.createElement('section');panel.className='furniture-panel';panel.hidden=true;panel.setAttribute('aria-label','Furniture');
  panel.innerHTML=`<header><h1>Furniture</h1><button class="furniture-close" aria-label="Close furniture">×</button></header><nav aria-label="Furniture views">${['Catalogue','Inventory','In room'].map(name=>`<button type="button" data-tab="${name}">${name}</button>`).join('')}</nav><div class="furniture-filters"><input type="search" aria-label="Search furniture" placeholder="Search furniture"><select aria-label="Furniture category">${['All',...new Set(catalog.map(d=>d.category))].map(name=>`<option>${name}</option>`).join('')}</select></div><p class="furniture-description"></p><div class="furniture-grid"></div><div class="furniture-pages"><button type="button" aria-label="Previous furniture page">◀</button><span></span><button type="button" aria-label="Next furniture page">▶</button></div><footer><button class="furniture-undo">Undo</button><span class="furniture-count"></span></footer>`;
  const actions=document.createElement('section');actions.className='furniture-actions';actions.hidden=true;actions.setAttribute('aria-label','Selected furniture');
  const stickyButton=document.createElement('button');stickyButton.type='button';stickyButton.className='sticky-catalogue';
  stickyButton.innerHTML='<img src="/assets/stickies/icon.png" alt=""> Sticky note';
  stickyButton.onclick=()=>{panel.hidden=true;cancel();onPlaceSticky?.();};
  panel.querySelector('.furniture-filters').after(stickyButton);
  const posters=document.createElement('div');posters.className='poster-catalogue';
  for(const [id,def] of Object.entries(POSTERS)){
    const button=document.createElement('button');button.type='button';button.className='sticky-catalogue';button.setAttribute('aria-label',`Place ${def.name}`);
    const img=document.createElement('img');img.src=def.file;img.alt='';
    button.append(img,document.createTextNode(def.name));button.onclick=()=>{panel.hidden=true;cancel();onPlacePoster?.(id);};
    posters.append(button);
  }
  stickyButton.after(posters);
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
    change(()=>{items=pickupWithContents(items,id,true);selected=null;});
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
  let screenPhase=-1;
  function animate(now){
    const phase=macintoshScreenPhase(now);
    if(phase===screenPhase)return;
    screenPhase=phase;
    const updated=new Set();
    for(const {frame,mesh} of visuals){
      if(!frame.animate)continue;
      if(!updated.has(frame)){frame.animate(phase);updated.add(frame);}
      if(mesh.material.map)mesh.material.map.needsUpdate=true;
    }
  }
  function visible(item){return isPlaced(item)&&footprint(item,definitions.get(item.type)).every(([x,z])=>isTile(x,z));}
  function redraw(){
    visuals.forEach(v=>disposeVisual(v.mesh));visuals=[];
    viewItems=pending?moveWithContents(items,pending,definitions):items;
    for(const item of viewItems){
      if(!visible(item))continue;
      const frame=frameFor(item);
      if(!frame){loadDefinition(definitions.get(item.type)).then(redraw).catch(error=>{panel.querySelector('.furniture-description').textContent=error.message;});continue;}
      for(const slice of frame.slices??[frame]){
      const mesh=makeVisual(slice.canvas);
      if(slice.density>1){
        mesh.scale?.setScalar(1/slice.density);
        if(mesh.material.map){mesh.material.map.minFilter=LinearFilter;mesh.material.map.magFilter=LinearFilter;}
      }
      if(pending&&(item.id===pending.id||item.supportId===pending.id))mesh.material.opacity=.65;visuals.push({item,frame:slice,mesh});
      }
    }

    refreshPositions();
  }
  function refreshPositions(){
    for(const {item,frame,mesh} of visuals){
      const def=definitions.get(item.type),p=worldPoint(item.x,item.z),cells=footprint(item,def);
      const table=viewItems.find(t=>t.id===item.supportId),orderCells=table?footprint(table,definitions.get(table.type)):cells;
      const order=def.category==='Rugs'?20:def.category==='Seating'?300+(item.x+item.z)*10+9+(frame.orderShift??0):300+Math.max(...orderCells.map(([x,z])=>x+z))*10+9+(table?0.1+(item.x+item.z)/100:0);
      const height=surfaceHeight(item,viewItems,definitions);
      positionVisual(mesh,p.x+frame.left,p.y+frame.top-height+(table?def.tableOffsetY??0:0),frame.canvas.width/frame.density,frame.canvas.height/frame.density,order);
    }
    const item=pending||items.find(i=>i.id===selected);
    const cells=item&&visible(item)?footprint(item,definitions.get(item.type)):[];
    markTiles(cells,pending?(validPlacement(pending)?'#65e58c':'#ff7777'):'#f8e39a');
  }
  function renderList(){
    stickyButton.hidden=tab!=='Catalogue'||!onPlaceSticky;
    posters.hidden=tab!=='Catalogue'||!onPlacePoster;
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
    if(!actions.hidden){actions.querySelector('img').src=ROOT+def.icon;actions.querySelector('strong').textContent=def.name;actions.querySelector('.furniture-location').textContent=item.supportId?'On table':`Tile ${item.x+1}, ${item.z+1}`;actions.querySelector('[data-action="Rotate"]').disabled=def.views.length<2;}
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
    if(!validPlacement(pending)){return true;}
    const item={...pending};pending=null;selected=item.id;
    change(()=>{items=moveWithContents(items,item,definitions);});return true;
  }
  function rotate(){
    const item=pending||items.find(i=>i.id===selected);if(!item)return;
    const views=definitions.get(item.type).views;if(views.length<2)return;
    const rotation=views[(views.findIndex(v=>v.direction===item.rotation)+1)%views.length].direction;
    if(pending){pending.rotation=rotation;render();return;}
    if(!validPlacement({...item,rotation})){return;}
    change(()=>{items=moveWithContents(items,{...item,rotation},definitions);});
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
      case 'Pick up':change(()=>{items=pickupWithContents(items,item.id);selected=null;});break;
      case 'Delete':{
        deleteId=item.id;const def=definitions.get(item.type);
        confirmation.querySelector('img').src=ROOT+def.icon;confirmation.querySelector('strong').textContent=def.name;
        confirmation.showModal();confirmation.querySelector('[data-confirm="cancel"]').focus();break;
      }
    }
  });
  placement.querySelector('[data-placement="cancel"]').onclick=cancel;placement.querySelector('[data-placement="rotate"]').onclick=rotate;
  function open(view){if(!editable)return;cancel();selected=null;tab=view;page=0;panel.hidden=false;render();panel.querySelector('input').focus();}
  function validPlacement(item){
    const next=moveWithContents(items,item,definitions);
    return next.filter(i=>i.id===item.id||i.supportId===item.id).every(i=>canPlace(i,next,definitions,isTile,getAvatar()));
  }
  function hitVisual(point){
    return [...visuals].sort((a,b)=>b.mesh.renderOrder-a.mesh.renderOrder).find(({item,frame})=>{
      if(pending&&(item.id===pending.id||item.supportId===pending.id))return false;
      const p=worldPoint(item.x,item.z),x=Math.floor((point.x-p.x-frame.left)*frame.density),y=Math.floor((point.y-p.y-frame.top+surfaceHeight(item,viewItems,definitions)-(item.supportId?definitions.get(item.type).tableOffsetY??0:0))*frame.density);
      return x>=0&&y>=0&&x<frame.canvas.width&&y<frame.canvas.height&&frame.pixels[(y*frame.canvas.width+x)*4+3]>40;
    });
  }
  function placementTarget(point,cell){
    if(!canStack(definitions.get(pending.type)))return {...cell};
    const hit=hitVisual(point)?.item;
    const table=hit?.supportId?items.find(i=>i.id===hit.supportId):hit;
    if(!table||table.id===pending.id||definitions.get(table.type).category!=='Tables')return {...cell};
    const p=worldPoint(table.x,table.z),height=definitions.get(table.type).surfaceHeight;
    const dx=point.x-p.x,dy=point.y+height-p.y;
    const cells=footprint(table,definitions.get(table.type));
    const x=Math.max(table.x,Math.min(Math.max(...cells.map(c=>c[0])),table.x+Math.floor(dx/64+dy/32)));
    const z=Math.max(table.z,Math.min(Math.max(...cells.map(c=>c[1])),table.z+Math.floor(dy/32-dx/64)));
    return {x,z,supportId:table.id};
  }
  function pointer(point,cell,click=false){
    if(pending){
      const target=placementTarget(point,cell);
      const changed=pending.x!==(target?.x??null)||pending.z!==(target?.z??null)||pending.supportId!==target.supportId;
      delete pending.supportId;Object.assign(pending,{x:target.x??null,z:target.z??null},target);
      if(changed)redraw();if(click){commit();render();}return true;
    }
    const hit=hitVisual(point);
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
  return {open,pointer,key,roomChanged,redraw,seat,animate,blocks:(x,z)=>blocksTile(x,z,items,definitions),close:()=>{cancel();selected=null;panel.hidden=true;render();},get placing(){return !!pending;},
    getItems:()=>structuredClone(items),
    connect({admin,onSave}){editable=admin;networkSave=onSave;history=[];render();},
    receive(next){items=restoreItems(next,definitions);if(pending&&selected&&!items.some(i=>i.id===selected))pending=null;render();}
  };
}
