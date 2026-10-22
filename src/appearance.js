import {createAgentPrompt} from './agent-link.js';
import {makeDraggable} from './draggable.js';
import {randomAppearance} from './random-appearance.js';
import {appearanceChoices,appearanceGender,changeAppearanceGender} from './appearance-options.js';
const ROOT = '/assets/appearance/';
const KEY = 'habbo-room-appearance-v1';
const LABELS = {hair:'Hair',skin:'Faces',top:'Tops',bottom:'Trousers',shoes:'Shoes',hats:'Hats',headwear:'Headwear',glasses:'Glasses',facewear:'Facewear',jackets:'Jackets',waist:'Waist'};
const DEFAULT = {hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const copy = value => structuredClone(value);

export async function createAppearance({prepareImage, onApply, onOpen, onRoomKey}) {
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
  let preferredGender='M';
  try{if(localStorage.getItem(KEY+'-gender')==='F')preferredGender='F';}catch{}
  let gender=appearanceGender(catalog,current,preferredGender),genderDrafts={};
  const painted=new Map();
  function paintedPart(asset,tint){
    const key=asset.file+tint;
    if(!painted.has(key))painted.set(key,load(asset.file).then(image=>prepareImage(image,{matte:!asset.alphaPrepared,tint})));
    return painted.get(key);
  }
  // carry=true holds a drink: the right arm takes the carry pose in every action and the glass (item 1) is drawn in it.
  async function render(look,direction=2,frame=-1,sitting=false,action=null,actionFrame=0,carry=false) {
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;
    const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
    const order=catalog.orders[action==='wave'?'lh-up':sitting?'sit':'std']?.[direction]??catalog.orders.std[direction];
    const flips={lh:'rh',rh:'lh',ls:'rs',rs:'ls'},layers=new Map(),hidden=new Set();
    const normalized=normalize(look);
    if(carry)layers.set('ri',[{type:'ri',model:'1',index:0,colorable:false,tint:'#ffffff'}]);
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
      if(carry&&['rh','rs','ri'].includes(part)){partAction='crr';partFrame=0;}
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
      const bob=frame>=0&&!action&&(partAction==='std'||partAction==='crr')&&frame%2?1:0;
      ctx.save();if(mirrored){ctx.translate(96,0);ctx.scale(-1,1);}
      ctx.drawImage(image,16-asset.regPoint.x+offsetX,94-asset.regPoint.y+offsetY+bob);ctx.restore();
      }
    }
    return canvas;
  }
  async function frames(look,carry=false) {
    const result=new Map();
    await Promise.all(Array.from({length:40},async(_,i)=>{
      const direction=Math.floor(i/5),frame=i%5-1;
      result.set(`${direction}:${frame}`,await render(look,direction,frame,false,null,0,carry));
    }));
    await Promise.all([0,2,4,6].map(async direction=>result.set(`${direction}:sit`,await render(look,direction,-1,true,null,0,carry))));
    await Promise.all(Array.from({length:80},async(_,i)=>{
      const direction=Math.floor(i/10),step=i%10,action=step<2?'wave':'dance',frame=step<2?step:step-2;
      result.set(`${direction}:${action}:${frame}`,await render(look,direction,-1,false,action,frame,carry));
    }));
    await Promise.all([0,2,4,6].flatMap(direction=>[0,1].map(async frame=>result.set(`${direction}:sit-wave:${frame}`,await render(look,direction,-1,true,'wave',frame,carry)))));
    // Breakdance: a floor spin. Sixteen frames: two turns through the four cardinal directions
    // (the only ones with a sitting body) in the sit pose with arms waving, then a freeze facing
    // front with a bounce. The figure is dropped to floor level.
    const BOUNCE=[0,2,4,2,0,2,4,2];
    await Promise.all([0,2,4,6].flatMap(direction=>Array.from({length:16},async(_,frame)=>{
      const spin=frame<8?(direction+2*frame)%8:direction;
      const pose=await render(look,spin,-1,true,'wave',frame<8?frame%2:1,carry);
      const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;
      canvas.getContext('2d').drawImage(pose,0,14+(frame<8?(frame%2?2:0):BOUNCE[frame-8]));
      result.set(`${direction}:breakdance:${frame}`,canvas);
    })));
    return result;
  }

  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog character-editor';dialog.setAttribute('aria-labelledby','appearance-title');
  dialog.innerHTML=`
    <header><h1 id="appearance-title">Your appearance</h1><button type="button" class="appearance-close" aria-label="Close appearance editor">×</button></header>
    <ol class="entry-progress" hidden><li>Name</li><li>Character</li><li>Agent</li></ol>
    <section class="entry-intro" hidden><h2>Welcome! Make yourself at home.</h2><p>Choose a name for your character, then pick your look.</p></section>
    <button type="button" class="entry-return" hidden>Use my room key</button>
    <section class="entry-agent" hidden><h2 class="entry-agent-title">Connect your agent</h2><p class="entry-agent-description">Use an agent to create a space and style it with your own furniture.</p><div class="entry-agent-setup"><button type="button" class="entry-connect agent-copy-prompt">Copy Agent Prompt</button><p class="agent-copy-status" role="status" aria-live="polite"></p><textarea class="agent-prompt" aria-label="Agent setup prompt" readonly spellcheck="false" hidden></textarea><p class="agent-attached" role="status" aria-live="polite" data-connected="false">Not connected</p></div><p class="entry-agent-note">You can also do this later from the catalogue.</p></section>
    <div class="entry-name" hidden><label for="entry-name">Your name</label><input id="entry-name" autocomplete="nickname" minlength="2" maxlength="20" placeholder="What should we call you?" aria-describedby="entry-name-help entry-name-error"><p class="entry-note" id="entry-name-help"></p><p class="entry-name-error" id="entry-name-error" role="alert"></p></div>
    <div class="appearance-body">
      <div class="appearance-character"><div class="preview-stage"><canvas id="appearance-preview" width="96" height="112" aria-label="Character preview"></canvas></div><div class="turn-controls"><button type="button" aria-label="Turn preview left">◀</button><button type="button" aria-label="Turn preview right">▶</button></div></div>
      <div class="appearance-choices"><div class="appearance-gender" role="group" aria-label="Character style"><button type="button" data-gender="M">Man</button><button type="button" data-gender="F">Woman</button></div><nav aria-label="Appearance categories"></nav><h2 id="choice-title">Choose your hair</h2><div class="item-grid" aria-label="Styles"></div><div class="style-pages"><button type="button" aria-label="Previous styles">◀</button><span></span><button type="button" aria-label="Next styles">▶</button></div><h2>Colour <button type="button" class="color-channel" hidden>Primary</button></h2><div class="color-grid" aria-label="Colours"></div></div>
    </div>
    <p class="appearance-status" role="status" aria-live="polite"></p>
    <button type="button" class="character-room-key" aria-labelledby="character-save-label" aria-describedby="character-save-help" hidden><span id="character-save-label">Save your character</span><span id="character-save-help">Keep your name, look and belongings for next time.</span></button>
    <footer><button type="button" class="appearance-cancel">Cancel</button><button type="button" class="appearance-apply">Apply</button></footer>`;
  dialog.tabIndex=-1;document.body.append(dialog);makeDraggable(dialog,dialog.querySelector('header'));
  const preview=dialog.querySelector('#appearance-preview'), status=dialog.querySelector('.appearance-status');
  const apply=dialog.querySelector('.appearance-apply');
  const nav=dialog.querySelector('nav'), itemGrid=dialog.querySelector('.item-grid'), colorGrid=dialog.querySelector('.color-grid');
  dialog.querySelectorAll('[data-gender]').forEach(button=>button.onclick=()=>{
    if(busy||gender===button.dataset.gender)return;
    genderDrafts[gender]=copy(draft);gender=button.dataset.gender;
    draft=copy(genderDrafts[gender]??changeAppearanceGender(catalog,draft,gender));
    page=0;colorChannel='color';update();
  });
  for(const [id,label] of Object.entries(LABELS)){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.category=id;
    button.onclick=()=>{if(busy)return;category=id;page=0;colorChannel='color';update();};
    nav.append(button);
  }
  function draw(target,source){const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(source,0,0);}
  async function update() {
    const request=++version, look=copy(draft), selectedCategory=category;
    apply.disabled=true;status.textContent='';
    dialog.querySelectorAll('[data-gender]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gender===gender)));
    nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
    dialog.querySelector('#choice-title').textContent=`Choose your ${LABELS[category].toLowerCase()}`;
    itemGrid.replaceChildren();colorGrid.replaceChildren();
    itemGrid.hidden=false;
    const models=appearanceChoices(catalog,category,gender),pages=Math.ceil(models.length/15);page=Math.max(0,Math.min(page,pages-1));
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
  const nameInput=dialog.querySelector('#entry-name'),nameError=dialog.querySelector('.entry-name-error');
  const returnButton=dialog.querySelector('.entry-return'),roomKeyButton=dialog.querySelector('.character-room-key');
  roomKeyButton.onclick=()=>{if(!busy)onRoomKey?.();};
  returnButton.onclick=async()=>{
    if(busy||!entry?.onReturn)return;
    busy=true;apply.disabled=true;returnButton.disabled=true;
    try{
      const player=await entry.onReturn();
      if(player){current=normalize(player.look);const rendered=await frames(current);await onApply(rendered,current,{entry:true});finishEntry();}
    }catch(error){status.textContent=error.message;}
    finally{busy=false;apply.disabled=false;returnButton.disabled=false;}
  };
  let entryStep=0,agentSetup=null;
  function showEntryStep(step){
    entryStep=step;dialog.dataset.entryStep=String(step);
    dialog.querySelectorAll('.entry-progress li').forEach((item,i)=>{
      if(i+1===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    });
    dialog.querySelector('.entry-intro').hidden=step!==1;
    returnButton.hidden=step!==1||!entry.onReturn||entry.admin;
    roomKeyButton.hidden=step!==3||!onRoomKey;
    dialog.querySelector('.entry-name').hidden=step!==1;
    dialog.querySelector('.appearance-body').hidden=step!==2;
    dialog.querySelector('.entry-agent').hidden=step!==3;
    dialog.querySelector('h1').textContent=['','Welcome to the room','Make it your own','One more thing…'][step];
    dialog.querySelector('.appearance-cancel').hidden=step!==2;
    dialog.querySelector('.appearance-cancel').textContent='Back';
    apply.textContent=step===3?'Enter room':'Continue';
    if(step===3){
      agentSetup=createAgentPrompt({network:{agents:entry.agents},root:dialog.querySelector('.entry-agent-setup'),onAttached:list=>{
        const connected=list.some(agent=>agent.connectedAt!=null);
        dialog.dataset.agentConnected=String(connected);
        dialog.querySelector('.entry-agent-title').textContent=connected?"You're connected!":'Connect your agent';
        dialog.querySelector('.entry-agent-description').textContent=connected?'Enter the room to explore and bring your ideas to life with your agent.':'Use an agent to create a space and style it with your own furniture.';
        dialog.querySelector('.entry-agent-note').textContent=connected?'Your agent will explain what you can create. Head into the room when you’re ready.':'You can also do this later from the catalogue.';
        apply.textContent=connected?'Enter the room':'Enter room';
      }});
      agentSetup.start();
    }
    status.textContent='';dialog.scrollTop=0;
    if(step===1)nameInput.focus();
    else {dialog.focus();if(step===2)update();}
  }
  function finishEntry(){
    agentSetup?.stop();agentSetup=null;version++;dialog.close();const entered=entry;entry=null;entered.resolve();
    document.querySelector('#scene').focus({preventScroll:true});
  }
  nameInput.addEventListener('input',()=>{nameError.textContent='';nameInput.removeAttribute('aria-invalid');});
  nameInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply.click();}});
  function open(){
    if(dialog.open)return;
    delete dialog.dataset.entryStep;delete dialog.dataset.agentConnected;dialog.classList.remove('entry-flow');
    returnButton.hidden=true;roomKeyButton.hidden=!onRoomKey;
    dialog.querySelector('.entry-progress').hidden=true;dialog.querySelector('.entry-intro').hidden=true;dialog.querySelector('.entry-agent').hidden=true;dialog.querySelector('.appearance-body').hidden=false;dialog.querySelector('.appearance-cancel').textContent='Cancel';
    dialog.querySelector('.entry-name').hidden=true;dialog.querySelector('h1').textContent='Your appearance';
    apply.textContent='Apply';dialog.querySelector('.appearance-close').hidden=false;dialog.querySelector('.appearance-cancel').hidden=false;
    draft=copy(current);gender=appearanceGender(catalog,current,preferredGender);genderDrafts={};page=0;previewDirection=2;dialog.showModal();dialog.focus();onOpen();update();
  }
  function close(){if(busy||entry)return;version++;dialog.close();document.querySelector('#scene').focus({preventScroll:true});}
  dialog.querySelector('.appearance-close').onclick=close;
  dialog.querySelector('.appearance-cancel').onclick=()=>{if(entry&&!busy)showEntryStep(1);else close();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelectorAll('.turn-controls button').forEach((button,i)=>button.onclick=()=>{if(busy)return;previewDirection=(previewDirection+(i?1:7))%8;update();});
  apply.onclick=async()=>{
    if(busy||apply.disabled)return;
    if(entry&&entryStep===3){finishEntry();return;}
    if(entry&&entryStep===1){
      busy=true;apply.disabled=true;nameInput.readOnly=true;status.textContent='Checking your name…';
      try{await entry.onCheckName(nameInput.value);showEntryStep(2);}
      catch(error){nameError.textContent=error.message;nameInput.setAttribute('aria-invalid','true');status.textContent='';nameInput.focus();}
      finally{busy=false;nameInput.readOnly=entry.admin;apply.disabled=false;}
      return;
    }
    busy=true;apply.disabled=true;status.textContent=entry?'Getting your character ready…':'Changing your look…';
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const next=copy(draft), rendered=await frames(next);
      if(entry)await entry.onEnter(dialog.querySelector('#entry-name').value,next,{appearanceChanged:JSON.stringify(next)!==JSON.stringify(current)});
      await onApply(rendered,next,{entry:!!entry});current=next;
      preferredGender=gender;
      let saved=true;try{localStorage.setItem(KEY,JSON.stringify(current));localStorage.setItem(KEY+'-gender',gender);}catch{saved=false;}
      if(entry){showEntryStep(3);return;}
      version++;dialog.close();document.querySelector('#scene').focus({preventScroll:true});
    }catch(error){if(entry){showEntryStep(1);nameError.textContent=error.message;nameInput.setAttribute('aria-invalid','true');}else status.textContent=error.message;}
    finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  };
  const initial=await frames(current);
  return {initial,open,isOpen:()=>dialog.open,chatColor:()=>current.top.color,frames,previewFrame:render,
    async useLook(look){if(!validate(look))throw new Error('Invalid saved appearance.');current=normalize(look);const result=await frames(current);return result;},
    enter({name='',admin=false,onEnter,onCheckName,agents,onReturn}){
      return new Promise(resolve=>{
        entry={onEnter,onCheckName,agents,admin,resolve,onReturn};draft=admin?copy(current):randomAppearance(catalog);gender=appearanceGender(catalog,draft,preferredGender);genderDrafts={};category='hair';page=0;previewDirection=2;
        nameInput.value=admin?'Grant':name;nameInput.readOnly=admin;
        dialog.querySelector('.entry-note').textContent=admin?'Choose your look and enter as the room owner.':'2–20 characters, starting with a letter. Names already in use are unavailable.';
        dialog.querySelector('.entry-progress').hidden=false;dialog.querySelector('.appearance-close').hidden=true;dialog.querySelector('.appearance-cancel').hidden=true;
        dialog.classList.add('entry-flow');nameError.textContent='';nameInput.removeAttribute('aria-invalid');dialog.showModal();showEntryStep(1);apply.disabled=false;
      });
    }
  };
}
