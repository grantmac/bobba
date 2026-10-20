import {randomAppearance} from './random-appearance.js';
const ROOT = '/assets/appearance/';
const KEY = 'habbo-room-appearance-v1';
const LABELS = {hair:'Hair',skin:'Faces',top:'Tops',bottom:'Trousers',shoes:'Shoes',hats:'Hats',headwear:'Headwear',glasses:'Glasses',facewear:'Facewear',jackets:'Jackets',waist:'Waist'};
const DEFAULT = {hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const copy = value => structuredClone(value);

export async function createAppearance({prepareImage, onApply, onOpen}) {
  const response = await fetch(ROOT+'catalog.json');
  if (!response.ok) throw new Error('Appearance choices could not be loaded.');
  const catalog = await response.json();
  const images = new Map();
  function load(file) {
    if (!images.has(file)) images.set(file,new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>resolve(image);
      image.onerror=()=>{images.delete(file);reject(new Error('A clothing image could not be loaded. Try again.'));};
      image.src=ROOT+file;
    }));
    return images.get(file);
  }
  function normalize(value){
    const result={};
    for(const group of Object.keys(LABELS)){
      const selected=value?.[group]??DEFAULT[group]??{model:'none',color:'#624631'};
      const model=catalog.aliases[group]?.[selected.model]??selected.model;
      result[group]={...selected,model};
    }
    return result;
  }
  function validate(value){
    const normalized=normalize(value);
    return Object.keys(LABELS).every(group=>catalog.sets[group]?.[normalized[group].model]&&catalog.colors[group].includes(normalized[group].color));
  }
  let current=normalize(DEFAULT);
  try {const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&validate(saved))current=normalize(saved);} catch {}
  let draft=copy(current), category='hair', version=0, busy=false, previewDirection=2,entry=null,page=0,colorChannel='color';
  const painted=new Map();
  function paintedPart(asset,tint){
    const key=asset.file+tint;
    if(!painted.has(key))painted.set(key,load(asset.file).then(image=>prepareImage(image,{matte:!asset.alphaPrepared,tint})));
    return painted.get(key);
  }
  async function render(look,direction=2,frame=-1,sitting=false,action=null,actionFrame=0) {
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;
    const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
    const order=catalog.orders[action==='wave'?'lh-up':sitting?'sit':'std']?.[direction]??catalog.orders.std[direction];
    const flips={lh:'rh',rh:'lh',ls:'rs',rs:'ls'},layers=new Map(),hidden=new Set();
    const normalized=normalize(look);
    for(const group of Object.keys(LABELS)){
      const selection=normalized[group],set=catalog.sets[group][selection.model];
      for(const hiddenPart of set.hidden)hidden.add(hiddenPart);
      for(const piece of set.parts){
        if(!layers.has(piece.type))layers.set(piece.type,[]);
        layers.get(piece.type).push({...piece,tint:piece.colorable?(piece.colorindex>1?selection.color2??selection.color:selection.color):'#ffffff'});
      }
    }
    for(const part of order){
      if(hidden.has(part)||!layers.has(part))continue;
      // Figure System + partsets.xml remove hr when the replacement hrb exists.
      if(part==='hr'&&layers.has('hrb'))continue;
      for(const piece of layers.get(part).sort((a,b)=>a.index-b.index)){
      const model=piece.model;
      let partAction=sitting&&['bd','lg','sh'].includes(part)?'sit':frame>=0&&['bd','lg','lh','rh','ls','rs','sh'].includes(part)?'wlk':'std';
      let partFrame=partAction==='wlk'?frame:0,partDirection=direction,offsetX=0,offsetY=0;
      if(action==='wave'&&['lh','ls'].includes(part)){partAction='wav';partFrame=actionFrame%2;}
      if(action==='dance'&&catalog.dance[part]){
        const data=catalog.dance[part],i=actionFrame%data.act.length;
        partAction=data.act[i];partFrame=data.frm[i];partDirection=(direction+data.OffD[i]+8)%8;offsetX=data.OffX[i];offsetY=data.OffY[i];
      }
      const sourceDirection=[0,1,2,3,2,1,0,7][partDirection];
      let mirrored=sourceDirection!==partDirection;
      let sourcePart=mirrored&&flips[part]?flips[part]:part;
      let asset=catalog.parts[`h_${partAction}_${part}_${model}_${partDirection}_${partFrame}`];
      if(asset){mirrored=false;sourcePart=part;}
      else asset=catalog.parts[`h_${partAction}_${sourcePart}_${model}_${sourceDirection}_${partFrame}`];
      if(!asset){
        asset=catalog.parts[`h_std_${sourcePart}_${model}_${mirrored?sourceDirection:partDirection}_0`];
        if(!asset)continue;
      }
      // Face shapes use skin colour (ink 41); eyes use their keyed alpha (ink 36).
      const image=await paintedPart(asset,part==='ey'?'#ffffff':piece.tint);
      const bob=frame>=0&&!action&&partAction==='std'&&frame%2?1:0;
      ctx.save();if(mirrored){ctx.translate(96,0);ctx.scale(-1,1);}
      ctx.drawImage(image,16-asset.regPoint.x+offsetX,94-asset.regPoint.y+offsetY+bob);ctx.restore();
      }
    }
    return canvas;
  }
  async function frames(look) {
    const result=new Map();
    await Promise.all(Array.from({length:40},async(_,i)=>{
      const direction=Math.floor(i/5),frame=i%5-1;
      result.set(`${direction}:${frame}`,await render(look,direction,frame));
    }));
    await Promise.all([0,2,4,6].map(async direction=>result.set(`${direction}:sit`,await render(look,direction,-1,true))));
    await Promise.all(Array.from({length:80},async(_,i)=>{
      const direction=Math.floor(i/10),step=i%10,action=step<2?'wave':'dance',frame=step<2?step:step-2;
      result.set(`${direction}:${action}:${frame}`,await render(look,direction,-1,false,action,frame));
    }));
    await Promise.all([0,2,4,6].flatMap(direction=>[0,1].map(async frame=>result.set(`${direction}:sit-wave:${frame}`,await render(look,direction,-1,true,'wave',frame)))));
    return result;
  }

  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog character-editor';dialog.setAttribute('aria-labelledby','appearance-title');
  dialog.innerHTML=`
    <header><h1 id="appearance-title">Your appearance</h1><button type="button" class="appearance-close" aria-label="Close appearance editor">×</button></header>
    <div class="entry-name" hidden><label for="entry-name">Your name</label><input id="entry-name" autocomplete="nickname" minlength="2" maxlength="20" placeholder="Choose a name"><p class="entry-note"></p></div>
    <div class="appearance-body">
      <div class="appearance-character"><div class="preview-stage"><canvas id="appearance-preview" width="96" height="112" aria-label="Character preview"></canvas></div><div class="turn-controls"><button type="button" aria-label="Turn preview left">◀</button><span>Your Habbo</span><button type="button" aria-label="Turn preview right">▶</button></div></div>
      <div class="appearance-choices"><nav aria-label="Appearance categories"></nav><h2 id="choice-title">Choose your hair</h2><div class="item-grid" aria-label="Styles"></div><div class="style-pages"><button type="button" aria-label="Previous styles">◀</button><span></span><button type="button" aria-label="Next styles">▶</button></div><h2>Colour <button type="button" class="color-channel" hidden>Primary</button></h2><div class="color-grid" aria-label="Colours"></div></div>
    </div>
    <p class="appearance-status" role="status" aria-live="polite"></p>
    <footer><button type="button" class="appearance-cancel">Cancel</button><button type="button" class="appearance-apply">Apply</button></footer>`;
  document.body.append(dialog);
  const preview=dialog.querySelector('#appearance-preview'), status=dialog.querySelector('.appearance-status');
  const apply=dialog.querySelector('.appearance-apply');
  const nav=dialog.querySelector('nav'), itemGrid=dialog.querySelector('.item-grid'), colorGrid=dialog.querySelector('.color-grid');
  for(const [id,label] of Object.entries(LABELS)){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.category=id;
    button.onclick=()=>{if(busy)return;category=id;page=0;colorChannel='color';update();};
    nav.append(button);
  }
  function draw(target,source){const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(source,0,0);}
  async function update() {
    const request=++version, look=copy(draft), selectedCategory=category;
    apply.disabled=true;status.textContent='';
    nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
    dialog.querySelector('#choice-title').textContent=`Choose your ${LABELS[category].toLowerCase()}`;
    itemGrid.replaceChildren();colorGrid.replaceChildren();
    itemGrid.hidden=false;
    const models=catalog.choices[category],pages=Math.ceil(models.length/15);page=Math.max(0,Math.min(page,pages-1));
    const pageButtons=dialog.querySelectorAll('.style-pages button');pageButtons[0].disabled=page===0;pageButtons[1].disabled=page>=pages-1;
    dialog.querySelector('.style-pages span').textContent=`${page+1} / ${pages} · ${models.length} styles`;
    const channel=dialog.querySelector('.color-channel');channel.hidden=!catalog.sets[category][look[category].model].parts.some(p=>p.colorindex>1);channel.textContent=colorChannel==='color'?'Primary':'Secondary';
    if(channel.hidden)colorChannel='color';
    const buttons=[];
    for(const [i,model] of models.slice(page*15,page*15+15).entries()){
      const button=document.createElement('button');button.type='button';button.title=model==='none'?`No ${LABELS[category].toLowerCase()}`:`${LABELS[category]} style ${page*15+i+1}`;button.setAttribute('aria-label',button.title);
      button.setAttribute('aria-pressed',String(look[category].model===model));
      const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;button.append(canvas);
      button.onclick=()=>{if(busy)return;draft[selectedCategory].model=model;update();};
      itemGrid.append(button);buttons.push({canvas,model});
    }
    for(const color of catalog.colors[category]){
      const button=document.createElement('button');button.type='button';button.style.background=color;
      button.title=`${LABELS[category]} colour ${color}`;button.setAttribute('aria-label',button.title);
      button.setAttribute('aria-pressed',String((look[category][colorChannel]??look[category].color)===color));
      button.onclick=()=>{if(busy)return;draft[selectedCategory][colorChannel]=color;update();};
      colorGrid.append(button);
    }
    try {
      const [main,...thumbnails]=await Promise.all([render(look,previewDirection),...buttons.map(({model})=>{const option=copy(look);option[selectedCategory].model=model;return render(option);})]);
      if(request!==version||!dialog.open)return;
      draw(preview,main);buttons.forEach(({canvas},i)=>draw(canvas,thumbnails[i]));apply.disabled=false;
    }catch(error){if(request===version)status.textContent=error.message;}
  }
  dialog.querySelectorAll('.style-pages button').forEach((button,i)=>button.onclick=()=>{if(busy)return;page+=i?1:-1;update();});
  dialog.querySelector('.color-channel').onclick=()=>{colorChannel=colorChannel==='color'?'color2':'color';update();};
  function open(){
    if(dialog.open)return;
    dialog.querySelector('.entry-name').hidden=true;dialog.querySelector('h1').textContent='Your appearance';
    apply.textContent='Apply';dialog.querySelector('.appearance-close').hidden=false;dialog.querySelector('.appearance-cancel').hidden=false;
    draft=copy(current);page=0;previewDirection=2;dialog.showModal();onOpen();update();
  }
  function close(){if(busy||entry)return;version++;dialog.close();document.querySelector('#scene').focus({preventScroll:true});}
  dialog.querySelector('.appearance-close').onclick=close;
  dialog.querySelector('.appearance-cancel').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelectorAll('.turn-controls button').forEach((button,i)=>button.onclick=()=>{if(busy)return;previewDirection=(previewDirection+(i?1:7))%8;update();});
  apply.onclick=async()=>{
    if(busy||apply.disabled)return;
    busy=true;apply.disabled=true;status.textContent='Changing your look…';
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const next=copy(draft), rendered=await frames(next);
      if(entry)await entry.onEnter(dialog.querySelector('#entry-name').value,next,{appearanceChanged:JSON.stringify(next)!==JSON.stringify(current)});
      await onApply(rendered,next,{entry:!!entry});current=next;
      let saved=true;try{localStorage.setItem(KEY,JSON.stringify(current));}catch{saved=false;}
      version++;dialog.close();document.querySelector('#scene').focus({preventScroll:true});
      const entered=entry;entry=null;entered?.resolve();
    }catch(error){status.textContent=error.message;}
    finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  };
  const initial=await frames(current);
  return {initial,open,isOpen:()=>dialog.open,chatColor:()=>current.top.color,frames,previewFrame:render,
    async useLook(look){if(!validate(look))throw new Error('Invalid saved appearance.');current=normalize(look);const result=await frames(current);return result;},
    enter({name='',admin=false,onEnter}){
      return new Promise(resolve=>{
        entry={onEnter,resolve};draft=admin?copy(current):randomAppearance(catalog);category='hair';page=0;previewDirection=2;
        dialog.querySelector('h1').textContent=admin?'Welcome back, Grant':'Welcome to the room';
        dialog.querySelector('.entry-name').hidden=false;
        const nameInput=dialog.querySelector('#entry-name');nameInput.value=admin?'Grant':name;nameInput.readOnly=admin;
        dialog.querySelector('.entry-note').textContent=admin?'Choose your look and enter as the room owner.':'Choose your name and style your character.';
        apply.textContent='Enter room';dialog.querySelector('.appearance-close').hidden=true;dialog.querySelector('.appearance-cancel').hidden=true;
        dialog.showModal();update();nameInput.focus();
      });
    }
  };
}
