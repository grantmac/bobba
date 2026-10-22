import {placeSpaces,spaceTiles} from './spaces.js';
export const DANCE_ROWS=10,STEP_DOWN=12;

// Append a lower terrace along the front-left edge without renumbering any
// existing room tiles, furniture positions, or wall attachments.
// Layouts are rebuilt only when the shape or the spaces change: a mutation or a frame asks for
// the same layout many times, and with hundreds of spaces building one is not free.
const layoutCache=new WeakMap();
export function roomLayout(mainTiles,spaces=[]){
  let byShape=layoutCache.get(spaces);
  if(!byShape){byShape=new WeakMap();layoutCache.set(spaces,byShape);}
  const cached=byShape.get(mainTiles);if(cached)return cached;
  const layout=buildLayout(mainTiles,spaces);byShape.set(mainTiles,layout);return layout;
}
function buildLayout(mainTiles,spaces){
  const width=Math.max(...mainTiles.map(([x])=>x))+1;
  const danceStart=Math.max(...mainTiles.map(([,z])=>z))+1;
  const danceTiles=Array.from({length:width*DANCE_ROWS},(_,i)=>[i%width,danceStart+Math.floor(i/width)]);
  const parking={x:width,z:0,width:5,depth:3};
  const parkingTiles=Array.from({length:parking.width*parking.depth},(_,i)=>[width+i%parking.width,Math.floor(i/parking.width)]);
  // A lounge to the right of the pool and deck, with a whiteboard centered on its back wall.
  const lounge={x:width+5,z:0,width:8,depth:8};
  const loungeTiles=Array.from({length:lounge.width*lounge.depth},(_,i)=>[lounge.x+i%lounge.width,Math.floor(i/lounge.width)]);
  // A sunken sofa pit in the middle of the lounge, one step down, with a walkway all round.
  const pit={x:lounge.x+1,z:3,width:6,depth:4};
  const pitTiles=loungeTiles.filter(([x,z])=>x>=pit.x&&x<pit.x+pit.width&&z>=pit.z&&z<pit.z+pit.depth);
  const pool={x:width,z:parking.depth,width:5,depth:5},poolDeckTiles=[],waterTiles=[];
  for(let x=0;x<pool.width;x++)for(let z=0;z<pool.depth;z++){
    (x>0&&x<pool.width-1&&z>0&&z<pool.depth-1?waterTiles:poolDeckTiles).push([pool.x+x,pool.z+z]);
  }
  // Player-added spaces chain on past the lounge along the back wall, at floor level.
  const placedSpaces=placeSpaces(spaces,lounge.x+lounge.width).map(space=>({...space,tiles:spaceTiles(space)}));
  const spaceTilesAll=placedSpaces.flatMap(space=>space.tiles);
  const spacesWidth=placedSpaces.reduce((sum,space)=>sum+space.width,0);
  // A walk-only strip along the front of the lounge and every space, so a space full of furniture
  // never cuts off the ones after it. Nothing can be placed on it; it appears with the first space.
  const walkway=placedSpaces.length?{x:lounge.x,z:Math.max(lounge.z+lounge.depth,...placedSpaces.map(space=>space.z+space.depth)),width:lounge.width+spacesWidth,depth:1}:null;
  const walkwayTiles=walkway?Array.from({length:walkway.width},(_,i)=>[walkway.x+i,walkway.z]):[];
  // The lobby's own width, before any spaces: the camera fits this, and spaces stream in beyond it.
  const baseWidth=width+pool.width+lounge.width;
  const extentWidth=baseWidth+spacesWidth;
  const depth=Math.max(danceStart+DANCE_ROWS,pool.z+pool.depth,lounge.z+lounge.depth,...placedSpaces.map(space=>space.z+space.depth),walkway?walkway.z+1:0);
  // The lobby zone is everything that is not an added space; each space is a zone of its own.
  const mainZoneTiles=[...mainTiles,...danceTiles,...poolDeckTiles,...parkingTiles,...waterTiles,...loungeTiles,...walkwayTiles];
  const layout={mainTiles,danceTiles,pool,parking,lounge,pit,pitTiles,poolDeckTiles,parkingTiles,waterTiles,loungeTiles,spaces:placedSpaces,spaceTiles:spaceTilesAll,walkway,walkwayTiles,mainZoneTiles,
    tiles:[...mainZoneTiles,...spaceTilesAll],width,baseWidth,extentWidth,depth,danceStart};
  layout.tileSet=new Set(layout.tiles.map(t=>t.join(',')));
  return layout;
}
// Zones: the unit of presence, chat, voice, furniture storage and rendering. The lobby (main room,
// terrace, pool, deck, lounge and walkway) is one zone; every added space is another, by its id.
export const MAIN_ZONE='main';
// How many players a zone holds at once: the cost of being in a zone is bounded by this, not by
// how many people are in the world.
export const ZONE_CAP=60;
export function zoneAt(layout,x,z){
  // Spaces sit in a row along x, so the first whose range holds x is the one (or none).
  for(const s of layout.spaces)if(x>=s.x&&x<s.x+s.width)return z>=s.z&&z<s.z+s.depth?s.id:MAIN_ZONE;
  return MAIN_ZONE;
}
export const zoneSpace=(layout,zone)=>zone===MAIN_ZONE?null:layout.spaces.find(s=>s.id===zone)??null;
export function zoneTiles(layout,zone){
  if(zone===MAIN_ZONE)return layout.mainZoneTiles;
  return zoneSpace(layout,zone)?.tiles??[];
}
// The tiles of several zones as one set of 'x,z' keys, for pathfinding within them.
export function zoneTileSet(layout,zones){
  const set=new Set();
  for(const zone of new Set(zones))for(const t of zoneTiles(layout,zone))set.add(`${t[0]},${t[1]}`);
  return set;
}
// A zone's footprint in tiles, for drawing and for working out what a camera can see.
export function zoneBounds(layout,zone){
  if(zone===MAIN_ZONE)return {x:0,z:0,width:layout.baseWidth,depth:layout.depth};
  const s=zoneSpace(layout,zone);return s?{x:s.x,z:s.z,width:s.width,depth:s.depth}:null;
}
// The zones whose tiles meet a block of tiles.
export function zonesIn(layout,region){
  const zones=new Set();
  const x1=region.x+region.width,z1=region.z+region.depth;
  if(region.x<layout.baseWidth&&region.z<layout.depth)zones.add(MAIN_ZONE);
  for(const s of layout.spaces)if(s.x<x1&&s.x+s.width>region.x&&s.z<z1&&s.z+s.depth>region.z)zones.add(s.id);
  if(layout.walkway&&layout.walkway.z<z1&&layout.walkway.z+1>region.z&&layout.walkway.x<x1&&layout.walkway.x+layout.walkway.width>region.x)zones.add(MAIN_ZONE);
  return [...zones];
}
// The back wall runs along z=0 from the lounge to the end of the last space; these tiles carry it.
export const backWallTiles=layout=>[...layout.loungeTiles,...layout.spaceTiles].filter(([,z])=>z===0);
export const onWalkway=(layout,x,z)=>!!layout.walkway&&z===layout.walkway.z&&x>=layout.walkway.x&&x<layout.walkway.x+layout.walkway.width;
export const isPoolWater=(layout,x,z)=>x>=layout.pool.x+1&&x<layout.pool.x+layout.pool.width-1&&z>=layout.pool.z+1&&z<layout.pool.z+layout.pool.depth-1;
export const inPit=(layout,x,z)=>!!layout.pit&&x>=layout.pit.x&&x<layout.pit.x+layout.pit.width&&z>=layout.pit.z&&z<layout.pit.z+layout.pit.depth;
// The pit's outer ring is the sofa: standing there means sitting, facing the rug in the middle.
export function pitSeat(layout,x,z){
  const p=layout.pit;if(!p||!inPit(layout,x,z))return null;
  const top=z===p.z,left=x===p.x,bottom=z===p.z+p.depth-1,right=x===p.x+p.width-1;
  if(!(top||left||bottom||right))return null;
  return {direction:top?4:bottom?0:left?2:6};
}
export const tileDrop=(layout,x,z)=>isPoolWater(layout,x,z)?7:(x<layout.width&&z>=layout.danceStart)||inPit(layout,x,z)?STEP_DOWN:0;
const ramp=v=>Math.max(0,Math.min(1,v));
// Smooth descent across a step edge: the dance terrace and the sunken pit each ramp over half a tile.
export const walkingDrop=(layout,z,x=0)=>{
  if(isPoolWater(layout,x,z))return 38;
  const dance=STEP_DOWN*ramp(z-layout.danceStart+.5)*ramp(layout.width+.5-x);
  const p=layout.pit,pit=p?STEP_DOWN*ramp(x-p.x+.5)*ramp(p.x+p.width+.5-x)*ramp(z-p.z+.5)*ramp(p.z+p.depth+.5-z):0;
  return Math.max(dance,pit);
};

// Each floor level is tried in turn, highest first; a hit counts when the tile exists and sits at
// that level, so no list of tiles is ever scanned.
export function tileAtPoint(layout,sx,sy,centerX){
  for(const drop of [0,STEP_DOWN,7]){
    const x=Math.floor((sx+centerX)/64+(sy-drop)/32),z=Math.floor((sy-drop)/32-(sx+centerX)/64);
    if(layout.tileSet.has(`${x},${z}`)&&tileDrop(layout,x,z)===drop)return {x,z};
  }
  return null;
}
