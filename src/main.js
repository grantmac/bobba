import * as THREE from 'three';
import './style.css';
import {prepareImage} from './sprite-image.js';
import { createAppearance } from './appearance.js';
import { createToolbar } from './toolbar.js';
import { createRoomEditor, WALLS, FLOORS } from './room-editor.js';
import { createFurniture } from './furniture.js';
import { createInfoStand } from './info-stand.js';
import { createChat } from './chat.js';
import { createMultiplayer, samplePlayer } from './multiplayer.js';

const container = document.querySelector('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#121212');
const camera = new THREE.OrthographicCamera(-320, 320, 240, -240, 0.1, 2000);
camera.position.z = 1000;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false });
} catch (error) {
  document.querySelector('#load-error').hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.append(renderer.domElement);
let CENTER_Y = 70;
const ROOT = '/assets/private-room/';
let displayScale = 1,zoom=1;
let editingRoom=false,viewOffsetX=0,positionBeforeEdit;
const iso = (x, z) => ({ x: (x-z)*32-roomCenterX, y: (x+z)*16 });
const valid = (x, z) => walkable.has(`${x},${z}`);
let furniture,network,toolbar,selfPlayer,infoStand,actionControls;
const peers=new Map();
const canWalk=(x,z)=>valid(x,z)&&!furniture?.blocks(x,z);
const images = new Map();

async function loadImage(file) {
  if (!images.has(file)) images.set(file, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${file}`));
    image.src = ROOT+file;
  }));
  return images.get(file);
}

function textureFor(canvas) {
  const texture=new THREE.CanvasTexture(canvas);
  texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
  texture.generateMipmaps=false;texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
function sprite(canvas,x,y,order=0) {
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(canvas.width,canvas.height),new THREE.MeshBasicMaterial({map:textureFor(canvas),transparent:true,depthTest:false,depthWrite:false}));
  mesh.position.set(x+canvas.width/2,CENTER_Y-y-canvas.height/2,0);
  mesh.renderOrder=order;drawTarget.add(mesh);return mesh;
}
function polygon(points,color,order=0,outline=false) {
  const shape=new THREE.Shape(points.map(([x,y])=>new THREE.Vector2(x,CENTER_Y-y)));
  const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  mesh.renderOrder=order;drawTarget.add(mesh);
  if(outline){const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points.map(([x,y])=>new THREE.Vector3(x,CENTER_Y-y,0))),new THREE.LineBasicMaterial({color:'#222222',depthTest:false}));line.renderOrder=order+.1;drawTarget.add(line);}
  return mesh;
}

const roomGroup=new THREE.Group();scene.add(roomGroup);
let drawTarget=scene, roomCatalog, roomEditor, roomOptions={}, roomAssets={}, roomShape, walkable=new Set(), roomWidth=8, roomDepth=8, roomCenterX=0;
const surfaceCache=new Map();
function surface(file,paletteName,tint,mask){
  const key=file+paletteName+tint;
  if(!surfaceCache.has(key)){
    const targetPalette=roomCatalog.palettes[paletteName];
    const paletteMap=new Map(roomCatalog.sourcePalette.map((rgb,i)=>[rgb.join(','),targetPalette[i]]));
    surfaceCache.set(key,prepareImage(roomAssets[file],{paletteMap,tint,polygon:mask}));
  }
  return surfaceCache.get(key);
}
function buildRoom(options){
  roomOptions={...options};
  roomShape=roomCatalog.shapes.find(s=>s.id===options.shape);
  walkable=new Set(roomShape.tiles.map(([x,z])=>`${x},${z}`));
  roomWidth=Math.max(...roomShape.tiles.map(t=>t[0]))+1;roomDepth=Math.max(...roomShape.tiles.map(t=>t[1]))+1;
  roomCenterX=(roomWidth-roomDepth)*16;CENTER_Y=((roomWidth+roomDepth)*16-116)/2;
  roomGroup.traverse(object=>{object.geometry?.dispose();if(object.material){object.material.map?.dispose();object.material.dispose();}});roomGroup.clear();drawTarget=roomGroup;
  const wall=WALLS[options.wall],floor=FLOORS[options.floor];
  const dark='#'+options.wallColor.slice(1).match(/../g).map(v=>Math.max(0,parseInt(v,16)-16).toString(16).padStart(2,'0')).join('');
  const left=surface(`left_wallpart_${wall.type}_a_0_0_0.png`,wall.palette,dark,[[0,16],[32,0],[32,116],[0,132]]);
  const right=surface(`right_wallpart_${wall.type}_a_0_2_0.png`,wall.palette,options.wallColor,[[0,0],[32,16],[32,133],[0,117]]);
  const floorImage=surface(`flat_floor_${floor.type}_a_0_0_0.png`,floor.palette,options.floorColor,[[65,0],[130,32],[65,65],[0,32]]);
  // Sample one continuous floor surface. Clipping separate tile diamonds
  // produces dark antialiased seams through the original plank pattern.
  const floorCanvas=document.createElement('canvas');
  floorCanvas.width=(roomWidth+roomDepth)*32;floorCanvas.height=(roomWidth+roomDepth)*16;
  const floorContext=floorCanvas.getContext('2d'),floorPixels=floorContext.createImageData(floorCanvas.width,floorCanvas.height);
  const sourcePixels=floorImage.getContext('2d').getImageData(0,0,floorImage.width,floorImage.height).data;
  for(let py=0;py<floorCanvas.height;py++)for(let px=0;px<floorCanvas.width;px++){
    const sx=px+.5-roomDepth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    if(!valid(Math.floor(x),Math.floor(z)))continue;
    const u=((x%2)+2)%2,v=((z%2)+2)%2;
    const tx=Math.floor(65+(u-v)*32),ty=Math.floor((u+v)*16);
    const from=(ty*floorImage.width+tx)*4,to=(py*floorCanvas.width+px)*4;
    floorPixels.data[to]=sourcePixels[from];floorPixels.data[to+1]=sourcePixels[from+1];floorPixels.data[to+2]=sourcePixels[from+2];floorPixels.data[to+3]=255;
  }
  floorContext.putImageData(floorPixels,0,0);
  sprite(floorCanvas,-roomDepth*32-roomCenterX,0,10);
  const leftWalls=[],rightWalls=[];
  for(const [x,z] of roomShape.tiles){
    const p=iso(x,z),l=iso(x,z+1),r=iso(x+1,z),b=iso(x+1,z+1);
    if(!valid(x+1,z))polygon([[r.x,r.y],[b.x,b.y],[b.x,b.y+7],[r.x,r.y+7]],'#77776c',0,true);
    if(!valid(x,z+1))polygon([[l.x,l.y],[b.x,b.y],[b.x,b.y+7],[l.x,l.y+7]],'#5f6057',0,true);
    if(!valid(x-1,z)){
      leftWalls.push([x,z]);sprite(left,p.x-32,p.y-115,50+x+z/100);
      polygon([[p.x-7,p.y-118],[p.x,p.y-115],[p.x-32,p.y-99],[p.x-39,p.y-102]],options.wallColor,82,true);
      if(!valid(x,z+1))polygon([[p.x-39,p.y-102],[p.x-32,p.y-99],[p.x-32,p.y+17],[p.x-39,p.y+14]],dark,81,true);
    }
    if(!valid(x,z-1)){
      rightWalls.push([x,z]);sprite(right,p.x,p.y-116,50+x+z/100);
      polygon([[p.x,p.y-115],[p.x+7,p.y-118],[p.x+39,p.y-102],[p.x+32,p.y-99]],options.wallColor,82,true);
      if(!valid(x+1,z))polygon([[p.x+32,p.y-99],[p.x+39,p.y-102],[p.x+39,p.y+14],[p.x+32,p.y+18]],options.wallColor,81,true);
    }
  }
  const minX=Math.min(...leftWalls.map(t=>t[0]));const entrance=leftWalls.filter(t=>t[0]===minX).sort((a,b)=>b[1]-a[1]);
  if(entrance.length){const p=iso(...entrance[Math.min(1,entrance.length-1)]);sprite(prepareImage(roomAssets.door,{matte:true}),p.x-32,p.y-84,90);}
  if(options.window&&rightWalls.length>=3){
    const row=rightWalls.filter(t=>t[1]===Math.min(...rightWalls.map(t=>t[1]))).sort((a,b)=>a[0]-b[0]);
    const p=iso(...row[Math.max(0,Math.floor(row.length/2)-1)]);
    const c=document.createElement('canvas');c.width=64;c.height=97;const ctx=c.getContext('2d');
    ctx.drawImage(prepareImage(roomAssets.window,{matte:true}),0,0);ctx.drawImage(prepareImage(roomAssets.windowRight,{matte:true}),34,12);sprite(c,p.x,p.y-96,90);
  }
  drawTarget=scene;path=[];hover.visible=false;targetMarker.visible=false;
  if(!valid(Math.floor(position.x),Math.floor(position.z))){const [x,z]=roomShape.tiles.reduce((best,t)=>Math.hypot(t[0]+.5-position.x,t[1]+.5-position.z)<Math.hypot(best[0]+.5-position.x,best[1]+.5-position.z)?t:best);position.x=x+.5;position.z=z+.5;}
  container.dataset.shape=options.shape;furniture?.roomChanged();resize();
}

let avatarFrames=new Map(),appearance;
function setAppearance(frames) {
  const previous=avatarFrames;
  avatarFrames=new Map([...frames].map(([key,canvas])=>[key,textureFor(canvas)]));
  lastFrame='';
  if(avatar){avatar.material.map=avatarFrames.get(`${direction}:-1`);avatar.material.needsUpdate=true;}
  previous.forEach(texture=>texture.dispose());
}
function overCharacter(event) {
  if(!ready)return false;
  const r=container.getBoundingClientRect(),p=iso(position.x,position.z);
  const x=(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale;
  const y=(event.clientY-r.top-r.height/2)/displayScale+CENTER_Y;
  return x>=p.x-18&&x<=p.x+18&&y>=p.y-68&&y<=p.y+4;
}

function peerAt(event){
  if(!ready)return null;
  const point=screenPoint(event);
  return [...peers.values()].sort((a,b)=>b.mesh.renderOrder-a.mesh.renderOrder).find(peer=>{
    if(!peer.mesh.visible)return false;
    const sample=samplePlayer(peer.data,network.now()),p=iso(sample.x,sample.z);
    const seat=!sample.moving&&peer.data.seatId?furniture.seat(peer.data.seatId):null;p.y+=seat?.offsetY??0;
    return point.x>=p.x-18&&point.x<=p.x+18&&point.y>=p.y-68&&point.y<=p.y+4;
  });
}
function selectPeer(peer){furniture.close();infoStand.select(peer.data);container.focus({preventScroll:true});}

const position={x:3.5,z:4.5};
let path=[],direction=2,walkTime=0,avatar,lastFrame='',hoverCell=null,target=null,down=null,ready=false,seated=null,seatTarget=null;
const hoverCanvas=document.createElement('canvas');hoverCanvas.width=64;hoverCanvas.height=32;
const hoverCtx=hoverCanvas.getContext('2d');hoverCtx.strokeStyle='#fff9d5';hoverCtx.fillStyle='#ffffff15';hoverCtx.lineWidth=1;
hoverCtx.beginPath();hoverCtx.moveTo(32,.5);hoverCtx.lineTo(63,16);hoverCtx.lineTo(32,31);hoverCtx.lineTo(1,16);hoverCtx.closePath();hoverCtx.fill();hoverCtx.stroke();
const hover=sprite(hoverCanvas,0,0,200);hover.visible=false;
const targetCanvas=document.createElement('canvas');targetCanvas.width=16;targetCanvas.height=10;
const tctx=targetCanvas.getContext('2d');tctx.strokeStyle='#fffbd8';tctx.lineWidth=1;tctx.beginPath();tctx.moveTo(8,1);tctx.lineTo(15,5);tctx.lineTo(8,9);tctx.lineTo(1,5);tctx.closePath();tctx.stroke();
const targetMarker=sprite(targetCanvas,0,0,201);targetMarker.visible=false;
function place(mesh,left,top,width,height){mesh.position.set(left+width/2,CENTER_Y-top-height/2,0);}
function screenCell(event){
  const r=container.getBoundingClientRect();
  const sx=(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale;
  const sy=(event.clientY-r.top-r.height/2)/displayScale+CENTER_Y;
  const x=Math.floor((sx+roomCenterX)/64+sy/32),z=Math.floor(sy/32-(sx+roomCenterX)/64);
  return valid(x,z)?{x,z}:null;
}
function screenPoint(event){
  const r=container.getBoundingClientRect();
  return {x:(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale,y:(event.clientY-r.top-r.height/2)/displayScale+CENTER_Y};
}
function ensureFreeTile(){
  if(seated){
    const seat=furniture?.seat(seated.id);
    if(seat?.cells.some(([x,z])=>x===Math.floor(position.x)&&z===Math.floor(position.z))){seated=seat;direction=seat.direction;return;}
    seated=null;
  }
  if(canWalk(Math.floor(position.x),Math.floor(position.z)))return;
  const free=roomShape.tiles.filter(([x,z])=>canWalk(x,z)).sort((a,b)=>Math.hypot(a[0]+.5-position.x,a[1]+.5-position.z)-Math.hypot(b[0]+.5-position.x,b[1]+.5-position.z));
  if(free.length){position.x=free[0][0]+.5;position.z=free[0][1]+.5;}
}
async function walkTo(cell,seatId=null){
  if(!ready||!cell||(!seatId&&!canWalk(cell.x,cell.z)))return false;
  try{
    await network.move(cell.x,cell.z,seatId);
    target=cell;const p=iso(cell.x+.5,cell.z+.5);place(targetMarker,p.x-8,p.y-5,16,10);
    return true;
  }catch(error){toolbar?.status(error.message);return false;}
}
async function sitOn(seat){
  if(!seat)return;
  const cells=[...seat.cells].sort((a,b)=>Math.hypot(a[0]+.5-position.x,a[1]+.5-position.z)-Math.hypot(b[0]+.5-position.x,b[1]+.5-position.z));
  for(const [x,z] of cells)if(await walkTo({x,z},seat.id))break;
}
container.addEventListener('pointermove',event=>{
  if(peerAt(event)){hover.visible=false;container.style.cursor='pointer';return;}
  if(furniture?.pointer(screenPoint(event),screenCell(event))){hover.visible=false;container.style.cursor='pointer';return;}
  hoverCell=screenCell(event);container.style.cursor=hoverCell||overCharacter(event)?'pointer':'default';hover.visible=ready&&!!hoverCell;
  if(hoverCell){const p=iso(hoverCell.x,hoverCell.z);place(hover,p.x-32,p.y,64,32);}
});
container.addEventListener('pointerleave',()=>{hover.visible=false;down=null;});
container.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};});
container.addEventListener('pointercancel',()=>{down=null;});
container.addEventListener('pointerup',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<8){const peer=peerAt(event);if(peer){selectPeer(peer);}else if(furniture?.pointer(screenPoint(event),screenCell(event),true)){container.focus({preventScroll:true});}else if(overCharacter(event)){appearance.open();}else{infoStand?.hide();walkTo(screenCell(event));container.focus({preventScroll:true});}}down=null;});
container.addEventListener('keydown',event=>{
  if(furniture?.key(event)){event.preventDefault();return;}
  const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
  if(!delta)return;event.preventDefault();
  const from=path.length&&target?target:{x:Math.floor(position.x),z:Math.floor(position.z)};
  const cell={x:from.x+delta[0],z:from.z+delta[1]};if(valid(cell.x,cell.z))walkTo(cell);
});
container.addEventListener('wheel',event=>{
  event.preventDefault();
  zoom=Math.min(2,Math.max(.55,zoom*Math.exp(-event.deltaY*.0015)));
  resize();
},{passive:false});
function resize(){
  const w=container.clientWidth,h=container.clientHeight;
  const reserved=editingRoom&&w>1000?550:0;
  viewOffsetX=-reserved/2;
  const fit=Math.min(1.5,(w-reserved)/((roomWidth+roomDepth)*32+90),h/((roomWidth+roomDepth)*16+160));
  displayScale=fit*zoom;
  camera.left=(-w/2-viewOffsetX)/displayScale;camera.right=(w/2-viewOffsetX)/displayScale;
  camera.top=h/displayScale/2;camera.bottom=-h/displayScale/2;camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}
new ResizeObserver(resize).observe(container);resize();
const chat=createChat({getSpeaker:()=>{
  const p=iso(position.x,position.z),rect=container.getBoundingClientRect();
  return {name:network?.me?.name??'You',color:appearance?.chatColor()??'#6b8c64',x:rect.left+rect.width/2+viewOffsetX+p.x*displayScale};
},getLayout:()=>{
  // Map the original 480px game stage into our centred, zoomable viewport.
  // Keep interface text at its native pixel size.
  const rect=container.getBoundingClientRect();
  return {baseline:Math.max(40,Math.min(rect.height-40,rect.top+rect.height/2+(125-240)*displayScale))};
},onSelectSpeaker:speaker=>{const peer=[...peers.values()].find(p=>p.data.name===speaker.name);if(peer)selectPeer(peer);else if(speaker.name===network?.me?.name)appearance?.open();}});
function disposePeer(peer){
  peer.version++;scene.remove(peer.mesh);peer.mesh.geometry.dispose();peer.mesh.material.dispose();peer.textures.forEach(t=>t.dispose());peer.label.remove();
}
function updatePeers(players){
  const present=new Set(players.filter(p=>p.id!==network.me?.id).map(p=>p.id));
  for(const [id,peer] of peers)if(!present.has(id)){disposePeer(peer);peers.delete(id);}
  for(const data of players){
    if(data.id===network.me?.id)continue;
    let peer=peers.get(data.id);
    if(!peer){
      const blank=document.createElement('canvas');blank.width=96;blank.height=112;
      const mesh=sprite(blank,0,0,300);mesh.visible=false;mesh.material.map.dispose();mesh.material.map=null;
      const label=document.createElement('button');label.type='button';label.className='player-target';label.setAttribute('aria-label',`Select ${data.name}`);label.onpointerdown=event=>event.stopPropagation();label.onpointerup=event=>event.stopPropagation();label.onclick=()=>selectPeer(peer);container.append(label);
      peer={mesh,label,textures:new Map(),version:0,lookKey:''};peers.set(data.id,peer);
    }
    peer.data=data;
    const key=JSON.stringify(data.look);
    if(peer.lookKey!==key){
      peer.lookKey=key;const version=++peer.version;
      appearance.frames(data.look).then(frames=>{
        if(version!==peer.version)return;
        peer.textures.forEach(t=>t.dispose());peer.textures=new Map([...frames].map(([k,c])=>[k,textureFor(c)]));peer.mesh.visible=true;
      }).catch(error=>{peer.lookKey='';toolbar?.status(error.message);});
    }
  }
}
function positionCharacter(mesh,point,seat){
  const p=iso(point.x,point.z);p.y+=seat?.offsetY??0;
  place(mesh,Math.round(p.x)-48,Math.round(p.y)-101,96,112);
  mesh.renderOrder=300+(seat?Math.max(...seat.cells.map(([x,z])=>x+z)):point.x+point.z-1)*10+9.5;
  return p;
}
function characterFrame(player,point,time,seat){
  if(point.moving)return `${point.direction}:${Math.floor(time/1000*9)%4}`;
  const age=time-(player.actionStarted??0);
  if(player.action==='wave'&&age<3000)return `${point.direction}:${seat?'sit-wave':'wave'}:${Math.floor(age/180)%2}`;
  if(player.action==='dance')return `${point.direction}:dance:${Math.floor(age/180)%8}`;
  return `${point.direction}:${seat?'sit':-1}`;
}
function animate(now){
  if(ready&&selfPlayer){
    const time=network.now(),sample=samplePlayer(selfPlayer,time);
    Object.assign(position,{x:sample.x,z:sample.z});direction=sample.direction;
    seated=!sample.moving&&selfPlayer.seatId?furniture.seat(selfPlayer.seatId):null;
    const key=characterFrame(selfPlayer,sample,time,seated);
    if(lastFrame!==key){avatar.material.map=avatarFrames.get(key);avatar.material.needsUpdate=true;lastFrame=key;}
    positionCharacter(avatar,position,seated);
    if(infoStand?.selected){const selected=peers.get(infoStand.selected);infoStand.update(selected?.data,selected?.textures.get('2:-1')?.image);}
    chat.update(now);targetMarker.visible=sample.moving&&!editingRoom;
    container.dataset.cell=`${Math.floor(position.x)},${Math.floor(position.z)}`;
    container.dataset.moving=String(sample.moving);container.dataset.pose=key.split(':')[1];
    if(actionControls)actionControls.querySelector('[data-gesture="dance"]').setAttribute('aria-pressed',String(selfPlayer.action==='dance'));
    container.dataset.players=String(peers.size+1);container.dataset.player=network.me.name;
  }
  if(network&&furniture){const time=network.now();
    for(const peer of peers.values()){
      const point=samplePlayer(peer.data,time),seat=!point.moving&&peer.data.seatId?furniture.seat(peer.data.seatId):null;
      peer.mesh.material.map=peer.textures.get(characterFrame(peer.data,point,time,seat));peer.mesh.material.needsUpdate=true;
      const p=positionCharacter(peer.mesh,point,seat);
      peer.label.style.left=`${container.clientWidth/2+viewOffsetX+(p.x-18)*displayScale}px`;
      peer.label.style.top=`${container.clientHeight/2+(p.y-CENTER_Y-68)*displayScale}px`;
      peer.label.style.width=`${36*displayScale}px`;peer.label.style.height=`${72*displayScale}px`;
      peer.label.hidden=!peer.mesh.visible;
    }
  }
  renderer.render(scene,camera);requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
try{
  toolbar=createToolbar({admin:false,onRoomEdit:()=>{if(ready&&network.me?.role==='admin')roomEditor.open();},onFurniture:view=>{if(ready)furniture.open(view);},onChat:(body,mode)=>{if(ready)return network.chat(body,mode);}});
  network=createMultiplayer();
  const [catalogResponse,paletteResponse,initialRoom]=await Promise.all([fetch('/assets/room-options/catalog.json'),fetch('/assets/room-options/source-palette.json'),network.loadPreview()]);
  if(!catalogResponse.ok||!paletteResponse.ok)throw new Error('Room choices could not be loaded.');
  roomCatalog=await catalogResponse.json();roomCatalog.sourcePalette=await paletteResponse.json();
  const files=['left_wallpart_0_a_0_0_0.png','right_wallpart_0_a_0_2_0.png','left_wallpart_1_a_0_0_0.png','right_wallpart_1_a_0_2_0.png','flat_floor_0_a_0_0_0.png','flat_floor_1_a_0_0_0.png','flat_floor_2_a_0_0_0.png'];
  await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{roomAssets[file]=image;resolve();};image.onerror=reject;image.src='/assets/room-options/'+file;})));
  [roomAssets.door,roomAssets.window,roomAssets.windowRight]=await Promise.all(['door.png','window.png','window-right.png'].map(loadImage));
  const stopWalking=()=>{path=[];seatTarget=null;if(seated){seated=null;ensureFreeTile();}hover.visible=false;targetMarker.visible=false;};
  roomEditor=createRoomEditor({catalog:roomCatalog,initial:initialRoom.room.options,onSave:options=>network.options(options),onPreview:buildRoom,onOpen:()=>{
    stopWalking();furniture?.close();positionBeforeEdit={...position};editingRoom=true;resize();
  },onClose:committed=>{
    if(!committed)Object.assign(position,positionBeforeEdit);
    furniture?.roomChanged(committed);ensureFreeTile();
    editingRoom=false;resize();container.focus({preventScroll:true});
  }});
  buildRoom(roomEditor.initial);
  infoStand=await createInfoStand(prepareImage);
  appearance=await createAppearance({prepareImage,onApply:async(frames,look,context)=>{if(!context.entry)await network.appearance(look);setAppearance(frames);},onOpen:()=>{stopWalking();furniture?.close();}});
  setAppearance(appearance.initial);
  const furnitureMarks=new THREE.Group();scene.add(furnitureMarks);
  furniture=await createFurniture({initialItems:initialRoom.room.furniture,
    prepareImage,worldPoint:iso,isTile:valid,getAvatar:()=>position,stopWalking,onChanged:ensureFreeTile,onSit:sitOn,
    focusRoom:()=>container.focus({preventScroll:true}),
    makeVisual:canvas=>sprite(canvas,0,0,300),
    disposeVisual:mesh=>{scene.remove(mesh);mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();},
    positionVisual:(mesh,x,y,w,h,order)=>{place(mesh,x,y,w,h);mesh.renderOrder=order;},
    markTiles:(cells,color)=>{
      furnitureMarks.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});furnitureMarks.clear();
      drawTarget=furnitureMarks;
      for(const [x,z] of cells){const p=iso(x,z);const mesh=polygon([[p.x,p.y],[p.x+32,p.y+16],[p.x,p.y+32],[p.x-32,p.y+16]],color,25,true);mesh.material.transparent=true;mesh.material.opacity=.4;}
      drawTarget=scene;
    }
  });
  ensureFreeTile();
  const blank=document.createElement('canvas');blank.width=96;blank.height=112;
  avatar=sprite(blank,0,0,300);avatar.material.map.dispose();avatar.visible=false;
  const resumed=await network.resume();
  if(resumed)setAppearance(await appearance.useLook(resumed.look));
  else {
    let stopPreview;
    await new Promise((resolve,reject)=>{
      let roomKey='',furnitureKey='';
      stopPreview=network.preview(state=>{
        const rk=JSON.stringify(state.room.options),fk=JSON.stringify(state.room.furniture);
        if(rk!==roomKey){roomKey=rk;roomEditor.receive(state.room.options);}
        if(fk!==furnitureKey){furnitureKey=fk;furniture.receive(state.room.furniture);}
        updatePeers(state.players);resolve();
      },message=>reject(new Error(message)));
    });
    await appearance.enter({admin:network.adminEntry,onEnter:(name,look)=>network.join(name,look)});
    stopPreview();
  }
  const admin=network.me.role==='admin';
  furniture.connect({admin,onSave:items=>network.furniture(items)});
  toolbar.setAdmin(admin);
  actionControls=document.createElement('div');actionControls.className='avatar-actions';actionControls.setAttribute('aria-label','Your actions');
  actionControls.innerHTML='<button type="button" data-gesture="wave">Wave</button><button type="button" data-gesture="dance" aria-pressed="false">Dance</button>';
  actionControls.querySelectorAll('button').forEach(button=>button.onclick=()=>network.gesture(button.dataset.gesture).catch(error=>toolbar.status(error.message)));
  document.body.append(actionControls);
  let roomKey='',furnitureKey='',ownLook=JSON.stringify(network.me.look),lookVersion=0;
  const seenMessages=new Set();
  await new Promise((resolve,reject)=>{
    let first=true;
    network.watch(state=>{
      const nextRoom=JSON.stringify(state.room.options),nextFurniture=JSON.stringify(state.room.furniture);
      if(nextRoom!==roomKey){roomKey=nextRoom;roomEditor.receive(state.room.options);}
      if(nextFurniture!==furnitureKey){furnitureKey=nextFurniture;furniture.receive(state.room.furniture);}
      selfPlayer=state.me;updatePeers(state.players);
      const nextLook=JSON.stringify(state.me.look);
      if(nextLook!==ownLook){ownLook=nextLook;const version=++lookVersion;appearance.useLook(state.me.look).then(frames=>{if(version===lookVersion)setAppearance(frames);}).catch(error=>toolbar.status(error.message));}
      for(const message of state.messages){
        if(seenMessages.has(message.id))continue;seenMessages.add(message.id);
        if(network.now()-message.sentAt>28000)continue;
        const p=iso(message.x,message.z),rect=container.getBoundingClientRect();
        chat.say(message.body,message.mode,{name:message.name,color:message.color,x:rect.left+rect.width/2+viewOffsetX+p.x*displayScale});
      }
      // Bound deduplication memory to the server's current message window.
      const recentIds=new Set(state.messages.map(m=>m.id));for(const id of seenMessages)if(!recentIds.has(id))seenMessages.delete(id);
      avatar.visible=true;ready=true;
      if(first){first=false;resolve();}
    },message=>{toolbar.status(message);if(first)reject(new Error(message));});
  });
  container.focus({preventScroll:true});
}catch(error){const notice=document.querySelector('#load-error');notice.textContent=error.message||'The room could not be opened. Please reload to try again.';notice.hidden=false;console.error(error);}
