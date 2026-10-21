export const WALLS={plain:{label:'Plain',type:0,palette:'wall_white'},tiles:{label:'Tiles',type:1,palette:'wall_tiles1'},checks:{label:'Checks',type:1,palette:'wall_tiles2'},stripes:{label:'Stripes',type:1,palette:'wall_stripes'}};
export const FLOORS={plain:{label:'Plain',type:0,palette:'floor_basic'},wood:{label:'Wood',type:2,palette:'floor_basic'},tiles:{label:'Tiles',type:1,palette:'floor_tiles2'},carpet:{label:'Carpet',type:1,palette:'floor_fuzzy1'}};
const DEFAULT={shape:'square',wall:'plain',wallColor:'#dcded4',floor:'plain',floorColor:'#c3c1aa',window:true};
export function createRoomEditor({catalog,onPreview,onOpen,onClose,onSave,initial=DEFAULT}) {
  const wallColors=[DEFAULT.wallColor,...catalog.wallColors];
  const floorColors=[DEFAULT.floorColor,...catalog.floorColors];
  const valid=s=>s&&catalog.shapes.some(m=>m.id===s.shape)&&WALLS[s.wall]&&FLOORS[s.floor]&&wallColors.includes(s.wallColor)&&floorColors.includes(s.floorColor)&&typeof s.window==='boolean';
  let current={...initial};
  let draft={...current};
  const dialog=document.createElement('dialog');
  dialog.className='appearance-dialog room-editor';dialog.setAttribute('aria-labelledby','room-editor-title');
  dialog.innerHTML=`<header><h1 id="room-editor-title">Edit your room</h1><button type="button" class="appearance-close" aria-label="Close room editor">×</button></header>
    <div class="room-editor-content"><h2>Room shape</h2><div class="shape-grid"></div>
    <div class="surfaces"><section><h2>Walls</h2><div class="wall-patterns pattern-options"></div><div class="wall-colors color-grid"></div></section>
    <section><h2>Floor</h2><div class="floor-patterns pattern-options"></div><div class="floor-colors color-grid"></div></section></div>
    <label class="window-option"><input type="checkbox"> Window</label></div>
    <p class="appearance-status" role="status">Changes preview in your room.</p>
    <footer><button type="button" class="appearance-cancel">Cancel</button><button type="button" class="appearance-apply">Apply</button></footer>`;
  dialog.tabIndex=-1;document.body.append(dialog);
  const shapeButtons=[];
  for(const shape of catalog.shapes){
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',shape.name);
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=60;
    const ctx=canvas.getContext('2d'), w=Math.max(...shape.tiles.map(t=>t[0]))+1,h=Math.max(...shape.tiles.map(t=>t[1]))+1;
    const unit=Math.min(80/(w+h),46/(w+h)*2),offset=50-(w-h)*unit/2;
    for(const [x,z] of shape.tiles){const px=offset+(x-z)*unit,py=5+(x+z)*unit/2;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+unit,py+unit/2);ctx.lineTo(px,py+unit);ctx.lineTo(px-unit,py+unit/2);ctx.closePath();ctx.fillStyle='#a99d6c';ctx.fill();ctx.strokeStyle='#756e53';ctx.lineWidth=.4;ctx.stroke();}
    const label=document.createElement('span');label.textContent=shape.name;button.append(canvas,label);
    button.onclick=()=>{draft.shape=shape.id;preview();};shapeButtons.push([button,shape.id]);dialog.querySelector('.shape-grid').append(button);
  }
  const selections=[];
  for(const [kind,patterns,colors] of [['wall',WALLS,wallColors],['floor',FLOORS,floorColors]]){
    for(const [id,pattern] of Object.entries(patterns)){
      const button=document.createElement('button');button.type='button';button.textContent=pattern.label;button.setAttribute('aria-label',`${kind} pattern ${pattern.label}`);
      button.onclick=()=>{draft[kind]=id;if(kind==='floor'&&id==='wood'&&draft.floorColor===DEFAULT.floorColor)draft.floorColor='#f7de9c';preview();};dialog.querySelector(`.${kind}-patterns`).append(button);selections.push([button,kind,id]);
    }
    for(const color of colors){
      const button=document.createElement('button');button.type='button';button.style.background=color;button.setAttribute('aria-label',`${kind} colour ${color}`);button.title=button.getAttribute('aria-label');
      button.onclick=()=>{draft[kind+'Color']=color;preview();};dialog.querySelector(`.${kind}-colors`).append(button);selections.push([button,kind+'Color',color]);
    }
  }
  const windowBox=dialog.querySelector('input');
  windowBox.onchange=()=>{draft.window=windowBox.checked;preview();};
  function update(){
    shapeButtons.forEach(([b,id])=>b.setAttribute('aria-pressed',String(draft.shape===id)));
    selections.forEach(([b,key,id])=>b.setAttribute('aria-pressed',String(draft[key]===id)));
    windowBox.checked=draft.window;
  }
  function preview(){update();onPreview(draft);}
  function close(){onPreview(current);dialog.close();onClose(false);}
  dialog.querySelector('.appearance-close').onclick=close;
  dialog.querySelector('.appearance-cancel').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.querySelector('.appearance-apply').onclick=async()=>{
    const apply=dialog.querySelector('.appearance-apply');apply.disabled=true;
    try{if(onSave)await onSave(draft);}catch(error){dialog.querySelector('.appearance-status').textContent=error.message;apply.disabled=false;return;}
    current={...draft};
    dialog.close();onClose(true);apply.disabled=false;
  };
  return {initial:current,receive(options){current={...options};if(!dialog.open){draft={...current};onPreview(current);}},open(){draft={...current};update();onOpen();dialog.showModal();dialog.focus();}};
}
