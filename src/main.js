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
import {createAwayPoster} from './away-poster.js';
import {createAgentLink} from './agent-link.js';
import {createStickies} from './stickies.js';
import {installTouchNavigation} from './touch-navigation.js';
import {createVoice} from './voice.js';
import {roomLayout,tileDrop,walkingDrop,tileAtPoint,isPoolWater,pitSeat,backWallTiles,onWalkway,STEP_DOWN,DANCE_ROWS} from '../shared/room-layout.js';
import {floorSampler,createSpaceFloor,createMetalWalkway,picturePixels,pictureSampler,wallSegment} from './spaces.js';
import {renderPicture,startSnapshots} from './snapshot.js';
import {createDanceFloor} from './dance-floor.js';
import {createDanceFloorControls} from './dance-floor-controls.js';
import {createDiscoBall} from './disco-ball.js';
import {createDiscoLights} from './disco-lights.js';
import {loadDeckSign,SIGN_LIFT,SIGN_DENSITY} from './deck-sign.js';
import {createRoomRadio} from './room-radio.js';
import {installAutoUpdate,saveUpdateSession,takeUpdateSession,peekUpdateSession} from './auto-update.js';
// The update veil hides the cold start after a deployment reload. It lifts once the room is
// ready (or if the join flow needs the screen), and drops again just before the next reload.
const veil=document.querySelector('#update-veil');
let veilTimer=setTimeout(liftVeil,6000);
function liftVeil(){clearTimeout(veilTimer);if(!veil||veil.hidden)return;veil.classList.add('lifting');setTimeout(()=>{veil.hidden=true;veil.classList.remove('lifting');},450);}
function dropVeil(){if(!veil)return;clearTimeout(veilTimer);veil.classList.remove('lifting');veil.hidden=false;}
import {createPool,createWoodDeck,loadPoolAssets} from './pool.js';
import {createPlantWall} from './plant-wall.js';
import {createLoungeFloor,loadSunkenSofa} from './lounge.js';
import {createPong} from './pong.js';
import {createWhiteboard} from './whiteboard.js';
import {createLogbook} from './logbook.js';
import {createBlimp} from './blimp.js';

const container = document.querySelector('#scene');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
renderer.localClippingEnabled=true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.append(renderer.domElement);
let CENTER_Y = 70;
const ROOT = '/assets/private-room/';
let displayScale = 1,zoom=1;
let editingRoom=false,viewOffsetX=0,viewOffsetY=0,panX=0,panY=0,positionBeforeEdit;
let viewRestored=false,viewCentred=false;
let logbook=null;
let blimp=null,blimpMesh=null,pong=null,pongMesh=null,pongFrame=null,whiteboard=null,whiteboardMesh=null,whiteboardFrame=null;
// The whiteboard hangs on the lounge's back wall, on the three tiles right of the Pong
// projection, 40 px above the floor line. That wall runs along x, so its right end sits lower.
function placeWhiteboard(){
  if(!whiteboardMesh||!layout)return;
  const p=iso(layout.lounge.x+5,layout.lounge.z),w=whiteboard.width,h=whiteboard.height;
  whiteboardFrame={cx:p.x+48,cy:p.y+24-38-h/2,w,h};
  place(whiteboardMesh,whiteboardFrame.cx-w/2,whiteboardFrame.cy-h/2,w,h);
}
function whiteboardAt(point){
  if(!whiteboardFrame||!whiteboardMesh?.visible)return false;
  const x=point.x-whiteboardFrame.cx,y=point.y-whiteboardFrame.cy-x/2;
  return Math.abs(x)<=whiteboardFrame.w/2&&Math.abs(y)<=whiteboardFrame.h/2;
}
// The projection sits on the lounge's back wall, which runs along x: a 128 by 72 panel
// sheared so its right end sits 64 px lower than its left, 24 px above the floor line.
function placePong(){
  if(!pongMesh||!layout)return;
  const p=iso(layout.lounge.x,layout.lounge.z);
  pongFrame={cx:p.x+64,cy:p.y+32-24-36};
  place(pongMesh,pongFrame.cx-64,pongFrame.cy-36,128,72);
}
// The tiles right under the projection. A player must stand on one to play; clicking the
// projection from elsewhere walks them over, and walking away hands the paddle back.
const inPongZone=(x,z)=>!!layout&&z===layout.lounge.z&&x>=layout.lounge.x&&x<layout.lounge.x+layout.lounge.width;
async function usePong(){
  if(inPongZone(Math.floor(position.x),Math.floor(position.z))){pong.toggle().catch(error=>toolbar.status(error.message));return;}
  const taken=new Set([...peers.values()].map(peer=>{const end=peer.data.route.at(-1);return `${Math.floor(end.x)},${Math.floor(end.z)}`;}));
  const spots=Array.from({length:layout.lounge.width},(_,i)=>[layout.lounge.x+i,layout.lounge.z]).filter(([x,z])=>canWalk(x,z)&&!taken.has(`${x},${z}`));
  if(!spots.length){toolbar.status('No room in front of the screen.');return;}
  const [x,z]=spots.sort((a,b)=>Math.hypot(a[0]+.5-position.x,a[1]+.5-position.z)-Math.hypot(b[0]+.5-position.x,b[1]+.5-position.z))[0];
  await walkTo({x,z},null,0);
}
// Point in room coordinates -> position on the projection (0..1 each axis), or null.
function pongAt(point){
  if(!pongFrame||!pongMesh?.visible)return null;
  const x=point.x-pongFrame.cx,y=point.y-pongFrame.cy-x/2;
  return Math.abs(x)<=64&&Math.abs(y)<=36?{u:(x+64)/128,v:(y+36)/72}:null;
}
// Container geometry is read once per resize; per-frame code must not force layout.
const view={halfW:0,halfH:0,top:0,left:0};
// Phones open on the player's own avatar, since the room is larger than their screen.
function centreViewOnAvatar(){
  if(viewCentred||viewRestored||!(matchMedia('(pointer: coarse)').matches||container.clientWidth<=640))return;
  viewCentred=true;const p=characterPoint(position.x,position.z);panX=-p.x*displayScale;panY=-(p.y-CENTER_Y-30)*displayScale;resize();
}
const iso = (x, z) => ({ x: (x-z)*32-roomCenterX, y: (x+z)*16 });
const valid = (x, z) => walkable.has(`${x},${z}`);
let furniture,network,toolbar,selfPlayer,infoStand,stickies,voice;
let grantOnline=false,awayPoster,deckSign=null,deckSignImages=null,leftWallSet=new Set(),rightWallSet=new Set();
let danceFloorOn=true,danceControls,discoBall,discoMesh,radio;
let fridgeSeen=0,stickiesKey='';
// Sticky notes carry their own revisions, so a short id:revision list detects changes without serialising their text.
function receiveStickies(value=[]){const key=value.map(n=>`${n.id}:${n.revision}`).join('|');if(key===stickiesKey)return;stickiesKey=key;stickies?.receive(value);}
function receiveFridge(value){if(!value||value.at===fridgeSeen)return;fridgeSeen=value.at;if(network.now()-value.at<2500)furniture?.setOpen(value.id,value.at+1800);}
function receiveDanceFloor(value){danceFloorOn=value??true;danceControls?.receive(danceFloorOn);container.dataset.danceFloorOn=String(danceFloorOn);}
let initialFurniture=[],posterWalls=[];
// Hang the Poolside FM sign on the wall behind powered DJ decks, centred over them.
function positionDeckSign(){
  const cells=furniture?.deckSpot()??[];
  if(deckSign)deckSign.left.visible=deckSign.right.visible=false;
  // The decks may stand a tile or two out from the wall; take the nearest wall behind them.
  let side=null,tiles=[];
  for(let back=0;back<3&&!side;back++){
    const left=cells.filter(([x,z])=>leftWallSet.has(`${x-back},${z}`)).map(([x,z])=>[x-back,z]);
    const right=cells.filter(([x,z])=>rightWallSet.has(`${x},${z-back}`)).map(([x,z])=>[x,z-back]);
    if(left.length){side='left';tiles=left;}else if(right.length){side='right';tiles=right;}
  }
  if(!side||!deckSignImages)return;
  if(!deckSign){deckSign={};for(const s of ['left','right']){deckSign[s]=sprite(deckSignImages[s].canvas,0,0,92);deckSign[s].scale.setScalar(1/SIGN_DENSITY);deckSign[s].material.map.minFilter=THREE.LinearFilter;deckSign[s].material.map.magFilter=THREE.LinearFilter;roomGroup.add(deckSign[s]);}}
  const mesh=deckSign[side],{width,height,textHeight}=deckSignImages[side];
  let x0,floorY;
  if(side==='left'){
    const x=tiles[0][0],zs=tiles.map(t=>t[1]),high=groundPoint(x,Math.min(...zs)),low=groundPoint(x,Math.max(...zs)+1);
    x0=low.x+(high.x-low.x-width)/2;floorY=high.y+(high.x-(x0+width))*.5;
  }else{
    const z=tiles[0][1],xs=tiles.map(t=>t[0]),high=groundPoint(Math.min(...xs),z),low=groundPoint(Math.max(...xs)+1,z);
    x0=high.x+(low.x-high.x-width)/2;floorY=high.y+(x0-high.x)*.5;
  }
  place(mesh,Math.round(x0),Math.round(floorY-SIGN_LIFT-textHeight),width,height);
  mesh.visible=true;
}
function positionAwayPoster(){
  if(!awayPoster||!posterWalls.length)return;
  const sofa=(furniture?.getItems()??initialFurniture).find(item=>item.type==='exe_sofa'&&Number.isInteger(item.x));
  // Centre the note on the wall behind the three-seat Executive sofa.
  const target=sofa?{x:sofa.x,z:sofa.z+(sofa.rotation%4===2?1:0)}:{x:0,z:4};
  const tile=posterWalls.reduce((best,tile)=>Math.hypot(tile[0]-target.x,tile[1]-target.z)<Math.hypot(best[0]-target.x,best[1]-target.z)?tile:best);
  const p=iso(...tile);
  place(awayPoster,p.x-38,p.y-108,44,72);
}
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
let drawTarget=scene, roomCatalog, roomEditor, roomOptions={}, roomSpaces=[], roomAssets={}, roomShape, layout, mainTiles=new Set(),walkable=new Set(), roomWidth=8, roomDepth=8, roomCenterX=0,danceFloor,danceMesh,pool,poolMesh,discoLights,discoLightsMesh;
const floorHeight=(x,z)=>layout?tileDrop(layout,x,z):0;
const groundPoint=(x,z)=>{const p=iso(x,z);p.y+=floorHeight(x,z);return p;};
const characterPoint=(x,z)=>{const p=iso(x,z);p.y+=layout?walkingDrop(layout,z,x):0;return p;};
// Pictures uploaded for space floors and walls, fetched once per URL before the room is built;
// one that fails to load leaves the finish beneath showing.
const spacePictures=new Map(),spacePictureLoads=new Map();
function loadSpacePictures(spaces){
  return Promise.all((spaces??[]).flatMap(s=>[s.floorImageUrl,s.wallImageUrl]).filter(Boolean).map(url=>{
    // A slow picture never holds the room up: after eight seconds the rebuild goes ahead without it.
    if(!spacePictureLoads.has(url))spacePictureLoads.set(url,new Promise(resolve=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>{spacePictures.set(url,image);resolve();};image.onerror=()=>resolve();image.src=url;setTimeout(resolve,8000);}));
    return spacePictureLoads.get(url);
  }));
}
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
  layout=roomLayout(roomShape.tiles,roomSpaces);mainTiles=new Set(roomShape.tiles.map(([x,z])=>`${x},${z}`));
  walkable=new Set(layout.tiles.map(([x,z])=>`${x},${z}`));
  roomWidth=layout.width;roomDepth=layout.depth;
  roomCenterX=(layout.extentWidth-roomDepth)*16;CENTER_Y=((layout.extentWidth+roomDepth)*16-116)/2;
  roomGroup.traverse(object=>{object.geometry?.dispose();if(object.material){object.material.map?.dispose();object.material.dispose();}});roomGroup.clear();drawTarget=roomGroup;deckSign=null;
  const wall=WALLS[options.wall],floor=FLOORS[options.floor];
  const dark='#'+options.wallColor.slice(1).match(/../g).map(v=>Math.max(0,parseInt(v,16)-16).toString(16).padStart(2,'0')).join('');
  const left=surface(`left_wallpart_${wall.type}_a_0_0_0.png`,wall.palette,dark,[[0,16],[32,0],[32,116],[0,132]]);
  const right=surface(`right_wallpart_${wall.type}_a_0_2_0.png`,wall.palette,options.wallColor,[[0,0],[32,16],[32,133],[0,117]]);
  // Keep a continuous ceiling line; only the lower edge follows the step.
  const extendWall=source=>{
    const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height+STEP_DOWN;
    const ctx=canvas.getContext('2d'),pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    for(let x=0;x<source.width;x++){
      let bottom=source.height-1;while(bottom>2&&pixels[(bottom*source.width+x)*4+3]<128)bottom--;
      const body=bottom-2;
      ctx.drawImage(source,x,0,1,body+1,x,0,1,body+1);
      ctx.drawImage(source,x,body,1,1,x,body+1,1,STEP_DOWN);
      ctx.drawImage(source,x,body+1,1,2,x,body+1+STEP_DOWN,1,2);
    }
    return canvas;
  };
  const lowerLeft=extendWall(left),lowerRight=extendWall(right);
  const floorImage=surface(`flat_floor_${floor.type}_a_0_0_0.png`,floor.palette,options.floorColor,[[65,0],[130,32],[65,65],[0,32]]);
  // Sample one continuous floor surface. Clipping separate tile diamonds
  // produces dark antialiased seams through the original plank pattern.
  const floorCanvas=document.createElement('canvas');
  floorCanvas.width=(roomWidth+roomDepth)*32;floorCanvas.height=(roomWidth+roomDepth)*16;
  const floorContext=floorCanvas.getContext('2d'),floorPixels=floorContext.createImageData(floorCanvas.width,floorCanvas.height);
  // Wood gets grain: planks run along x, half a tile wide, each with its own tone and fine streaks (src/spaces.js).
  const sampleMain=floorSampler(floorImage,floor.type===2);
  for(let py=0;py<floorCanvas.height;py++)for(let px=0;px<floorCanvas.width;px++){
    const sx=px+.5-roomDepth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    if(!mainTiles.has(`${Math.floor(x)},${Math.floor(z)}`))continue;
    const [r,g,b]=sampleMain(x,z),to=(py*floorCanvas.width+px)*4;
    floorPixels.data[to]=r;floorPixels.data[to+1]=g;floorPixels.data[to+2]=b;floorPixels.data[to+3]=255;
  }
  floorContext.putImageData(floorPixels,0,0);
  sprite(floorCanvas,-roomDepth*32-roomCenterX,0,10);
  danceFloor=createDanceFloor(roomWidth);
  danceMesh=sprite(danceFloor.canvas,-roomDepth*32-roomCenterX,layout.danceStart*16+STEP_DOWN,9);
  discoLights=createDiscoLights(roomWidth);
  discoLightsMesh=sprite(discoLights.canvas,-roomDepth*32-roomCenterX,layout.danceStart*16+STEP_DOWN,9.5);
  discoLightsMesh.material.blending=THREE.AdditiveBlending;
  pool=createPool(layout.pool.depth,roomAssets.pool);pool.draw(0);
  const poolOrigin=iso(layout.pool.x,layout.pool.z);
  poolMesh=sprite(pool.canvas,poolOrigin.x+pool.left,poolOrigin.y,12);
  const decking=createWoodDeck(layout.parking.width,layout.parking.depth),deckOrigin=iso(layout.parking.x,layout.parking.z);
  sprite(decking,deckOrigin.x-layout.parking.depth*32,deckOrigin.y,12);
  // A living wall closes the deck's open back edge, continuing the room's right wall line.
  sprite(createPlantWall(layout.parking.width),deckOrigin.x,deckOrigin.y-121,50+layout.parking.x);
  // The games lounge: carpet floor, and a back wall in the room's wallpaper that carries on from the plant wall.
  const loungeOrigin=iso(layout.lounge.x,layout.lounge.z);
  sprite(createLoungeFloor(layout.lounge.width,layout.lounge.depth),loungeOrigin.x-layout.lounge.depth*32,loungeOrigin.y,12);
  const pitOrigin=iso(layout.pit.x,layout.pit.z);
  if(roomAssets.sofa){
    const sofa=roomAssets.sofa,mesh=sprite(sofa.canvas,0,0,13);
    mesh.scale.setScalar(1/2);mesh.material.map.minFilter=THREE.LinearFilter;mesh.material.map.magFilter=THREE.LinearFilter;
    place(mesh,pitOrigin.x+sofa.left,pitOrigin.y+sofa.top,sofa.width,sofa.height);
  }
  // Player-added spaces chain on past the lounge: each gets its own floor finish from the room's
  // floor textures, with the owner's picture laid over it if they uploaded one, and the back wall
  // carries on behind them to an end cap on the last one.
  for(const space of layout.spaces){
    const finish=FLOORS[space.floor]??FLOORS.carpet,image=surface(`flat_floor_${finish.type}_a_0_0_0.png`,finish.palette,space.floorColor,[[65,0],[130,32],[65,65],[0,32]]);
    const origin=iso(space.x,space.z),picture=spacePictures.get(space.floorImageUrl),cover=space.floorFit==='cover';
    const pixels=picture&&picturePixels(picture,cover?space.width*64:64,cover?space.depth*64:64);
    sprite(createSpaceFloor(space.width,space.depth,pictureSampler(floorSampler(image,finish.type===2),pixels,space.floorFit,space.width,space.depth)),origin.x-space.depth*32,origin.y,12);
  }
  // Steel walkway along the front of the lounge and spaces, over their front faces at floor level.
  if(layout.walkway){
    const way=layout.walkway,origin=iso(way.x,way.z);
    sprite(createMetalWalkway(way.width,way.depth),origin.x-way.depth*32,origin.y,12.5);
  }
  // Each space's stretch of the back wall takes that space's wallpaper, colour and picture; the
  // lounge's stretch stays in the room's own.
  const backWall=backWallTiles(layout),spaceAt=x=>layout.spaces.find(s=>x>=s.x&&x<s.x+s.width);
  for(const [x,z] of backWall){
    const p=iso(x,z),space=spaceAt(x);
    let face=right,color=options.wallColor;
    if(space){
      color=space.wallColor??options.wallColor;
      const paper=WALLS[space.wall]??wall,picture=spacePictures.get(space.wallImageUrl);
      face=surface(`right_wallpart_${paper.type}_a_0_2_0.png`,paper.palette,color,[[0,0],[32,16],[32,133],[0,117]]);
      if(picture)face=wallSegment(face,picture,space.wallFit,x-space.x,space.width);
    }
    // Segments overlap left to right, but all stay below the ceiling lines (82) and hung pieces (95), however far the spaces reach.
    sprite(face,p.x,p.y-116,50+x/10);
    polygon([[p.x,p.y-115],[p.x+7,p.y-118],[p.x+39,p.y-102],[p.x+32,p.y-99]],color,82,true);
    if(x===layout.extentWidth-1)polygon([[p.x+32,p.y-99],[p.x+39,p.y-102],[p.x+39,p.y+14],[p.x+32,p.y+18]],color,81,true);
  }
  // The main floor's exposed front edge becomes the riser of the lower terrace.
  // The dance floor's open edges get a slate riser with a pale lip, so the terrace reads as a
  // raised platform rather than dissolving into the dark background.
  for(const [x,z] of layout.danceTiles){
    const l=groundPoint(x,z+1),r=groundPoint(x+1,z),b=groundPoint(x+1,z+1),drop=14;
    if(!valid(x+1,z)){polygon([[r.x,r.y],[b.x,b.y],[b.x,b.y+drop],[r.x,r.y+drop]],'#4c5062',0,true);polygon([[r.x,r.y],[b.x,b.y],[b.x,b.y+2],[r.x,r.y+2]],'#9ba1b6',0);}
    if(!valid(x,z+1)){polygon([[l.x,l.y],[b.x,b.y],[b.x,b.y+drop],[l.x,l.y+drop]],'#3a3d4c',0,true);polygon([[l.x,l.y],[b.x,b.y],[b.x,b.y+2],[l.x,l.y+2]],'#858ba0',0);}
  }
  const leftWalls=[],rightWalls=[];
  const mainValid=(x,z)=>mainTiles.has(`${x},${z}`);
  for(const [x,z] of roomShape.tiles){
    const p=iso(x,z),l=iso(x,z+1),r=iso(x+1,z),b=iso(x+1,z+1);
    if(!valid(x+1,z))polygon([[r.x,r.y],[b.x,b.y],[b.x,b.y+STEP_DOWN+7],[r.x,r.y+STEP_DOWN+7]],'#77776c',0,true);
    if(!mainValid(x,z+1)){const drop=z+1===layout.danceStart?STEP_DOWN:STEP_DOWN+7;polygon([[l.x,l.y],[b.x,b.y],[b.x,b.y+drop],[l.x,l.y+drop]],'#5f6057',11,true);}
  }
  for(const [x,z] of [...layout.mainTiles,...layout.danceTiles]){
    const p=iso(x,z),drop=floorHeight(x,z);
    if(!valid(x-1,z)){
      leftWalls.push([x,z]);sprite(drop?lowerLeft:left,p.x-32,p.y-115,50+x+z/100);
      polygon([[p.x-7,p.y-118],[p.x,p.y-115],[p.x-32,p.y-99],[p.x-39,p.y-102]],options.wallColor,82,true);
      if(!valid(x,z+1))polygon([[p.x-39,p.y-102],[p.x-32,p.y-99],[p.x-32,p.y+17+drop],[p.x-39,p.y+14+drop]],dark,81,true);
    }
    if(!valid(x,z-1)){
      rightWalls.push([x,z]);sprite(drop?lowerRight:right,p.x,p.y-116,50+x+z/100);
      polygon([[p.x,p.y-115],[p.x+7,p.y-118],[p.x+39,p.y-102],[p.x+32,p.y-99]],options.wallColor,82,true);
      if(!valid(x+1,z))polygon([[p.x+32,p.y-99],[p.x+39,p.y-102],[p.x+39,p.y+14+drop],[p.x+32,p.y+18+drop]],options.wallColor,81,true);
    }
  }
  const minX=Math.min(...leftWalls.map(t=>t[0]));const entrance=leftWalls.filter(t=>t[0]===minX&&t[1]<layout.danceStart).sort((a,b)=>b[1]-a[1]);
  if(entrance.length){const p=iso(...entrance[Math.min(1,entrance.length-1)]);sprite(prepareImage(roomAssets.door,{matte:true}),p.x-32,p.y-84,90);}
  // Wall pieces can also hang on the back wall behind the lounge and the added spaces.
  leftWallSet=new Set(leftWalls.map(t=>t.join(',')));rightWallSet=new Set([...rightWalls,...backWall].map(t=>t.join(',')));
  posterWalls=leftWalls.filter(t=>t[1]<layout.danceStart);awayPoster=null;
  if(leftWalls.length){
    awayPoster=sprite(createAwayPoster(),0,0,91);
    positionAwayPoster();positionDeckSign();
    awayPoster.visible=!grantOnline;
  }

  if(options.window&&rightWalls.length>=3){
    const row=rightWalls.filter(t=>t[1]===Math.min(...rightWalls.map(t=>t[1]))).sort((a,b)=>a[0]-b[0]);
    const p=iso(...row[Math.max(0,Math.floor(row.length/2)-1)]);
    const c=document.createElement('canvas');c.width=64;c.height=97;const ctx=c.getContext('2d');
    ctx.drawImage(prepareImage(roomAssets.window,{matte:true}),0,0);ctx.drawImage(prepareImage(roomAssets.windowRight,{matte:true}),34,12);sprite(c,p.x,p.y-96,90);
  }
  drawTarget=scene;path=[];hover.visible=false;targetMarker.visible=false;
  if(!valid(Math.floor(position.x),Math.floor(position.z))){const [x,z]=roomShape.tiles.reduce((best,t)=>Math.hypot(t[0]+.5-position.x,t[1]+.5-position.z)<Math.hypot(best[0]+.5-position.x,best[1]+.5-position.z)?t:best);position.x=x+.5;position.z=z+.5;}
  placePong();placeWhiteboard();
  container.dataset.shape=options.shape;container.dataset.danceStart=String(layout.danceStart);furniture?.roomChanged();stickies?.redraw();resize();
}

let avatarAtlas=null,appearance;
// One texture per player: every pose frame packed into a grid and selected by UV offset,
// instead of a separate GPU texture per frame.
function makeAtlas(frames){
  const keys=[...frames.keys()],cols=12,rows=Math.ceil(keys.length/cols);
  const canvas=document.createElement('canvas');canvas.width=cols*96;canvas.height=rows*112;
  const ctx=canvas.getContext('2d'),cells=new Map();
  keys.forEach((key,i)=>{const col=i%cols,row=Math.floor(i/cols);ctx.drawImage(frames.get(key),col*96,row*112);cells.set(key,{u:col/cols,v:1-(row+1)/rows});});
  const texture=textureFor(canvas);texture.repeat.set(1/cols,1/rows);
  return {texture,cells,frames,dispose(){texture.dispose();}};
}
function showFrame(mesh,atlas,key){
  if(!atlas)return;
  if(mesh.material.map!==atlas.texture){mesh.material.map=atlas.texture;mesh.material.needsUpdate=true;}
  const cell=atlas.cells.get(key);if(cell)atlas.texture.offset.set(cell.u,cell.v);
}
// A drink from the fridge is carried for ten minutes; its frames are rendered on first use.
const DRINK_MS=10*60*1000,hasDrink=(player,now)=>!!player?.drink&&now-player.drink<DRINK_MS;
let avatarCarryFrames=null,avatarCarryLoading=null;
function ensureCarryFrames(){
  if(avatarCarryFrames||avatarCarryLoading||!selfPlayer)return;
  avatarCarryLoading=appearance.frames(selfPlayer.look,true).then(frames=>{avatarCarryFrames=makeAtlas(frames);}).catch(()=>{avatarCarryLoading=null;});
}
function setAppearance(frames) {
  toolbar?.setAvatar(frames.get('2:-1'));
  const previous=avatarAtlas;
  avatarAtlas=makeAtlas(frames);
  avatarCarryFrames?.dispose();avatarCarryFrames=null;avatarCarryLoading=null;
  lastFrame='';
  if(avatar)showFrame(avatar,avatarAtlas,`${direction}:-1`);
  previous?.dispose();
}
function overCharacter(event) {
  if(!ready)return false;
  const r=container.getBoundingClientRect(),p=characterPoint(position.x,position.z);
  const x=(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale;
  const y=(event.clientY-r.top-r.height/2-viewOffsetY)/displayScale+CENTER_Y;
  return x>=p.x-18&&x<=p.x+18&&y>=p.y-68&&y<=p.y+4;
}

// A seat by id: a furniture seat, or 'pit' for the sunken sofa's ring tile the player stands on.
// A picture for an agent (src/snapshot.js): the whole room, or one block of tiles with the wall
// behind it, at two pixels per room pixel (less for a very wide room), as a PNG.
function takePicture(region){
  const r=region??{x:0,z:0,width:layout.extentWidth,depth:layout.depth};
  const top=iso(r.x,r.z),right=iso(r.x+r.width,r.z),left=iso(r.x,r.z+r.depth),bottom=iso(r.x+r.width,r.z+r.depth),margin=12;
  const bounds={left:left.x-margin,right:right.x+margin,top:CENTER_Y-top.y+124,bottom:CENTER_Y-bottom.y-28-margin};
  const scale=Math.max(1,Math.min(2,1600/(bounds.right-bounds.left)));
  return new Promise((resolve,reject)=>renderPicture(renderer,scene,bounds,scale).toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode the picture.')),'image/png'));
}
function seatInfo(id,point){
  if(id!=='pit')return furniture?.seat(id,point)??null;
  const x=Math.floor(point.x),z=Math.floor(point.z),spot=layout&&pitSeat(layout,x,z);
  if(!spot)return null;
  // Chairs use 16 for a seat about ten pixels high and the throne 4 for a tall one; the
  // sofa cushion is lower, so the figure sits deeper, and it is nudged off the backrest
  // towards the rug in the middle (a fifth of a tile along the direction it faces).
  const nudge={0:[6,-3],2:[6,3],4:[-6,3],6:[-6,3]}[spot.direction];
  return {id,cells:[[x,z]],direction:spot.direction,offsetX:nudge[0],offsetY:26+nudge[1]};
}
function peerAt(event){
  if(!ready)return null;
  const point=screenPoint(event);
  return [...peers.values()].sort((a,b)=>b.mesh.renderOrder-a.mesh.renderOrder).find(peer=>{
    if(!peer.mesh.visible)return false;
    const sample=samplePlayer(peer.data,network.now()),p=characterPoint(sample.x,sample.z);
    const seat=!sample.moving&&peer.data.seatId?seatInfo(peer.data.seatId,sample):null;p.x+=seat?.offsetX??0;p.y+=seat?.offsetY??0;
    // A generous box: wider than the figure for hats, hair and arms, and tall enough to take
    // hits on headwear or just below the feet.
    return point.x>=p.x-26&&point.x<=p.x+26&&point.y>=p.y-90&&point.y<=p.y+10;
  });
}
function selectPeer(peer){furniture.close();infoStand.select(peer.data);container.focus({preventScroll:true});}

const position={x:3.5,z:4.5};
let path=[],direction=2,walkTime=0,avatar,lastFrame='',hoverCell=null,target=null,down=null,ready=false,seated=null,seatTarget=null;
const hoverCanvas=document.createElement('canvas');hoverCanvas.width=64;hoverCanvas.height=32;
const hoverCtx=hoverCanvas.getContext('2d');
// Draw native pixels rather than an antialiased diagonal canvas stroke.
for(let y=1;y<30;y++){
  const left=2+Math.floor(Math.abs(y-15)*2),right=63-left;
  if(left>right)continue;
  hoverCtx.fillStyle='#ffffff0a';hoverCtx.fillRect(left,y,right-left+1,1);
  hoverCtx.fillStyle='#20232b';hoverCtx.fillRect(left,y+1,2,1);hoverCtx.fillRect(right-1,y+1,2,1);
  hoverCtx.fillStyle='#fff4bd';hoverCtx.fillRect(left,y,2,1);hoverCtx.fillRect(right-1,y,2,1);
}
const hover=sprite(hoverCanvas,0,0,200);hover.visible=false;
const targetCanvas=document.createElement('canvas');targetCanvas.width=16;targetCanvas.height=10;
const tctx=targetCanvas.getContext('2d');tctx.strokeStyle='#fffbd8';tctx.lineWidth=1;tctx.beginPath();tctx.moveTo(8,1);tctx.lineTo(15,5);tctx.lineTo(8,9);tctx.lineTo(1,5);tctx.closePath();tctx.stroke();
const targetMarker=sprite(targetCanvas,0,0,201);targetMarker.visible=false;
function place(mesh,left,top,width,height){mesh.position.set(left+width/2,CENTER_Y-top-height/2,0);}
function screenCell(event){
  const r=container.getBoundingClientRect();
  const sx=(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale;
  const sy=(event.clientY-r.top-r.height/2-viewOffsetY)/displayScale+CENTER_Y;
  return layout?tileAtPoint(layout,sx,sy,roomCenterX):null;
}
// The space whose stretch of back wall is under a room point, if any: the wall face of tile (x,0)
// is the parallelogram 32 wide and 117 tall whose top edge drops 16 px across it.
function spaceWallAt(point){
  for(const space of layout?.spaces??[])for(let x=space.x;x<space.x+space.width;x++){
    const p=iso(x,0),u=(point.x-p.x)/32,height=p.y+u*16-point.y;
    if(u>=0&&u<1&&height>=0&&height<=117)return space;
  }
  return null;
}
function screenPoint(event){
  const r=container.getBoundingClientRect();
  return {x:(event.clientX-r.left-r.width/2-viewOffsetX)/displayScale,y:(event.clientY-r.top-r.height/2-viewOffsetY)/displayScale+CENTER_Y};
}
function ensureFreeTile(){
  if(seated){
    const seat=seatInfo(seated.id,position);
    if(seat?.cells.some(([x,z])=>x===Math.floor(position.x)&&z===Math.floor(position.z))){seated=seat;direction=seat.direction;return;}
    seated=null;
  }
  if(canWalk(Math.floor(position.x),Math.floor(position.z)))return;
  const free=roomShape.tiles.filter(([x,z])=>canWalk(x,z)).sort((a,b)=>Math.hypot(a[0]+.5-position.x,a[1]+.5-position.z)-Math.hypot(b[0]+.5-position.x,b[1]+.5-position.z));
  if(free.length){position.x=free[0][0]+.5;position.z=free[0][1]+.5;}
}
async function walkTo(cell,seatId=null,facing=null){
  if(!ready||!cell||(!seatId&&!canWalk(cell.x,cell.z)))return false;
  try{
    await network.move(cell.x,cell.z,seatId,facing);
    if(pong?.joined&&!inPongZone(cell.x,cell.z))pong.toggle().catch(()=>{});
    target=cell;const p=characterPoint(cell.x+.5,cell.z+.5);place(targetMarker,p.x-8,p.y-5,16,10);
    return true;
  }catch(error){toolbar?.status(error.message);return false;}
}
// Walk to the DJ spot beside the decks, or just turn to face them when already there.
let useRequest=0;
async function useItem(id){
  // Avoid tiles other players stand on or are walking to; the server would refuse them.
  const taken=new Set([...peers.values()].flatMap(peer=>{const now=network.now(),at=samplePlayer(peer.data,now),end=peer.data.route.at(-1);return [`${Math.floor(at.x)},${Math.floor(at.z)}`,`${Math.floor(end.x)},${Math.floor(end.z)}`];}));
  const request=++useRequest,spot=furniture?.approach(id,position,(x,z)=>canWalk(x,z)&&!taken.has(`${x},${z}`));
  if(!spot||!await walkTo({x:spot.x,z:spot.z},null,spot.direction))return;
  const type=furniture.typeOf(id);
  if(!['fridge','dmg_fridge','custom_logbook'].includes(type))return;
  if(!await arrivedAt(spot)||request!==useRequest)return;
  if(type==='custom_logbook'){furniture.close();logbook?.open();return;}
  try{await network.takeDrink(id);}catch(error){toolbar?.status(error.message);}
}
// Resolve once the player stands on the tile; false if the walk is abandoned or times out.
function arrivedAt(spot){
  const deadline=Date.now()+15000;
  return new Promise(resolve=>{const check=()=>{
    if(!ready||!selfPlayer||Date.now()>deadline)return resolve(false);
    const end=selfPlayer.route.at(-1);if(Math.floor(end.x)!==spot.x||Math.floor(end.z)!==spot.z)return resolve(false);
    const sample=samplePlayer(selfPlayer,network.now());
    if(!sample.moving)return resolve(true);setTimeout(check,100);
  };check();});
}
async function sitOn(seat){
  if(!seat)return;
  const cells=[...seat.cells].sort((a,b)=>Math.hypot(a[0]+.5-position.x,a[1]+.5-position.z)-Math.hypot(b[0]+.5-position.x,b[1]+.5-position.z));
  for(const [x,z] of cells)if(await walkTo({x,z},seat.id)){
    if(furniture.typeOf(seat.id)==='custom_bar'&&await arrivedAt({x,z})){
      try{await network.takeDrink(seat.id);}catch(error){toolbar?.status(error.message);}
    }
    break;
  }
}
// Pointer moves are coalesced to one hover pass per animation frame.
let hoverEvent=null;
container.addEventListener('pointermove',event=>{hoverEvent=event;});
function updateHover(){
  const event=hoverEvent;if(!event)return;hoverEvent=null;
  const point=screenPoint(event),cell=screenCell(event);
  const onPong=pongAt(point);pong?.pointer(onPong&&pong.playing?onPong.v:null);
  if(onPong||whiteboardAt(point)){hover.visible=false;container.style.cursor='pointer';return;}
  if(stickies?.pointer(point)){hover.visible=false;container.style.cursor='pointer';return;}
  if(peerAt(event)){hover.visible=false;container.style.cursor='pointer';return;}
  if(furniture?.pointer(point,cell)){hover.visible=false;container.style.cursor='pointer';return;}
  hoverCell=cell;container.style.cursor=hoverCell||overCharacter(event)?'pointer':'default';hover.visible=ready&&!!hoverCell;
  if(hoverCell){const p=groundPoint(hoverCell.x,hoverCell.z);place(hover,p.x-32,p.y,64,32);}
}
container.addEventListener('pointerleave',()=>{hover.visible=false;down=null;});
container.addEventListener('pointerdown',event=>{if(event.button===0)down={x:event.clientX,y:event.clientY};});
container.addEventListener('pointercancel',()=>{down=null;});
container.addEventListener('pointerup',event=>{
  if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<8){
    danceControls?.close();const peer=peerAt(event),cell=screenCell(event),wallSpace=spaceWallAt(screenPoint(event));
    if(ready&&pongAt(screenPoint(event))){usePong();}
    else if(ready&&whiteboardAt(screenPoint(event))){furniture?.close();whiteboard.open();}
    else if(stickies?.pointer(screenPoint(event),true)){}
    else if(peer)selectPeer(peer);
    else if(furniture?.pointer(screenPoint(event),cell,true))container.focus({preventScroll:true});
    // A space's back wall names the space and who added it, like a built piece.
    else if(wallSpace){furniture?.close();infoStand?.inspect({name:wallSpace.name,by:wallSpace.ownerName,icon:null});container.focus({preventScroll:true});}
    else if(overCharacter(event))appearance.open();
    else{
      infoStand?.hide();walkTo(cell);
      if(ready&&cell?.z>=layout.danceStart)danceControls?.open();
      container.focus({preventScroll:true});
    }
  }
  down=null;
});
container.addEventListener('keyup',event=>{if(['ArrowUp','ArrowDown','w','s','W','S'].includes(event.key))pong?.keys(0);});
container.addEventListener('keydown',event=>{
  if(event.key==='Escape')danceControls?.close();
  if(stickies?.key(event)){event.preventDefault();return;}
  if(furniture?.key(event)){event.preventDefault();return;}
  if(pong?.playing&&['ArrowUp','ArrowDown','w','s','W','S'].includes(event.key)){event.preventDefault();pong.keys(['ArrowUp','w','W'].includes(event.key)?-1:1);return;}
  const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
  if(!delta)return;event.preventDefault();
  const from=path.length&&target?target:{x:Math.floor(position.x),z:Math.floor(position.z)};
  const cell={x:from.x+delta[0],z:from.z+delta[1]};if(valid(cell.x,cell.z))walkTo(cell);
});
// Each wheel notch moves one whole pixel step, so every notch visibly changes the zoom.
// A full mouse notch, or an equivalent trackpad run, is one step, and steps are at least
// a quarter second apart so a flick settles one level away rather than several.
let wheelAccumulator=0,lastFit=1,lastZoomStep=0;
container.addEventListener('wheel',event=>{
  event.preventDefault();
  if(Math.sign(event.deltaY)!==Math.sign(wheelAccumulator))wheelAccumulator=0;
  wheelAccumulator+=event.deltaY;
  if(Math.abs(wheelAccumulator)<90)return;
  const direction=wheelAccumulator<0?1:-1;wheelAccumulator=0;
  if(performance.now()-lastZoomStep<250)return;
  lastZoomStep=performance.now();
  // Limits are whole pixel steps, not multiples of the fit, so zooming out always has
  // somewhere to go and a window resize cannot strand the view outside its own range.
  const pixelRatio=Math.min(window.devicePixelRatio,3),scale=lastFit*pixelRatio;
  const current=Math.round(displayScale*pixelRatio),most=Math.max(2,Math.round(3*pixelRatio));
  const next=Math.max(1,Math.min(most,current+direction));
  if(next===current)return;
  zoom=next/scale;resize();
},{passive:false});
function resize(){
  const w=container.clientWidth,h=container.clientHeight;
  const reserved=editingRoom&&w>1000?550:0;
  const mobile=matchMedia('(pointer: coarse)').matches||w<=640;
  const boundsWidth=layout?.extentWidth??roomWidth;
  // Phones start at native pixel size and pan around the room rather than shrinking it to fit.
  const fit=Math.max(mobile?1:0,Math.min(1.5,(w-reserved)/((boundsWidth+roomDepth)*32+(mobile?80:90)),h/((boundsWidth+roomDepth)*16+(mobile?130:160))));
  const pixelRatio=Math.min(window.devicePixelRatio,3);lastFit=fit;
  renderer.setPixelRatio(pixelRatio);
  // Every zoom level is a whole number of device pixels per room pixel, so nearest-neighbour
  // sampling stays crisp instead of smearing at fractional scales. The default fit rounds
  // down so the whole room still fits on screen.
  const physicalScale=fit*zoom*pixelRatio;
  // Only the untouched default view rounds down; any chosen zoom rounds to its nearest step.
  const steps=zoom===1?Math.floor(physicalScale+1e-6):Math.round(physicalScale);
  displayScale=Math.max(1,steps)/pixelRatio;
  panX=Math.max(-((boundsWidth+roomDepth)*32*displayScale+w)/2+60,Math.min(((boundsWidth+roomDepth)*32*displayScale+w)/2-60,panX));
  panY=Math.max(-((boundsWidth+roomDepth)*16*displayScale+h)/2+60,Math.min(((boundsWidth+roomDepth)*16*displayScale+h)/2-60,panY));
  viewOffsetX=Math.round((w/2+panX-reserved/2)*pixelRatio)/pixelRatio-w/2;
  viewOffsetY=Math.round((h/2+panY-CENTER_Y*displayScale)*pixelRatio)/pixelRatio-h/2+CENTER_Y*displayScale;
  camera.left=(-w/2-viewOffsetX)/displayScale;camera.right=(w/2-viewOffsetX)/displayScale;
  camera.top=(h/2+viewOffsetY)/displayScale;camera.bottom=(-h/2+viewOffsetY)/displayScale;camera.updateProjectionMatrix();
  renderer.setSize(w,h);
  const rect=container.getBoundingClientRect();view.halfW=w/2;view.halfH=h/2;view.top=rect.top;view.left=rect.left;
}
function updateViewport(){
  const viewport=window.visualViewport;
  if(viewport&&Math.abs(viewport.scale-1)<.01){
    document.documentElement.style.setProperty('--viewport-height',`${viewport.height}px`);
    document.documentElement.style.setProperty('--viewport-top',`${viewport.offsetTop}px`);
  }
}
window.visualViewport?.addEventListener('resize',updateViewport);
window.visualViewport?.addEventListener('scroll',updateViewport);
updateViewport();new ResizeObserver(resize).observe(container);resize();
installTouchNavigation(container,{
  getView:()=>({zoom,panX,panY}),
  setView:view=>{zoom=view.zoom;panX=view.panX;panY=view.panY;resize();},
  cancelTap:()=>{down=null;hover.visible=false;}
});
const chat=createChat({getSpeaker:()=>{
  const p=characterPoint(position.x,position.z);
  return {name:network?.me?.name??'You',color:appearance?.chatColor()??'#6b8c64',x:p.x,y:p.y};
},getLayout:()=>{
  // Bubbles are anchored to room coordinates (a speaker's head) and follow pan and zoom;
  // interface text keeps its native pixel size.
  return {originX:view.left+view.halfW+viewOffsetX,originY:view.top+view.halfH+viewOffsetY,scale:displayScale,centerY:CENTER_Y};
},onSelectSpeaker:speaker=>{const peer=[...peers.values()].find(p=>p.data.name===speaker.name);if(peer)selectPeer(peer);else if(speaker.name===network?.me?.name)appearance?.open();}});
let localTyping=false;
function positionTyping(player,point,visible){
  const active=player.id===network.me?.id?localTyping:(player.typingUntil??0)>network.now();
  chat.typing(player.id,player.name,visible&&active,view.left+view.halfW+viewOffsetX+point.x*displayScale,view.top+view.halfH+viewOffsetY+(point.y-CENTER_Y-100)*displayScale);
}
function disposePeer(peer){
  chat.removeTyping(peer.data.id);
  peer.version++;scene.remove(peer.mesh);peer.mesh.geometry.dispose();peer.mesh.material.dispose();peer.atlas?.dispose();peer.carryTextures?.dispose();peer.label.remove();
}
function updatePeers(players){
  voice?.syncPlayers(players);
  grantOnline=players.some(player=>player.role==='admin');
  if(awayPoster)awayPoster.visible=!grantOnline;
  container.dataset.grantOnline=String(grantOnline);
  const present=new Set(players.filter(p=>p.id!==network.me?.id).map(p=>p.id));
  for(const [id,peer] of peers)if(!present.has(id)){disposePeer(peer);peers.delete(id);}
  for(const data of players){
    if(data.id===network.me?.id)continue;
    let peer=peers.get(data.id);
    if(!peer){
      const blank=document.createElement('canvas');blank.width=96;blank.height=112;
      const mesh=sprite(blank,0,0,300);mesh.visible=false;mesh.material.map.dispose();mesh.material.map=null;
      const label=document.createElement('button');label.type='button';label.className='player-target';label.setAttribute('aria-label',`Select ${data.name}`);label.onclick=()=>selectPeer(peer);container.append(label);
      peer={mesh,label,atlas:null,carryTextures:null,carryLoading:null,version:0,lookKey:''};peers.set(data.id,peer);
    }
    peer.data=data;
    const key=JSON.stringify(data.look);
    if(peer.lookKey!==key){
      peer.lookKey=key;const version=++peer.version;
      appearance.frames(data.look).then(frames=>{
        if(version!==peer.version)return;
        peer.atlas?.dispose();peer.atlas=makeAtlas(frames);peer.frameKey='';peer.mesh.visible=true;
        peer.carryTextures?.dispose();peer.carryTextures=null;peer.carryLoading=null;
      }).catch(error=>{peer.lookKey='';toolbar?.status(error.message);});
    }
  }
}
function positionCharacter(mesh,point,seat){
  const inWater=isPoolWater(layout,point.x,point.z);
  if(inWater){
    const plane=mesh.userData.waterClip??=new THREE.Plane(new THREE.Vector3(0,1,0));
    plane.constant=iso(point.x,point.z).y+7-CENTER_Y;
    if(!mesh.material.clippingPlanes){mesh.material.clippingPlanes=[plane];mesh.material.needsUpdate=true;}
  }else if(mesh.material.clippingPlanes){mesh.material.clippingPlanes=null;mesh.material.needsUpdate=true;}
  const p=characterPoint(point.x,point.z);p.x+=seat?.offsetX??0;p.y+=seat?.offsetY??0;
  place(mesh,Math.round(p.x)-48,Math.round(p.y)-101,96,112);
  mesh.renderOrder=300+(point.x+point.z-1)*10+9.5;
  return p;
}
function characterFrame(player,point,time,seat){
  if(point.moving)return `${point.direction}:${Math.floor(time/1000*9)%4}`;
  const age=time-(player.actionStarted??0);
  if(player.action==='wave'&&age<3000)return `${point.direction}:${seat?'sit-wave':'wave'}:${Math.floor(age/180)%2}`;
  if(player.action==='dance')return `${point.direction}:dance:${Math.floor(age/180)%8}`;
  if(player.action==='breakdance')return `${point.direction}:breakdance:${Math.floor(age/130)%16}`;
  return `${point.direction}:${seat?'sit':-1}`;
}
function animate(now){
  updateHover();
  furniture?.animate(network?.now()??Date.now(),reducedMotion.matches,radio?.audible??false);
  if(ready&&selfPlayer){
    const time=network.now(),sample=samplePlayer(selfPlayer,time);
    Object.assign(position,{x:sample.x,z:sample.z});direction=sample.direction;
    seated=!sample.moving&&selfPlayer.seatId?seatInfo(selfPlayer.seatId,sample):null;
    const carrying=hasDrink(selfPlayer,time);if(carrying)ensureCarryFrames();
    const pose=characterFrame(selfPlayer,sample,time,seated),key=`${carrying&&avatarCarryFrames?'drink:':''}${pose}`;
    if(lastFrame!==key){showFrame(avatar,(carrying&&avatarCarryFrames)||avatarAtlas,pose);lastFrame=key;}
    const avatarPoint=positionCharacter(avatar,position,seated);
    positionTyping(selfPlayer,avatarPoint,avatar.visible);
    const voicePoint=characterPoint(position.x,position.z);
    voice?.positionSpeaker(selfPlayer.id,view.halfW+viewOffsetX+(voicePoint.x+(seated?.offsetX??0))*displayScale,view.top+view.halfH+viewOffsetY+(voicePoint.y+(seated?.offsetY??0)-CENTER_Y-78)*displayScale,avatar.visible);
    if(infoStand?.selected){const selected=peers.get(infoStand.selected);infoStand.update(selected?.data,selected?.atlas?.frames.get('2:-1'));}
    chat.update(now);targetMarker.visible=sample.moving&&!editingRoom;
    container.dataset.cell=`${Math.floor(position.x)},${Math.floor(position.z)}`;
    container.dataset.moving=String(sample.moving);container.dataset.pose=pose.split(':')[1];
    toolbar?.setDancing(selfPlayer.action);
    container.dataset.players=String(peers.size+1);container.dataset.player=network.me.name;
  }
  if(network&&furniture){const time=network.now();
    for(const peer of peers.values()){
      const point=samplePlayer(peer.data,time),seat=!point.moving&&peer.data.seatId?seatInfo(peer.data.seatId,point):null;
      const pose=characterFrame(peer.data,point,time,seat),carrying=hasDrink(peer.data,time);
      if(carrying&&!peer.carryTextures&&!peer.carryLoading){const version=peer.version;peer.carryLoading=appearance.frames(peer.data.look,true).then(frames=>{if(version===peer.version)peer.carryTextures=makeAtlas(frames);}).catch(()=>{peer.carryLoading=null;});}
      // Only touch the material and the label's styles when something actually changed.
      const key=`${carrying&&peer.carryTextures?'drink:':''}${pose}`;
      if(peer.frameKey!==key){peer.frameKey=key;showFrame(peer.mesh,(carrying&&peer.carryTextures)||peer.atlas,pose);}
      const p=positionCharacter(peer.mesh,point,seat);
      positionTyping(peer.data,p,peer.mesh.visible);
      const left=Math.round(view.halfW+viewOffsetX+(p.x-18)*displayScale),top=Math.round(view.halfH+viewOffsetY+(p.y-CENTER_Y-68)*displayScale);
      if(peer.labelLeft!==left||peer.labelTop!==top||peer.labelScale!==displayScale||peer.labelShown!==peer.mesh.visible){
        peer.labelLeft=left;peer.labelTop=top;peer.labelScale=displayScale;peer.labelShown=peer.mesh.visible;
        peer.label.style.left=`${left}px`;peer.label.style.top=`${top}px`;peer.label.style.width=`${36*displayScale}px`;peer.label.style.height=`${72*displayScale}px`;peer.label.hidden=!peer.mesh.visible;
      }
      voice?.positionSpeaker(peer.data.id,view.halfW+viewOffsetX+p.x*displayScale,view.top+view.halfH+viewOffsetY+(p.y-CENTER_Y-78)*displayScale,peer.mesh.visible);
    }
  }
  if(pong&&pongMesh&&pong.update(network?.now()??Date.now()))pongMesh.material.map.needsUpdate=true;
  if(whiteboard&&whiteboardMesh&&whiteboard.update())whiteboardMesh.material.map.needsUpdate=true;
  if(blimp&&blimpMesh&&layout){
    // The blimp crosses behind the room, high above the walls.
    if(blimp.draw(now,reducedMotion.matches))blimpMesh.material.map.needsUpdate=true;
    const span=(layout.extentWidth+roomDepth)*32,spot=reducedMotion.matches?{x:span/4,y:-340+span/8}:blimp.position(network?.now()??Date.now(),span);
    blimpMesh.visible=!!spot;
    if(spot)place(blimpMesh,Math.round(spot.x-roomCenterX),Math.round(spot.y),blimp.width,blimp.height);
  }
  if(danceFloor&&danceMesh&&danceFloor.draw(reducedMotion.matches?0:Math.floor((network?.now()??Date.now())/900)%6,danceFloorOn))danceMesh.material.map.needsUpdate=true;
  if(pool&&poolMesh&&pool.draw(reducedMotion.matches?0:Math.floor(now/220)%6))poolMesh.material.map.needsUpdate=true;
  if(discoBall&&discoMesh&&layout){
    if(discoBall.draw(now,danceFloorOn,reducedMotion.matches))discoMesh.material.map.needsUpdate=true;
    if(discoLights&&discoLightsMesh&&discoLights.draw(now,discoBall.progress,reducedMotion.matches))discoLightsMesh.material.map.needsUpdate=true;
    const p=groundPoint(layout.width/2,layout.danceStart+DANCE_ROWS/2);
    place(discoMesh,p.x-discoBall.width/2,p.y-16,discoBall.width,discoBall.height);
  }
  renderer.render(scene,camera);requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
try{
  toolbar=createToolbar({admin:false,onTyping:typing=>{if(ready){localTyping=typing;void network.typing(typing).catch(()=>{});}},onAppearance:()=>{if(ready)appearance.open();},onVoice:()=>{if(ready)voice.open();},onRoomEdit:()=>{if(ready&&network.me?.role==='admin')roomEditor.open();},onFurniture:()=>{if(ready)furniture.open();},onChat:(body,mode)=>{if(ready)return network.chat(body,mode);},onGesture:action=>{if(ready)network.gesture(action).catch(error=>toolbar.status(error.message));}});
  network=createMultiplayer();
  danceControls=createDanceFloorControls({onChange:on=>network.danceFloor(on),onError:message=>toolbar.status(message)});
  voice=createVoice({credentials:tab=>network.voiceCredentials(tab),onState:state=>toolbar.setVoiceState(state),onSpeaking:speaking=>radio?.duck(speaking)});
  radio=createRoomRadio();
  for(const event of ['pointerdown','keydown'])document.addEventListener(event,()=>{if(ready)void radio.unlock();});
  window.addEventListener('pagehide',()=>radio.close());
  const [catalogResponse,paletteResponse,initialRoom]=await Promise.all([fetch('/assets/room-options/catalog.json'),fetch('/assets/room-options/source-palette.json'),network.loadPreview()]);
  grantOnline=initialRoom.players.some(player=>player.role==='admin');
  receiveDanceFloor(initialRoom.room.danceFloorOn);
  initialFurniture=initialRoom.room.furniture;
  if(!catalogResponse.ok||!paletteResponse.ok)throw new Error('Room choices could not be loaded.');
  roomCatalog=await catalogResponse.json();roomCatalog.sourcePalette=await paletteResponse.json();
  const files=['left_wallpart_0_a_0_0_0.png','right_wallpart_0_a_0_2_0.png','left_wallpart_1_a_0_0_0.png','right_wallpart_1_a_0_2_0.png','flat_floor_0_a_0_0_0.png','flat_floor_1_a_0_0_0.png','flat_floor_2_a_0_0_0.png'];
  await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{roomAssets[file]=image;resolve();};image.onerror=reject;image.src='/assets/room-options/'+file;})));
  [roomAssets.door,roomAssets.window,roomAssets.windowRight]=await Promise.all(['door.png','window.png','window-right.png'].map(loadImage));
  roomAssets.pool=await loadPoolAssets();
  roomAssets.sofa=await loadSunkenSofa();
  const stopWalking=()=>{path=[];seatTarget=null;if(seated){seated=null;ensureFreeTile();}hover.visible=false;targetMarker.visible=false;};
  roomEditor=createRoomEditor({catalog:roomCatalog,initial:initialRoom.room.options,onSave:options=>network.options(options),onPreview:buildRoom,onOpen:()=>{
    stopWalking();furniture?.close();positionBeforeEdit={...position};editingRoom=true;resize();
  },onClose:committed=>{
    if(!committed)Object.assign(position,positionBeforeEdit);
    furniture?.roomChanged(committed);ensureFreeTile();
    editingRoom=false;resize();container.focus({preventScroll:true});
  }});
  roomSpaces=initialRoom.room.spaces??[];await loadSpacePictures(roomSpaces);buildRoom(roomEditor.initial);
  // Restore the camera from an update snapshot before anything is drawn, so nothing jumps.
  const earlyView=peekUpdateSession()?.view;
  if(earlyView&&[earlyView.zoom,earlyView.panX,earlyView.panY].every(Number.isFinite)){zoom=earlyView.zoom;panX=earlyView.panX;panY=earlyView.panY;viewRestored=true;resize();}
  deckSignImages=await loadDeckSign();positionDeckSign();
  blimp=createBlimp({texts:['SUPERHANDS']});blimpMesh=sprite(blimp.canvas,0,0,1);blimpMesh.visible=false;
  pong=createPong({now:()=>network?.now()??Date.now(),me:()=>network?.me?.id??null,send:{join:()=>network.pong.join(),leave:()=>network.pong.leave(),paddle:(side,y)=>network.pong.paddle(side,y),hit:(side,y,serial)=>network.pong.hit(side,y,serial),miss:(side,serial)=>network.pong.miss(side,serial)}});
  whiteboard=createWhiteboard({send:{draw:stroke=>network.whiteboard.draw(stroke),clear:()=>network.whiteboard.clear()},onError:message=>toolbar.status(message)});
  logbook=createLogbook({fetchPage:before=>network.visits.page(before),watch:(onPage,onError)=>network.visits.watch(onPage,onError),onError:message=>toolbar.status(message)});
  whiteboardMesh=sprite(whiteboard.canvas,0,0,96);whiteboardMesh.scale.setScalar(1/2);whiteboardMesh.material.map.minFilter=THREE.LinearFilter;whiteboardMesh.material.map.magFilter=THREE.LinearFilter;
  {const positions=whiteboardMesh.geometry.attributes.position;for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)-positions.getX(i)/2);positions.needsUpdate=true;whiteboardMesh.geometry.computeBoundingSphere();}
  placeWhiteboard();
  pongMesh=sprite(pong.canvas,0,0,95);pongMesh.scale.setScalar(1/2);pongMesh.material.map.minFilter=THREE.LinearFilter;pongMesh.material.map.magFilter=THREE.LinearFilter;
  {const positions=pongMesh.geometry.attributes.position;for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)-positions.getX(i)/2);positions.needsUpdate=true;pongMesh.geometry.computeBoundingSphere();}
  placePong();
  discoBall=await createDiscoBall();discoMesh=sprite(discoBall.canvas,0,0,900);
  discoMesh.scale.setScalar(1/3);discoMesh.material.map.minFilter=THREE.LinearFilter;
  infoStand=await createInfoStand(prepareImage);
  appearance=await createAppearance({prepareImage,onApply:async(frames,look,context)=>{if(!context.entry)await network.appearance(look);setAppearance(frames);},onOpen:()=>{stopWalking();furniture?.close();}});
  setAppearance(appearance.initial);
  stickies=await createStickies({network,prepareImage,worldPoint:groundPoint,getTiles:()=>new Set([...layout.mainTiles,...layout.danceTiles].map(cell=>cell.join(','))),
    makeVisual:canvas=>sprite(canvas,0,0,95),
    disposeVisual:mesh=>{scene.remove(mesh);mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();},
    positionVisual:(mesh,x,y,w,h,order)=>{place(mesh,x,y,w,h);mesh.renderOrder=order;},
    focusRoom:()=>container.focus({preventScroll:true}),onPlace:()=>{stopWalking();furniture?.close();}
  });
  stickies.receive(initialRoom.room.stickies??[]);
  const furnitureMarks=new THREE.Group();scene.add(furnitureMarks);
  const agentLink=createAgentLink({network,focusRoom:()=>container.focus({preventScroll:true})});
  const initialAssets=await network.assets.list().catch(()=>[]);
  furniture=await createFurniture({initialItems:initialRoom.room.furniture,initialAssets,onAttachAgent:()=>agentLink.open(),
    prepareImage,worldPoint:iso,isTile:(x,z)=>valid(x,z)&&!isPoolWater(layout,x,z)&&!onWalkway(layout,x,z),floorHeight,getAvatar:()=>position,stopWalking,onChanged:()=>{ensureFreeTile();positionAwayPoster();positionDeckSign();},onSit:sitOn,onUse:useItem,
    // Clicking a player-built piece names it and its builder on the info stand; stock pieces clear it.
    onInspect:(item,def)=>{if(def?.ownerName)infoStand.inspect({name:def.name,by:def.ownerName,icon:def.icon});else infoStand.hide();},
    // Builders may only drop pieces in a space they own (the server enforces the same).
    canBuildAt:(x,z)=>layout.spaces.some(s=>s.owner===network?.me?.id&&x>=s.x&&x<s.x+s.width&&z>=s.z&&z<s.z+s.depth),
    focusRoom:()=>container.focus({preventScroll:true}),
    hasWall:(x,z,side)=>(side==='left'?leftWallSet:rightWallSet).has(`${x},${z}`),
    walls:()=>[...leftWallSet].map(key=>{const [x,z]=key.split(',').map(Number);return {x,z,side:'left'};}).concat([...rightWallSet].map(key=>{const [x,z]=key.split(',').map(Number);return {x,z,side:'right'};})),
    makeVisual:canvas=>sprite(canvas,0,0,300),
    disposeVisual:mesh=>{scene.remove(mesh);mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();},
    positionVisual:(mesh,x,y,w,h,order)=>{place(mesh,x,y,w,h);mesh.renderOrder=order;},
    markTiles:(cells,color)=>{
      furnitureMarks.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});furnitureMarks.clear();
      drawTarget=furnitureMarks;
      for(const [x,z] of cells){const p=groundPoint(x,z);const mesh=polygon([[p.x,p.y],[p.x+32,p.y+16],[p.x,p.y+32],[p.x-32,p.y+16]],color,25,true);mesh.material.transparent=true;mesh.material.opacity=.4;}
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
        receiveDanceFloor(state.room.danceFloorOn);receiveFridge(state.room.fridge);
        const rk=JSON.stringify([state.room.options,state.room.spaces??[]]),fk=state.room.revision;
        // Furniture lands only after the room it belongs to is built: a resized space moves what hangs on the spaces after it.
        const applyFurniture=()=>{if(fk!==furnitureKey){furnitureKey=fk;furniture.receive(state.room.furniture);positionAwayPoster();positionDeckSign();}};
        if(rk!==roomKey){roomKey=rk;const spaces=state.room.spaces??[],options=state.room.options;loadSpacePictures(spaces).then(()=>{if(roomKey!==rk)return;roomSpaces=spaces;roomEditor.receive(options);applyFurniture();});}
        else applyFurniture();
        receiveStickies(state.room.stickies);
        updatePeers(state.players);resolve();
      },message=>reject(new Error(message)));
    });
    if(network.adminEntry){const saved=await network.entryAppearance();if(saved)setAppearance(await appearance.useLook(saved));}
    liftVeil();
    await appearance.enter({admin:network.adminEntry,onEnter:(name,look,options)=>network.join(name,look,options)});
    stopPreview();
  }
  const admin=network.me.role==='admin';
  const previousUpdate=takeUpdateSession(network.me.id);
  if(previousUpdate){
    radio.restore(previousUpdate.music);
    const view=previousUpdate.view;
    if(view&&[view.zoom,view.panX,view.panY].every(Number.isFinite)){zoom=view.zoom;panX=view.panX;panY=view.panY;resize();}
  }
  viewRestored=viewRestored||!!previousUpdate?.view;
  network.whiteboard.all().then(all=>{whiteboard.load(all);network.whiteboard.watch(all.serial,update=>whiteboard.receive(update));}).catch(error=>toolbar.status(error.message));
  stickies.connect(admin);
  furniture.connect({admin,me:network.me.id,onSave:items=>network.furniture(items),onPower:(id,on)=>network.deckPower(id,on),onError:message=>toolbar.status(message)});
  if(import.meta.env.DEV)window.__room={get centerY(){return CENTER_Y;},iso,get visuals(){return furniture.debugVisuals();},get avatar(){return {order:avatar.renderOrder,x:position.x,z:position.z};},get peers(){return [...peers.values()].map(p=>({name:p.data.name,order:p.mesh.renderOrder,seat:p.data.seatId?.slice(0,6)??null}));}};
  network.assets.watch(list=>furniture.setAssets(list),message=>toolbar.status(message));
  startSnapshots({captures:network.captures,capture:takePicture,onStatus:message=>toolbar.status(message)});
  toolbar.setAdmin(admin);
  let roomKey='',furnitureKey='',ownLook=JSON.stringify(network.me.look),lookVersion=0;
  const seenMessages=new Set();
  await new Promise((resolve,reject)=>{
    let first=true;
    // Room contents (furniture, options, stickies) come on their own subscription so player
    // movement updates no longer carry the whole room.
    const onRoom=room=>{
      receiveDanceFloor(room.danceFloorOn);receiveFridge(room.fridge);
      // The server bumps room.revision on every furniture, power and options change, so that one number stands in for the whole list.
      const nextRoom=JSON.stringify([room.options,room.spaces??[]]),nextFurniture=room.revision;
      // Furniture lands only after the room it belongs to is built: a resized space moves what hangs on the spaces after it.
      const applyFurniture=()=>{if(nextFurniture!==furnitureKey){furnitureKey=nextFurniture;furniture.receive(room.furniture);positionAwayPoster();positionDeckSign();radio.receive(room.furniture,true);}};
      if(nextRoom!==roomKey){roomKey=nextRoom;const spaces=room.spaces??[],options=room.options;loadSpacePictures(spaces).then(()=>{if(roomKey!==nextRoom)return;roomSpaces=spaces;roomEditor.receive(options);applyFurniture();});}
      else applyFurniture();
      receiveStickies(room.stickies);
    };
    network.watch(state=>{
      selfPlayer=state.me;updatePeers(state.players);
      const nextLook=JSON.stringify(state.me.look);
      if(nextLook!==ownLook){ownLook=nextLook;const version=++lookVersion;appearance.useLook(state.me.look).then(frames=>{if(version===lookVersion)setAppearance(frames);}).catch(error=>toolbar.status(error.message));}
      for(const message of state.messages){
        if(seenMessages.has(message.id))continue;seenMessages.add(message.id);
        if(network.now()-message.sentAt>28000)continue;
        const p=characterPoint(message.x,message.z),rect=container.getBoundingClientRect();
        chat.say(message.body,message.mode,{name:message.name,color:message.color,x:p.x,y:p.y});
      }
      // Bound deduplication memory to the server's current message window.
      const recentIds=new Set(state.messages.map(m=>m.id));for(const id of seenMessages)if(!recentIds.has(id))seenMessages.delete(id);
      avatar.visible=true;ready=true;toolbar.setVoiceEnabled(true);toolbar.setAppearanceEnabled(true);centreViewOnAvatar();
      // Two frames later the restored avatar and furniture have been drawn at least once.
      requestAnimationFrame(()=>requestAnimationFrame(liftVeil));
      if(first){first=false;resolve();}
    },message=>{voice.leave();radio.close();toolbar.setVoiceEnabled(false);toolbar.status(message);if(first)reject(new Error(message));},onRoom,state=>pong?.receive(state));
  });
  // Everyone hears the room: connect listen-only unless a pre-reload snapshot says they had left.
  if(previousUpdate?.voice)void voice.restore(previousUpdate.voice);else void voice.listen();
  if(import.meta.env.PROD){
    let lastInput=0;
    document.addEventListener('input',()=>{lastInput=performance.now();});
    const updater=installAutoUpdate({version:__ROOM_BUILD_ID__,
      canReload:()=>!editingRoom&&!furniture.placing&&!voice.busy&&performance.now()-lastInput>2000&&!document.querySelector('dialog[open],.furniture-placement:not([hidden]),.furniture-panel:not([hidden])')&&!document.querySelector('#chat-message')?.value.trim(),
      beforeReload:()=>saveUpdateSession({playerId:network.me.id,voice:voice.snapshot(),music:radio.snapshot(),view:{zoom,panX,panY}}),
      reload:()=>{dropVeil();setTimeout(()=>location.reload(),420);}
    });
    window.addEventListener('pagehide',event=>{if(!event.persisted)updater.stop();});
  }
  container.focus({preventScroll:true});
}catch(error){liftVeil();const notice=document.querySelector('#load-error');notice.textContent=error.message||'The room could not be opened. Please reload to try again.';notice.hidden=false;console.error(error);}
