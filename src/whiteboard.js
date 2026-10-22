import {makeDraggable} from './draggable.js';
import {BOARD_WIDTH,BOARD_HEIGHT,COLORS,applyUpdate} from '../shared/whiteboard.js';

// A shared whiteboard: the board canvas hangs on the wall, and clicking it opens an
// editor window. Strokes stream to the server in small chunks while they are drawn,
// so everyone sees the line appear as it is made.
export function createWhiteboard({send,onError=()=>{}}){
  // Wall sprite: a framed board with a marker tray, drawn at twice the room's pixel size so
  // the frame stays crisp while the ink keeps smooth edges. The drawing surface is 114 by 56
  // room pixels inside a 3 px frame, with a 7 px tray below.
  const D=2,FRAME=3,SURFACE_W=114,SURFACE_H=56,TRAY=7,WALL_W=SURFACE_W+FRAME*2,WALL_H=SURFACE_H+FRAME*2+TRAY;
  const canvas=document.createElement('canvas');canvas.width=WALL_W*D;canvas.height=WALL_H*D;
  const ctx=canvas.getContext('2d');
  let strokes=[],known={serial:0,clearedSerial:0},current=null,pending=[],flushTimer=null,dirty=true,color=COLORS[0],size=4;
  function paintStrokes(target,scaleX,scaleY,widthScale,minWidth=1){
    target.save();target.transform(scaleX,0,0,scaleY,0,0);
    target.lineCap='round';target.lineJoin='round';
    const all=current?[...strokes.filter(s=>s.id!==current.id),current]:strokes;
    for(const stroke of all){
      const pts=stroke.points;if(pts.length<2)continue;
      target.strokeStyle=stroke.color;target.lineWidth=Math.max(minWidth,stroke.size*widthScale);target.beginPath();
      target.moveTo(pts[0],pts[1]);
      if(pts.length===2)target.lineTo(pts[0]+.1,pts[1]);
      for(let i=2;i<pts.length;i+=2)target.lineTo(pts[i],pts[i+1]);
      target.stroke();
    }
    target.restore();
  }
  const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x*D,y*D,w*D,h*D);};
  function paintWall(){
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    // Frame: brushed aluminium with a lit top-left edge, shadowed bottom-right, dark outline.
    rect(0,0,WALL_W,SURFACE_H+FRAME*2,'#2a2c33');
    rect(1,1,WALL_W-2,SURFACE_H+FRAME*2-2,'#b9bdc6');
    rect(1,1,WALL_W-2,1,'#eef0f4');rect(1,1,1,SURFACE_H+FRAME*2-2,'#eef0f4');
    rect(1,SURFACE_H+FRAME*2-2,WALL_W-2,1,'#7c8089');rect(WALL_W-2,1,1,SURFACE_H+FRAME*2-2,'#7c8089');
    rect(FRAME-1,FRAME-1,SURFACE_W+2,SURFACE_H+2,'#50535c');
    // Paper with faint grain, then the ink drawn smoothly at double density.
    rect(FRAME,FRAME,SURFACE_W,SURFACE_H,'#fbfbf6');
    for(let py=0;py<SURFACE_H;py++)for(let px=0;px<SURFACE_W;px++){
      const g=((px*7+py*13)%5===0)?'rgba(0,0,0,.025)':((px*3+py*11)%7===0)?'rgba(0,0,0,.012)':null;
      if(g)rect(FRAME+px,FRAME+py,1,1,g);
    }
    ctx.save();ctx.beginPath();ctx.rect(FRAME*D,FRAME*D,SURFACE_W*D,SURFACE_H*D);ctx.clip();
    ctx.translate(FRAME*D,FRAME*D);
    paintStrokes(ctx,SURFACE_W*D/BOARD_WIDTH,SURFACE_H*D/BOARD_HEIGHT,SURFACE_W*D/BOARD_WIDTH/1.6,2);
    ctx.restore();
    rect(FRAME,FRAME,SURFACE_W,1,'rgba(0,0,0,.12)');rect(FRAME,FRAME,1,SURFACE_H,'rgba(0,0,0,.12)');
    // Tray: a ledge with its front face, holding three markers.
    const trayY=SURFACE_H+FRAME*2;
    rect(4,trayY,WALL_W-8,2,'#d5d8de');rect(4,trayY+2,WALL_W-8,TRAY-3,'#8d9099');rect(4,trayY+TRAY-1,WALL_W-8,1,'#2a2c33');
    rect(4,trayY,1,TRAY,'#2a2c33');rect(WALL_W-5,trayY,1,TRAY,'#2a2c33');
    [['#d7263d',10],['#1f6fd1',17],['#1b1b1b',24]].forEach(([c,x])=>{rect(x,trayY-1,6,2,c);rect(x+5,trayY-1,1,2,'#2a2c33');});
  }
  function receive(update){const next=applyUpdate(strokes,update,known);strokes=next.strokes;known={serial:next.serial,clearedSerial:next.clearedSerial};dirty=true;}
  function load(all){strokes=[];known={serial:0,clearedSerial:0};receive(all);}
  // --- editor window
  const panel=document.createElement('section');panel.className='voice-panel whiteboard-editor';panel.hidden=true;panel.setAttribute('aria-label','Whiteboard');
  panel.innerHTML=`<header><h1>Whiteboard</h1><button type="button" class="appearance-close" aria-label="Close whiteboard">×</button></header><div class="whiteboard-body"><canvas class="whiteboard-canvas" width="${BOARD_WIDTH*2}" height="${BOARD_HEIGHT*2}" aria-label="Drawing area"></canvas><div class="whiteboard-tools"><div class="whiteboard-colors" role="group" aria-label="Pen colour">${COLORS.map((c,i)=>`<button type="button" data-color="${c}" style="--pen:${c}" aria-label="${i===COLORS.length-1?'Eraser':'Colour '+(i+1)}" aria-pressed="${i===0}"></button>`).join('')}</div><div class="whiteboard-sizes" role="group" aria-label="Pen size">${[2,4,8].map(s=>`<button type="button" data-size="${s}" aria-pressed="${s===4}"><i style="width:${s*2}px;height:${s*2}px"></i></button>`).join('')}</div><button type="button" class="whiteboard-clear">Clear board</button></div><p class="whiteboard-hint">Draw with your mouse or finger. Everyone in the room sees it live.</p></div>`;
  document.body.append(panel);makeDraggable(panel);
  const editor=panel.querySelector('.whiteboard-canvas'),ectx=editor.getContext('2d');
  panel.querySelector('header button').onclick=()=>close();
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){close();event.stopPropagation();}});
  panel.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{color=button.dataset.color;panel.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  panel.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>{size=Number(button.dataset.size);panel.querySelectorAll('[data-size]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
  panel.querySelector('.whiteboard-clear').onclick=()=>{send.clear().catch(error=>onError(error.message));};
  const boardPoint=event=>{const r=editor.getBoundingClientRect();return [Math.max(0,Math.min(BOARD_WIDTH,(event.clientX-r.left)/r.width*BOARD_WIDTH)),Math.max(0,Math.min(BOARD_HEIGHT,(event.clientY-r.top)/r.height*BOARD_HEIGHT))];};
  function flush(done=false){
    clearTimeout(flushTimer);flushTimer=null;
    if(!current||(!pending.length&&!done))return;
    const stroke=current,chunk=pending;pending=[];
    send.draw({id:stroke.id,color:stroke.color,size:stroke.size,points:chunk,done}).catch(error=>onError(error.message));
  }
  editor.addEventListener('pointerdown',event=>{
    if(event.button!==0&&event.pointerType==='mouse')return;
    editor.setPointerCapture(event.pointerId);
    const [x,y]=boardPoint(event);
    current={id:crypto.randomUUID().slice(0,32),color,size,points:[x,y],serial:Infinity};pending=[x,y];dirty=true;
    flushTimer=setTimeout(()=>flush(false),120);
  });
  editor.addEventListener('pointermove',event=>{
    if(!current)return;
    const [x,y]=boardPoint(event),n=current.points.length;
    if(Math.hypot(x-current.points[n-2],y-current.points[n-1])<.75)return;
    current.points.push(x,y);pending.push(x,y);dirty=true;
    if(!flushTimer)flushTimer=setTimeout(()=>flush(false),120);
  });
  const finish=()=>{if(!current)return;flush(true);const done={...current,serial:known.serial+1,done:true};strokes=[...strokes.filter(s=>s.id!==done.id),done];current=null;dirty=true;};
  editor.addEventListener('pointerup',finish);editor.addEventListener('pointercancel',finish);
  function open(){panel.hidden=false;dirty=true;panel.querySelector('.whiteboard-canvas').focus?.();}
  function close(){finish();panel.hidden=true;}
  return {canvas,width:WALL_W,height:WALL_H,load,receive,open,close,
    get isOpen(){return !panel.hidden;},
    // Repaint the wall board (and the editor while open) when anything changed.
    update(){if(!dirty)return false;dirty=false;paintWall();if(!panel.hidden){ectx.setTransform(1,0,0,1,0,0);ectx.fillStyle='#fbfbf6';ectx.fillRect(0,0,editor.width,editor.height);paintStrokes(ectx,2,2,2);}return true;}
  };
}
