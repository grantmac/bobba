export const DANCE_ROWS=5,STEP_DOWN=12;

// Append a lower terrace along the front-left edge without renumbering any
// existing room tiles, furniture positions, or wall attachments.
export function roomLayout(mainTiles){
  const width=Math.max(...mainTiles.map(([x])=>x))+1;
  const danceStart=Math.max(...mainTiles.map(([,z])=>z))+1;
  const danceTiles=Array.from({length:width*DANCE_ROWS},(_,i)=>[i%width,danceStart+Math.floor(i/width)]);
  const parking={x:width,z:0,width:5,depth:3};
  const parkingTiles=Array.from({length:parking.width*parking.depth},(_,i)=>[width+i%parking.width,Math.floor(i/parking.width)]);
  const pool={x:width,z:parking.depth,width:5,depth:5},poolDeckTiles=[],waterTiles=[];
  for(let x=0;x<pool.width;x++)for(let z=0;z<pool.depth;z++){
    (x>0&&x<pool.width-1&&z>0&&z<pool.depth-1?waterTiles:poolDeckTiles).push([pool.x+x,pool.z+z]);
  }
  return {mainTiles,danceTiles,pool,parking,poolDeckTiles,parkingTiles,waterTiles,tiles:[...mainTiles,...danceTiles,...poolDeckTiles,...parkingTiles,...waterTiles],width,extentWidth:width+pool.width,depth:Math.max(danceStart+DANCE_ROWS,pool.z+pool.depth),danceStart};
}
export const isPoolWater=(layout,x,z)=>x>=layout.pool.x+1&&x<layout.pool.x+layout.pool.width-1&&z>=layout.pool.z+1&&z<layout.pool.z+layout.pool.depth-1;
export const tileDrop=(layout,x,z)=>isPoolWater(layout,x,z)?7:x<layout.width&&z>=layout.danceStart?STEP_DOWN:0;
export const walkingDrop=(layout,z,x=0)=>isPoolWater(layout,x,z)?38:STEP_DOWN*Math.max(0,Math.min(1,z-layout.danceStart+.5))*Math.max(0,Math.min(1,layout.width+.5-x));

export function tileAtPoint(layout,sx,sy,centerX){
  for(const [tiles,drop] of [[layout.mainTiles,0],[layout.danceTiles,STEP_DOWN],[layout.poolDeckTiles,0],[layout.parkingTiles,0],[layout.waterTiles,7]]){
    const x=Math.floor((sx+centerX)/64+(sy-drop)/32),z=Math.floor((sy-drop)/32-(sx+centerX)/64);
    if(tiles.some(([tx,tz])=>tx===x&&tz===z))return {x,z};
  }
  return null;
}
