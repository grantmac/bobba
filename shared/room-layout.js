import {placeSpaces,spaceTiles} from './spaces.js';
export const DANCE_ROWS=10,STEP_DOWN=12;

// Append a lower terrace along the front-left edge without renumbering any
// existing room tiles, furniture positions, or wall attachments.
export function roomLayout(mainTiles,spaces=[]){
  const width=Math.max(...mainTiles.map(([x])=>x))+1;
  const danceStart=Math.max(...mainTiles.map(([,z])=>z))+1;
  const danceTiles=Array.from({length:width*DANCE_ROWS},(_,i)=>[i%width,danceStart+Math.floor(i/width)]);
  const parking={x:width,z:0,width:5,depth:3};
  const parkingTiles=Array.from({length:parking.width*parking.depth},(_,i)=>[width+i%parking.width,Math.floor(i/parking.width)]);
  // A games lounge to the right of the pool and deck: its back wall carries the Pong
  // projection on the first four tiles, a tile's gap, then the whiteboard on the last three.
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
  const extentWidth=width+pool.width+lounge.width+spacesWidth;
  const depth=Math.max(danceStart+DANCE_ROWS,pool.z+pool.depth,lounge.z+lounge.depth,...placedSpaces.map(space=>space.z+space.depth),walkway?walkway.z+1:0);
  return {mainTiles,danceTiles,pool,parking,lounge,pit,pitTiles,poolDeckTiles,parkingTiles,waterTiles,loungeTiles,spaces:placedSpaces,spaceTiles:spaceTilesAll,walkway,walkwayTiles,
    tiles:[...mainTiles,...danceTiles,...poolDeckTiles,...parkingTiles,...waterTiles,...loungeTiles,...spaceTilesAll,...walkwayTiles],width,extentWidth,depth,danceStart};
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

export function tileAtPoint(layout,sx,sy,centerX){
  for(const [tiles,drop] of [[layout.mainTiles,0],[layout.danceTiles,STEP_DOWN],[layout.poolDeckTiles,0],[layout.parkingTiles,0],[layout.pitTiles,STEP_DOWN],[layout.loungeTiles,0],[layout.waterTiles,7],[layout.spaceTiles,0],[layout.walkwayTiles,0]]){
    const x=Math.floor((sx+centerX)/64+(sy-drop)/32),z=Math.floor((sy-drop)/32-(sx+centerX)/64);
    if(tiles.some(([tx,tz])=>tx===x&&tz===z))return {x,z};
  }
  return null;
}
