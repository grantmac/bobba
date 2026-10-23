import {placeSpaces,spaceTiles,TIER_STRIDE,TIER_RISE} from './spaces.js';
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
  // Player-added spaces form staggered tiers beyond the lounge.
  const placedSpaces=placeSpaces(spaces,lounge.x+lounge.width).map(space=>({...space,tiles:spaceTiles(space)}));
  const spaceTilesAll=placedSpaces.flatMap(space=>space.tiles);
  const baseWidth=width+pool.width+lounge.width;
  const baseDepth=Math.max(danceStart+DANCE_ROWS,pool.z+pool.depth,lounge.z+lounge.depth);
  const tiered=placedSpaces.some(s=>s.level!==0);
  const levels=[...new Set([0,...placedSpaces.map(s=>s.level)])].sort((a,b)=>b-a);
  const right=Math.max(baseWidth,...placedSpaces.map(s=>s.x+s.width));
  // A common stair spine sits outside every room. Only the front walkways join it,
  // so a player cannot step sideways from a staircase into a room at another height.
  const stairX=right+1;
  const walkways=placedSpaces.length?levels.map(level=>{
    const row=placedSpaces.filter(s=>s.level===level),x=level===0?lounge.x:baseWidth-level*TIER_STRIDE;
    const z=-level*TIER_STRIDE+Math.max(8,...row.map(s=>s.depth));
    return {x,z,width:(tiered?stairX+2:right)-x,depth:1,level};
  }):[];
  const middle=walkways.find(w=>w.level===0);
  // Preserve the single-row public shape for existing callers.
  const walkway=middle?{x:middle.x,z:middle.z,width:middle.width,depth:1}:null;
  const walkwayTiles=walkways.flatMap(w=>Array.from({length:w.width},(_,i)=>[w.x+i,w.z]));
  const stairs=[];
  for(let i=1;i<walkways.length;i++){
    const upper=walkways[i-1],lower=walkways[i];
    stairs.push({x:stairX,width:2,z:upper.z+1,depth:lower.z-upper.z-1,topZ:upper.z,bottomZ:lower.z,topDrop:0-upper.level*TIER_RISE,bottomDrop:0-lower.level*TIER_RISE});
  }
  const stairTiles=stairs.flatMap(s=>Array.from({length:s.width*s.depth},(_,i)=>[s.x+i%s.width,s.z+Math.floor(i/s.width)]));
  const passageTiles=[...walkwayTiles,...stairTiles],passageSet=new Set(passageTiles.map(t=>t.join(',')));
  const drops=new Map();
  for(const space of placedSpaces)for(const t of space.tiles)drops.set(t.join(','),0-space.level*TIER_RISE);
  for(const w of walkways)for(let x=w.x;x<w.x+w.width;x++)drops.set(`${x},${w.z}`,0-w.level*TIER_RISE);
  for(const s of stairs)for(let z=s.z;z<s.z+s.depth;z++)for(let x=s.x;x<s.x+s.width;x++)drops.set(`${x},${z}`,s.topDrop+(s.bottomDrop-s.topDrop)*(z-s.topZ)/(s.bottomZ-s.topZ));
  const extentWidth=tiered?stairX+2:right;
  const minZ=Math.min(0,...placedSpaces.map(s=>s.z));
  const depth=Math.max(baseDepth,...placedSpaces.map(s=>s.z+s.depth),...walkways.map(w=>w.z+1));
  const mainZoneTiles=[...mainTiles,...danceTiles,...poolDeckTiles,...parkingTiles,...waterTiles,...loungeTiles,...passageTiles];
  const layout={mainTiles,danceTiles,pool,parking,lounge,pit,pitTiles,poolDeckTiles,parkingTiles,waterTiles,loungeTiles,spaces:placedSpaces,spaceTiles:spaceTilesAll,walkway,walkways,walkwayTiles,stairs,stairTiles,passageSet,drops,mainZoneTiles,
    tiles:[...mainZoneTiles,...spaceTilesAll],width,baseWidth,baseDepth,extentWidth,depth,minZ,danceStart};
  layout.tileSet=new Set(layout.tiles.map(t=>t.join(',')));
  layout.dropLevels=[...new Set([0,STEP_DOWN,7,...drops.values()])].sort((a,b)=>a-b);
  return layout;
}
// Zones: the unit of presence, chat, voice, furniture storage and rendering. The lobby (main room,
// terrace, pool, deck, lounge and walkway) is one zone; every added space is another, by its id.
export const MAIN_ZONE='main';
// How many players a zone holds at once: the cost of being in a zone is bounded by this, not by
// how many people are in the world.
export const ZONE_CAP=60;
export function zoneAt(layout,x,z){
  // Tier footprints never overlap, so x and z identify the room unambiguously.
  for(const s of layout.spaces)if(x>=s.x&&x<s.x+s.width&&z>=s.z&&z<s.z+s.depth)return s.id;
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
  if([...layout.walkways,...layout.stairs].some(w=>w.z<z1&&w.z+w.depth>region.z&&w.x<x1&&w.x+w.width>region.x))zones.add(MAIN_ZONE);
  return [...zones];
}
// Each tier has its own back wall; the lounge remains at z=0.
export const backWallTiles=layout=>[...layout.loungeTiles.filter(([,z])=>z===0),...layout.spaces.flatMap(s=>s.tiles.filter(([,z])=>z===s.z))];
export const onWalkway=(layout,x,z)=>layout.passageSet.has(`${Math.floor(x)},${Math.floor(z)}`);
export const isPoolWater=(layout,x,z)=>x>=layout.pool.x+1&&x<layout.pool.x+layout.pool.width-1&&z>=layout.pool.z+1&&z<layout.pool.z+layout.pool.depth-1;
export const inPit=(layout,x,z)=>!!layout.pit&&x>=layout.pit.x&&x<layout.pit.x+layout.pit.width&&z>=layout.pit.z&&z<layout.pit.z+layout.pit.depth;
// The pit's outer ring is the sofa: standing there means sitting, facing the rug in the middle.
export function pitSeat(layout,x,z){
  const p=layout.pit;if(!p||!inPit(layout,x,z))return null;
  const top=z===p.z,left=x===p.x,bottom=z===p.z+p.depth-1,right=x===p.x+p.width-1;
  if(!(top||left||bottom||right))return null;
  return {direction:top?4:bottom?0:left?2:6};
}
export const tileDrop=(layout,x,z)=>layout.drops.get(`${Math.floor(x)},${Math.floor(z)}`)??(isPoolWater(layout,x,z)?7:(x<layout.width&&z>=layout.danceStart)||inPit(layout,x,z)?STEP_DOWN:0);
const ramp=v=>Math.max(0,Math.min(1,v));
// Smooth descent across a step edge: the dance terrace and the sunken pit each ramp over half a tile.
export const walkingDrop=(layout,z,x=0)=>{
  for(const s of layout.stairs)if(x>=s.x&&x<s.x+s.width&&z>=s.topZ+.5&&z<=s.bottomZ+.5)return s.topDrop+(s.bottomDrop-s.topDrop)*(z-s.topZ-.5)/(s.bottomZ-s.topZ);
  const drop=layout.drops.get(`${Math.floor(x)},${Math.floor(z)}`);
  if(drop!==undefined)return drop;
  if(isPoolWater(layout,x,z))return 38;
  const dance=STEP_DOWN*ramp(z-layout.danceStart+.5)*ramp(layout.width+.5-x);
  const p=layout.pit,pit=p?STEP_DOWN*ramp(x-p.x+.5)*ramp(p.x+p.width+.5-x)*ramp(z-p.z+.5)*ramp(p.z+p.depth+.5-z):0;
  return Math.max(dance,pit);
};

// Each floor level is tried in turn, highest first; a hit counts when the tile exists and sits at
// that level, so no list of tiles is ever scanned.
export function tileAtPoint(layout,sx,sy,centerX){
  for(const drop of layout.dropLevels){
    const x=Math.floor((sx+centerX)/64+(sy-drop)/32),z=Math.floor((sy-drop)/32-(sx+centerX)/64);
    if(layout.tileSet.has(`${x},${z}`)&&tileDrop(layout,x,z)===drop)return {x,z};
  }
  return null;
}
