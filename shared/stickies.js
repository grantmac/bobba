export const STICKY_COLORS=['#ffff33','#9cff9c','#ff9cff','#9cceff'];
export const STICKY_LIMIT=100,STICKY_TEXT_LIMIT=2000;
// Flat prints sheared onto the wall at `size` room pixels square.
export const POSTERS={neu:{name:'NEU! poster',file:'/assets/posters/neu.png',size:48}};
export function wallExists(note,tiles){
  return tiles.has(`${note.x},${note.z}`)&&!tiles.has(note.side==='left'?`${note.x-1},${note.z}`:`${note.x},${note.z-1}`);
}
export function validWallPosition(note,tiles){
  return ['left','right'].includes(note.side)&&Number.isInteger(note.x)&&Number.isInteger(note.z)&&
    Number.isFinite(note.u)&&note.u>=.25&&note.u<=.75&&Number.isFinite(note.height)&&note.height>=24&&note.height<=100&&wallExists(note,tiles);
}
export function validPosterPosition(note,tiles){
  if(!validWallPosition(note,tiles)||note.height<26||note.height>88)return false;
  // The square print spans 1.5 wall tiles; require continuous wall behind it.
  for(let offset=Math.floor(note.u-.75+.001);offset<=Math.floor(note.u+.75-.001);offset++){
    if(!wallExists({...note,x:note.x+(note.side==='right'?offset:0),z:note.z+(note.side==='left'?offset:0)},tiles))return false;
  }
  return true;
}
export function relocateStickies(notes,tiles){
  const walls=[...tiles].flatMap(key=>{
    const [x,z]=key.split(',').map(Number);
    return ['left','right'].map(side=>({x,z,side})).filter(w=>wallExists(w,tiles));
  });
  return notes.map(note=>{
    const valid=note.poster?validPosterPosition:validWallPosition;
    if(valid(note,tiles))return note;
    const candidates=walls.filter(w=>valid({...note,...w},tiles));
    if(!candidates.length)return note;
    const wall=candidates.reduce((best,w)=>Math.hypot(w.x-note.x,w.z-note.z)<Math.hypot(best.x-note.x,best.z-note.z)?w:best);
    return {...note,...wall,revision:note.revision+1};
  });
}
