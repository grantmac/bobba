export const DANCE_ROWS=5,STEP_DOWN=12;

// Append a lower terrace along the front-left edge without renumbering any
// existing room tiles, furniture positions, or wall attachments.
export function roomLayout(mainTiles){
  const width=Math.max(...mainTiles.map(([x])=>x))+1;
  const danceStart=Math.max(...mainTiles.map(([,z])=>z))+1;
  const danceTiles=Array.from({length:width*DANCE_ROWS},(_,i)=>[i%width,danceStart+Math.floor(i/width)]);
  return {mainTiles,danceTiles,tiles:[...mainTiles,...danceTiles],width,depth:danceStart+DANCE_ROWS,danceStart};
}
export const tileDrop=(layout,x,z)=>z>=layout.danceStart?STEP_DOWN:0;
export const walkingDrop=(layout,z)=>STEP_DOWN*Math.max(0,Math.min(1,z-layout.danceStart+.5));

export function tileAtPoint(layout,sx,sy,centerX){
  for(const [tiles,drop] of [[layout.mainTiles,0],[layout.danceTiles,STEP_DOWN]]){
    const x=Math.floor((sx+centerX)/64+(sy-drop)/32),z=Math.floor((sy-drop)/32-(sx+centerX)/64);
    if(tiles.some(([tx,tz])=>tx===x&&tz===z))return {x,z};
  }
  return null;
}
