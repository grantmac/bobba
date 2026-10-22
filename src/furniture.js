import {footprint,isPlaced,canPlace,blocksTile,restoreItems,canStack,surfaceHeight,moveWithContents,pickupWithContents,seatFor,approachFor,isWallItem,canHang,wallAnchor} from './furniture-model.js';
import {LinearFilter,NearestFilter} from 'three';
import {drawMacintoshScreen,macintoshScreenPhase} from './macintosh-screen.js';
import {spriteSheetFrames} from './furniture-spritesheet.js';
import {prepareCarGlass} from './car-glass.js';
import {createBalloonMotion} from './balloon-motion.js';
import {createSpeakerMotion} from './speaker-motion.js';

const ROOT='/assets/furniture/';
// Built pieces reference their sprites by URL; the shipped catalogue by file name.
const src=file=>/^https?:\/\//.test(file)?file:ROOT+file;
// Sprites served from storage must load with CORS so their canvases can be read back.
const load=(image,file)=>{if(/^https?:\/\//.test(file))image.crossOrigin='anonymous';image.src=src(file);};
// Pieces a click uses rather than selects: the player walks up to them first.
// The wall face is 117 px tall above the floor line; hung pieces are kept within it.
const WALL_FACE=117;
const USABLE=new Set(['custom_dj_decks','fridge','dmg_fridge','custom_logbook','asset_kd7acza4w9bg93w99rxrd5346x8gpfwq']);
export async function createFurniture({prepareImage,makeVisual,disposeVisual,positionVisual,markTiles,worldPoint,isTile,getAvatar,stopWalking,onChanged,onSit,onUse=()=>{},onInspect=()=>{},canBuildAt=()=>true,focusRoom,onAttachAgent,floorHeight=()=>0,hasWall=()=>false,walls=()=>[],initialItems=[],initialAssets=[]}){
  const response=await fetch(ROOT+'catalog.json');
  if(!response.ok)throw new Error('Furniture could not be loaded.');
  let catalog=[...await response.json(),...initialAssets];const definitions=new Map(catalog.map(d=>[d.id,d]));
  const frames=new Map(),loading=new Map();
  function loadDefinition(def){
    if(loading.has(def.id))return loading.get(def.id);
    const promise=(async()=>{
    const parts=await Promise.all(def.parts.map(part=>new Promise((resolve,reject)=>{
      const image=new Image();image.onload=async()=>{
        try{
          const cells=part.frames?spriteSheetFrames(image,part.frames,part.trimFrames!==false):null;
          if(part.translucentWindows)cells?.forEach(prepareCarGlass);
          let offCanvas;
          if(part.offFile){
            const off=new Image();await new Promise((resolve,reject)=>{off.onload=resolve;off.onerror=()=>reject(new Error(`Could not load ${part.offFile}`));load(off,part.offFile);});
            [offCanvas]=spriteSheetFrames(off,[{x:0,y:0,width:off.width,height:off.height}]);
          }
          resolve({...part,cells,offCanvas,canvas:cells?.[0]??prepareImage(image,{matte:!part.alphaPrepared})});
        }catch(error){reject(error);}
      };image.onerror=()=>reject(new Error(`Could not load ${part.file}`));load(image,part.file);
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
          ctx.drawImage(p.cells?.[phase%p.cells.length]??p.canvas,x,y,p.width,p.height);
          if(def.id==='custom_macintosh')drawMacintoshScreen(ctx,x,y,p.width,p.height,phase,view.mirror);
        });
        return {canvas,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      }
      // Parts tagged with a state (the fridge's open door) only appear in that state's frame.
      const resting=layers.filter(p=>!p.state);
      const full=paint(resting,def.frameDuration?0:5);
      // Original chair/sofa layers straddle the seated avatar's depth.
      const slices=def.category==='Seating'?resting.filter(p=>p.width>1&&p.height>1).map(p=>({...paint([p]),orderShift:p.z/100})):null;
      const frame={...full,density,left:(view.mirror?64-right:left)-32,top:top+16};
      if(def.frameDuration)frame.off={...frame,...paint(resting.map(p=>p.offCanvas?{...p,cells:null,canvas:p.offCanvas}:p),0)};
      if(layers.some(p=>p.state==='open'))frame.open={...frame,...paint(layers.filter(p=>!p.state||p.state==='open'),def.frameDuration?0:5)};
      if(def.id==='custom_macintosh'||def.frameDuration){
        let lastPhase=-1;
        frame.animate=now=>{
          const phase=def.frameDuration?Math.floor(now/def.frameDuration)%resting[0].cells.length:macintoshScreenPhase(now);
          if(phase===lastPhase)return false;
          lastPhase=phase;frame.pixels=paint(resting,phase,frame.canvas).pixels;return true;
        };
      }
      if(def.id==='anniv_balloongift'){
        const motion=createBalloonMotion(frame.canvas);
        frame.canvas=motion.canvas;frame.left-=motion.paddingX;frame.top-=motion.paddingY;
        frame.pixels=frame.canvas.getContext('2d').getImageData(0,0,frame.canvas.width,frame.canvas.height).data;
        frame.animate=(now,reducedMotion)=>{
          if(!motion.draw(now,reducedMotion))return false;
          frame.pixels=frame.canvas.getContext('2d').getImageData(0,0,frame.canvas.width,frame.canvas.height).data;
          return true;
        };
      }
      if(def.id==='custom_speaker'){
        const motion=createSpeakerMotion(frame.canvas,view.direction);
        frame.canvas=motion.canvas;
        frame.animate=(now,reducedMotion,musicPlaying)=>motion.draw(now,musicPlaying,reducedMotion);
      }
      if(slices?.length)frame.slices=slices.map(slice=>({...frame,...slice}));
      frames.set(`${def.id}:${view.direction}`,frame);
    }
    })();
    loading.set(def.id,promise);return promise;
  }
  await Promise.all([...new Set(initialItems.filter(isPlaced).map(i=>i.type))].filter(id=>definitions.has(id)).map(id=>loadDefinition(definitions.get(id))));
  let page=0;const pageSize=48;
  let viewItems=[],items=[],history=[],selected=null,pending=null,visuals=[],filter='',category='All',editable=true,networkSave=null,networkPower=null,onPowerError=()=>{},saving=false;
  // Grant edits anything; everyone else edits only the pieces they built (`owner`).
  let admin=false,me=null,rawItems=initialItems;
  const canEdit=item=>admin||(!!me&&item.owner===me);
  // Pieces with a power switch: the decks, and built animations marked switchable.
  const switchable=item=>item?.type==='custom_dj_decks'||!!definitions.get(item?.type)?.switchable;
  // Builders drop pieces only inside their own space; Grant anywhere. Loading never applies this.
  const buildTile=(x,z)=>isTile(x,z)&&(admin||canBuildAt(x,z));
  items=restoreItems(initialItems,definitions);
  function fitStoredItems(){
    const fitted=[];
    for(const item of [...items].sort((a,b)=>Number(!!a.supportId)-Number(!!b.supportId))){
      if(isPlaced(item)&&!canPlace(item,fitted,definitions,isTile,undefined,floorHeight,hasWall)){item.x=null;item.z=null;delete item.supportId;delete item.u;delete item.height;}
      fitted.push(item);
    }
  }
  fitStoredItems();
  const panel=document.createElement('section');panel.className='furniture-panel';panel.hidden=true;panel.setAttribute('aria-label','Furniture');
  panel.innerHTML=`<header><h1>Furniture</h1><button class="furniture-close" aria-label="Close furniture">×</button></header><div class="furniture-filters"><input type="search" aria-label="Search furniture" placeholder="Search furniture"><select aria-label="Furniture category">${['All',...new Set(catalog.map(d=>d.category))].map(name=>`<option>${name}</option>`).join('')}</select></div><p class="furniture-description"></p><div class="furniture-grid"></div><div class="furniture-pages"><button type="button" aria-label="Previous furniture page">◀</button><span></span><button type="button" aria-label="Next furniture page">▶</button></div><footer><button class="furniture-undo">Undo</button></footer>`;
  const actions=document.createElement('section');actions.className='furniture-actions';actions.hidden=true;actions.setAttribute('aria-label','Selected furniture');
  const attachButton=document.createElement('button');attachButton.type='button';attachButton.className='agent-attach';attachButton.textContent='Build with your agent';attachButton.hidden=!onAttachAgent;
  attachButton.onclick=()=>{panel.hidden=true;cancel();onAttachAgent?.();};
  panel.querySelector('.furniture-filters').after(attachButton);
  actions.innerHTML=`<button class="furniture-close" aria-label="Deselect furniture">×</button><img alt=""><strong></strong><span class="furniture-location"></span><div>${['Move','Rotate','Pick up','Delete','Power'].map(name=>`<button data-action="${name}">${name}</button>`).join('')}</div>`;
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
  // What a save sends: the pieces that differ from before, each whole, and {id, removed: true}
  // for the ones that are gone. The server checks only the zones those pieces touch.
  function changesBetween(before,after){
    const was=new Map(before.map(item=>[item.id,JSON.stringify(item)])),changes=[];
    for(const item of after){if(was.get(item.id)!==JSON.stringify(item))changes.push(structuredClone(item));was.delete(item.id);}
    for(const id of was.keys())changes.push({id,removed:true});
    return changes;
  }
  async function change(mutate,record=true){
    if(!editable||saving||!networkSave)return;
    stopWalking();const previous=structuredClone(items),oldHistory=[...history];if(record){history.push(previous);history=history.slice(-10);}mutate();onChanged();render();
    if(networkSave){
      saving=true;render();
      let message='';
      try{await networkSave(changesBetween(previous,items));}catch(error){items=previous;history=oldHistory;message=error.message;}
      finally{saving=false;render();if(message)panel.querySelector('.furniture-description').textContent=message;}
    }
  }
  const openUntil=new Map();
  function frameFor(item){const frame=frames.get(`${item.type}:${item.rotation}`);if(frame?.open&&openUntil.get(item.id)>Date.now())return frame.open;return item.on===false&&frame?.off?frame.off:frame;}
  function animate(now,reducedMotion=false,musicPlaying=false){
    const updated=new Map();
    for(const {frame,mesh} of visuals){
      if(!frame.animate)continue;
      if(!updated.has(frame))updated.set(frame,frame.animate(now,reducedMotion,musicPlaying));
      if(updated.get(frame)&&mesh.material.map)mesh.material.map.needsUpdate=true;
    }
  }
  function visible(item){
    const def=definitions.get(item.type);
    return isWallItem(def)?canHang(item,def,hasWall):isPlaced(item)&&footprint(item,def).every(([x,z])=>isTile(x,z));
  }
  // Top-left corner of a piece's sprite on screen, and its draw order.
  function originFor(item,frame){
    const def=definitions.get(item.type),p=worldPoint(item.x,item.z);
    if(isWallItem(def)){
      const a=wallAnchor(item),width=frame.canvas.width/frame.density,height=frame.canvas.height/frame.density;
      // However high it was hung, a piece stays on the wall face: its top never passes the ceiling line.
      const centre=Math.min(item.height,WALL_FACE-height/2);
      return {x:p.x+a.x-width/2,y:p.y+floorHeight(item.x,item.z)+a.y+item.height-centre-height/2,order:95};
    }
    const cells=footprint(item,def),table=viewItems.find(t=>t.id===item.supportId),orderCells=table?footprint(table,definitions.get(table.type)):cells;
    // A piece on a table draws just above the table (front ones last) but under an avatar on the
    // same diagonal (+9.5): someone sitting at the desk is in front of what is on it.
    const order=def.category==='Rugs'?20:def.category==='Seating'?300+(item.x+item.z)*10+9+(frame.orderShift??0):300+Math.max(...orderCells.map(([x,z])=>x+z))*10+9+(table?0.1+(item.x+item.z)/1000:0);
    const lift=surfaceHeight(item,viewItems,definitions)-floorHeight(item.x,item.z);
    return {x:p.x+frame.left,y:p.y+frame.top-lift+(table?def.tableOffsetY??0:0),order};
  }
  // Meshes persist across redraws, keyed by item and slice; only pieces whose frame
  // changed, appeared or vanished are created or disposed.
  const meshes=new Map();
  function redraw(){
    const kept=new Set();visuals=[];
    viewItems=pending?moveWithContents(items,pending,definitions):items;
    for(const item of viewItems){
      if(!visible(item))continue;
      const frame=frameFor(item);
      if(!frame){loadDefinition(definitions.get(item.type)).then(redraw).catch(error=>{panel.querySelector('.furniture-description').textContent=error.message;});continue;}
      (frame.slices??[frame]).forEach((slice,index)=>{
        const key=`${item.id}:${index}`;let entry=meshes.get(key);
        if(entry&&entry.canvas!==slice.canvas){disposeVisual(entry.mesh);entry=null;}
        if(!entry){
          const mesh=makeVisual(slice.canvas);
          if(slice.density>1){
            mesh.scale?.setScalar(1/slice.density);
            if(mesh.material.map){mesh.material.map.minFilter=LinearFilter;mesh.material.map.magFilter=NearestFilter;}
          }
          entry={mesh,canvas:slice.canvas};meshes.set(key,entry);
        }
        entry.mesh.material.opacity=pending&&(item.id===pending.id||item.supportId===pending.id)?.65:1;
        kept.add(key);visuals.push({item,frame:slice,mesh:entry.mesh});
      });
    }
    for(const [key,entry] of meshes){if(!kept.has(key)){disposeVisual(entry.mesh);meshes.delete(key);}}
    refreshPositions();
  }
  function refreshPositions(){
    for(const {item,frame,mesh} of visuals){
      const origin=originFor(item,frame);
      positionVisual(mesh,origin.x,origin.y,frame.canvas.width/frame.density,frame.canvas.height/frame.density,origin.order);
    }
    const item=pending||items.find(i=>i.id===selected);
    const cells=item&&visible(item)&&!isWallItem(definitions.get(item.type))?footprint(item,definitions.get(item.type)):[];
    markTiles(cells,pending?(validPlacement(pending)?'#65e58c':'#ff7777'):'#f8e39a');
    // Front-most first, so hit testing can take the first match without sorting per pointer move.
    visuals.sort((a,b)=>b.mesh.renderOrder-a.mesh.renderOrder);
  }
  function renderList(){
    panel.querySelector('.furniture-description').textContent='Pieces you built. Choose one, then click a floor tile (or a wall) to place it.';
    const grid=panel.querySelector('.furniture-grid');grid.replaceChildren();
    const entries=catalog.filter(def=>!!me&&def.owner===me).map(def=>({def,item:items.find(i=>i.type===def.id&&i.owner===me&&!isPlaced(i))}));
    const matching=entries.filter(({def})=>(category==='All'||category===def.category)&&`${def.name} ${def.id}`.toLowerCase().includes(filter));
    const pages=Math.max(1,Math.ceil(matching.length/pageSize));page=Math.max(0,Math.min(page,pages-1));
    panel.querySelector('.furniture-pages span').textContent=`${page+1} / ${pages} · ${matching.length} pieces`;
    const pageButtons=panel.querySelectorAll('.furniture-pages button');pageButtons[0].disabled=page===0;pageButtons[1].disabled=page===pages-1;
    for(const {def,item} of matching.slice(page*pageSize,(page+1)*pageSize)){
      const button=document.createElement('button');button.className='furniture-card';button.type='button';button.setAttribute('aria-label',`Place ${def.name}`);
      if(item){button.dataset.itemId=item.id;button.dataset.cell=isPlaced(item)?`${item.x},${item.z}`:'inventory';button.dataset.rotation=item.rotation;button.setAttribute('aria-pressed',String(selected===item.id));}
      const img=document.createElement('img');img.src=src(def.icon);img.alt='';img.loading='lazy';const label=document.createElement('span');label.textContent=def.name;button.append(img,label);
      button.onclick=()=>begin(item||{id:crypto.randomUUID(),type:def.id,rotation:def.views.find(v=>v.direction===2)?.direction??def.views[0].direction,x:null,z:null,owner:me});
      grid.append(button);
    }
    if(!matching.length){const empty=document.createElement('p');empty.className='furniture-empty';empty.textContent=filter||category!=='All'?'No matching furniture.':'Nothing built yet. Attach your agent and hand it a picture.';grid.append(empty);}
    panel.querySelector('.furniture-undo').disabled=!history.length;
  }
  let listStale=true;
  function render(){
    // The catalogue grid is costly to build, so it waits until the panel is actually showing.
    if(panel.hidden)listStale=true;else{renderList();listStale=false;}
    redraw();const item=items.find(i=>i.id===selected),def=item&&definitions.get(item.type),mine=!!item&&editable&&canEdit(item);
    actions.hidden=(!mine&&!(networkPower&&item?.type==='custom_dj_decks'))||!item||!isPlaced(item)||!!pending;
    if(!actions.hidden){actions.querySelector('img').src=src(def.icon);actions.querySelector('strong').textContent=def.name;actions.querySelector('.furniture-location').textContent=item.supportId?'On table':isWallItem(def)?'On wall':`Tile ${item.x+1}, ${item.z+1}`;actions.querySelector('[data-action="Rotate"]').disabled=def.views.length<2||isWallItem(def);}
    actions.querySelectorAll('[data-action]').forEach(button=>{button.hidden=!mine;if(saving)button.disabled=true;else if(button.dataset.action!=='Rotate')button.disabled=false;});
    const power=actions.querySelector('[data-action="Power"]');power.hidden=!networkPower||!switchable(item);power.textContent=item?.on===false?'Turn on':'Turn off';power.setAttribute('aria-pressed',String(item?.on!==false));
    placement.hidden=!pending;
    if(pending){const def=definitions.get(pending.type);placement.querySelector('span').textContent=isWallItem(def)?`${def.name} — click a wall`:def.name;placement.querySelector('[data-placement="rotate"]').disabled=def.views.length<2||isWallItem(def);}
  }
  function begin(item){
    if(!editable||saving)return;
    if(items.length>=200&&!items.some(i=>i.id===item.id)){panel.querySelector('.furniture-description').textContent='Furniture limit reached (200 items).';return;}
    stopWalking();selected=null;pending={...item};panel.hidden=true;
    if(!isPlaced(pending)&&!isWallItem(definitions.get(pending.type))){
      const avatar=getAvatar(),candidates=[];
      for(let x=0;x<90;x++)for(let z=0;z<30;z++)if(buildTile(x,z))candidates.push({x,z});
      candidates.sort((a,b)=>Math.hypot(a.x-avatar.x,a.z-avatar.z)-Math.hypot(b.x-avatar.x,b.z-avatar.z));
      const first=candidates.find(cell=>canPlace({...pending,...cell},items,definitions,buildTile,avatar,floorHeight));
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
    const views=definitions.get(item.type).views;if(views.length<2||isWallItem(definitions.get(item.type)))return;
    const rotation=views[(views.findIndex(v=>v.direction===item.rotation)+1)%views.length].direction;
    if(pending){pending.rotation=rotation;render();return;}
    if(!validPlacement({...item,rotation})){return;}
    change(()=>{items=moveWithContents(items,{...item,rotation},definitions);});
  }
  panel.querySelector('.furniture-close').onclick=()=>{panel.hidden=true;focusRoom();};
  panel.querySelector('input').oninput=event=>{filter=event.target.value.toLowerCase().trim();page=0;renderList();};
  panel.querySelector('select').onchange=event=>{category=event.target.value;page=0;renderList();};
  panel.querySelectorAll('.furniture-pages button').forEach((button,i)=>button.onclick=()=>{page+=i?1:-1;renderList();});
  panel.querySelector('.furniture-undo').onclick=()=>{
    if(!history.length||saving||!editable)return;
    const previous=history.at(-1);change(()=>{history.pop();items=previous;fitStoredItems();selected=null;},false);
  };
  actions.querySelector('.furniture-close').onclick=()=>{selected=null;render();};
  actions.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
    const item=items.find(i=>i.id===selected);if(!item)return;
    switch(button.dataset.action){
      case 'Move':begin(item);break;
      case 'Rotate':rotate();break;
      case 'Power':
        if(!networkPower||saving||!switchable(item))break;
        saving=true;render();
        try{await networkPower(item.id,item.on===false);}catch(error){onPowerError(error.message);}finally{saving=false;render();}
        break;
      case 'Pick up':change(()=>{items=pickupWithContents(items,item.id);selected=null;});break;
      case 'Delete':{
        deleteId=item.id;const def=definitions.get(item.type);
        confirmation.querySelector('img').src=src(def.icon);confirmation.querySelector('strong').textContent=def.name;
        confirmation.showModal();confirmation.querySelector('[data-confirm="cancel"]').focus();break;
      }
    }
  });
  placement.querySelector('[data-placement="cancel"]').onclick=cancel;placement.querySelector('[data-placement="rotate"]').onclick=rotate;
  function open(){if(!editable)return;cancel();selected=null;page=0;panel.hidden=false;listStale=true;render();panel.querySelector('input').focus();}
  function validPlacement(item){
    const next=moveWithContents(items,item,definitions);
    return next.filter(i=>i.id===item.id||i.supportId===item.id).every(i=>canPlace(i,next,definitions,buildTile,getAvatar(),floorHeight,hasWall));
  }
  function hitVisual(point){
    return visuals.find(({item,frame})=>{
      if(pending&&(item.id===pending.id||item.supportId===pending.id))return false;
      const origin=originFor(item,frame),x=Math.floor((point.x-origin.x)*frame.density),y=Math.floor((point.y-origin.y)*frame.density);
      return x>=0&&y>=0&&x<frame.canvas.width&&y<frame.canvas.height&&frame.pixels[(y*frame.canvas.width+x)*4+3]>40;
    });
  }
  // The wall point under the pointer that a wall piece can hang from, front-most wall first.
  function wallAt(point,def){
    const hits=[];
    for(const {x,z,side} of walls()){
      const p=worldPoint(x,z);p.y+=floorHeight(x,z);
      const u=(point.x-p.x)/32*(side==='left'?-1:1),height=p.y+u*16-point.y;
      if(u<0||u>1||height<12||height>112)continue;
      // Hang it no higher than lets its whole face fit under the ceiling line.
      const spriteHeight=(frames.get(`${def.id}:${side==='left'?2:4}`)?.canvas.height??0)/(def.spriteDensity??1),top=Math.min(88,Math.max(26,WALL_FACE-spriteHeight/2));
      const item={...pending,x,z,rotation:side==='left'?2:4,u:Math.max(.25,Math.min(.75,u)),height:Math.max(26,Math.min(top,height))};
      if(canHang(item,def,hasWall))hits.push(item);
    }
    return hits.sort((a,b)=>(b.x+b.z)-(a.x+a.z))[0]??null;
  }
  function placementTarget(point,cell){
    const def=definitions.get(pending.type);
    if(isWallItem(def)){const hit=wallAt(point,def);return hit?{x:hit.x,z:hit.z,rotation:hit.rotation,u:hit.u,height:hit.height}:{x:null,z:null};}
    if(!canStack(def))return {...cell};
    const hit=hitVisual(point)?.item;
    const table=hit?.supportId?items.find(i=>i.id===hit.supportId):hit;
    if(!table||table.id===pending.id||definitions.get(table.type).category!=='Tables')return {...cell};
    const p=worldPoint(table.x,table.z),height=definitions.get(table.type).surfaceHeight;
    const dx=point.x-p.x,dy=point.y+height-p.y-floorHeight(table.x,table.z);
    const cells=footprint(table,definitions.get(table.type));
    const x=Math.max(table.x,Math.min(Math.max(...cells.map(c=>c[0])),table.x+Math.floor(dx/64+dy/32)));
    const z=Math.max(table.z,Math.min(Math.max(...cells.map(c=>c[1])),table.z+Math.floor(dy/32-dx/64)));
    return {x,z,supportId:table.id};
  }
  function pointer(point,cell,click=false){
    if(pending){
      const target=placementTarget(point,cell),before=JSON.stringify(pending);
      delete pending.supportId;Object.assign(pending,{x:target.x??null,z:target.z??null},target);
      const changed=before!==JSON.stringify(pending);
      if(changed)redraw();if(click){commit();render();}return true;
    }
    const hit=hitVisual(point);
    if(click){
      // A built animation that is switchable flips on or off when anyone else clicks it; its builder (and Grant) get the usual selection with a Power button.
      const flips=hit&&networkPower&&!!definitions.get(hit.item.type)?.switchable&&!(editable&&canEdit(hit.item));
      selected=hit&&(editable&&canEdit(hit.item)||(networkPower&&hit.item.type==='custom_dj_decks'))?hit.item.id:null;render();onInspect(hit?.item??null,hit?definitions.get(hit.item.type):null);
      if(flips)networkPower(hit.item.id,hit.item.on===false).catch(error=>onPowerError(error.message));
      const spot=hit&&clickedSeat(hit.item.id,point);if(spot)onSit(spot);else if(hit&&USABLE.has(hit.item.type))onUse(hit.item.id);
    }
    return !!hit&&definitions.get(hit.item.type).category!=='Rugs';
  }
  function key(event){
    if(event.key==='Escape'){cancel();selected=null;panel.hidden=true;render();return true;}
    if(!pending)return false;
    if(event.key.toLowerCase()==='r'){rotate();return true;}
    if(event.key==='Enter'){commit();return true;}
    const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
    if(!delta)return false;
    const def=definitions.get(pending.type);
    if(isWallItem(def)){
      // Arrows slide a hung piece along its wall and raise or lower it.
      if(!isPlaced(pending))return true;
      const along=pending.rotation===4?delta[0]:-delta[0];
      const moved={...pending,u:pending.u+along/8,height:pending.height-delta[1]*4};
      if(canHang(moved,def,hasWall)){Object.assign(pending,moved);redraw();}
      return true;
    }
    pending.x=(pending.x??0)+delta[0];pending.z=(pending.z??0)+delta[1];redraw();return true;
  }
  function roomChanged(commit=false){
    cancel();selected=null;
    if(commit&&!networkSave){
      const displaced=items.filter(item=>isPlaced(item)&&!visible(item));
      if(displaced.length){change(()=>displaced.forEach(item=>{item.x=null;item.z=null;}));}
    }
    render();
  }
  function seat(id,point){
    const item=items.find(i=>i.id===id),spot=item&&visible(item)?seatFor(item,definitions.get(item.type),point):null;
    if(!spot)return null;
    // These raised seats need a higher avatar anchor than ordinary chairs.
    const offsetY=spot.offsetY??({throne:4,asian_gothic_chair:0})[item.type]??16;
    return {id,...spot,offsetY};
  }
  function clickedSeat(id,point){
    const item=items.find(i=>i.id===id),spot=seat(id),height=item&&definitions.get(item.type).seat?.[item.rotation]?.height;
    if(!spot||!height)return spot;
    for(const [x,z] of spot.cells){
      const chosen=seat(id,{x,z}),p=worldPoint(x+.5,z+.5);
      const dx=point.x-p.x-chosen.offsetX,dy=point.y-p.y-floorHeight(x,z)+height;
      if(Math.abs(dx)<=16&&dy>=-9&&dy<=height+4)return {...chosen,cells:[[x,z]]};
    }
    return null;
  }
  render();
  return {open,pointer,key,roomChanged,redraw,seat,animate,debugVisuals:()=>visuals.map(v=>({id:v.item.id.slice(0,6),type:v.item.type.slice(0,22),x:v.item.x,z:v.item.z,u:v.item.u,h:v.item.height,on:v.item.supportId?.slice(0,6)??null,order:v.mesh.renderOrder,meshX:v.mesh.position.x,meshY:v.mesh.position.y,w:v.frame.canvas.width/v.frame.density,height:v.frame.canvas.height/v.frame.density,top:v.frame.top,left:v.frame.left})),approach:(id,from,canWalk)=>{const item=items.find(i=>i.id===id);return item&&visible(item)?approachFor(item,items,definitions,from,canWalk):null;},blocks:(x,z)=>blocksTile(x,z,items,definitions),close:()=>{cancel();selected=null;panel.hidden=true;render();},get placing(){return !!pending;},
    getItems:()=>structuredClone(items),
    typeOf:id=>items.find(i=>i.id===id)?.type??null,
    // Show a piece's open state until the given time, then fall back to its resting frame.
    setOpen(id,until){openUntil.set(id,until);redraw();setTimeout(()=>{if(openUntil.get(id)===until){openUntil.delete(id);redraw();}},Math.max(0,until-Date.now())+30);},
    // Tiles under powered DJ decks and the cabinet carrying them, for the wall sign.
    deckSpot(){const decks=items.find(i=>i.type==='custom_dj_decks'&&visible(i));if(!decks||decks.on===false)return null;const table=items.find(i=>i.id===decks.supportId&&isPlaced(i));return [...footprint(decks,definitions.get(decks.type)),...(table?footprint(table,definitions.get(table.type)):[])];},
    connect({admin:isAdmin,me:playerId=null,onSave,onPower,onError=()=>{}}){admin=isAdmin;me=playerId;editable=true;networkSave=onSave;networkPower=onPower;onPowerError=onError;history=[];listStale=true;render();},
    receive(next){rawItems=next;items=restoreItems(next,definitions);if(pending&&selected&&!items.some(i=>i.id===selected))pending=null;render();},
    // Built pieces arrive live; placed items of a piece that was just built become visible.
    setAssets(list){
      const keep=new Set(list.map(d=>d.id));
      for(const def of catalog.filter(d=>d.id.startsWith('asset_')&&!keep.has(d.id))){definitions.delete(def.id);loading.delete(def.id);for(const view of def.views)frames.delete(`${def.id}:${view.direction}`);}
      catalog=[...catalog.filter(d=>!d.id.startsWith('asset_')),...list];
      // A known piece keeps its loaded sprites; only its sitting spot can change after it is built.
      for(const def of list){const known=definitions.get(def.id);if(!known)definitions.set(def.id,def);else if(JSON.stringify(known.seat)!==JSON.stringify(def.seat))known.seat=def.seat;}
      items=restoreItems(rawItems,definitions);listStale=true;render();
    }
  };
}
