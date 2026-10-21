export function footprint(item, definition) {
  const swap=item.rotation%4===2;
  const width=swap?definition.depth:definition.width,depth=swap?definition.width:definition.depth;
  return Array.from({length:width*depth},(_,i)=>[item.x+i%width,item.z+Math.floor(i/width)]);
}
export function isPlaced(item){return Number.isInteger(item.x)&&Number.isInteger(item.z);}
export function canStack(def){return ['Decor','Plants','Lighting'].includes(def?.category);}
// Wall pieces hang on a wall instead of standing on the floor: `x,z` is the wall's tile,
// the rotation picks the wall (2 for the left wall, 4 for the right), `u` is the position
// along that wall's tile edge and `height` the lift above the floor line, in room pixels.
export const isWallItem=def=>def?.category==='Wall';
export const wallSide=item=>item.rotation===4?'right':'left';
export const takesFloor=def=>!!def&&def.category!=='Rugs'&&!isWallItem(def);
export function canHang(item,def,hasWall){
  if(!isWallItem(def)||!isPlaced(item)||![2,4].includes(item.rotation))return false;
  if(!Number.isFinite(item.u)||item.u<.25||item.u>.75||!Number.isFinite(item.height)||item.height<26||item.height>88)return false;
  const side=wallSide(item),half=(def.wallWidth??32)/64;
  for(let offset=Math.floor(item.u-half+.001);offset<=Math.floor(item.u+half-.001);offset++){
    if(!hasWall(item.x+(side==='right'?offset:0),item.z+(side==='left'?offset:0),side))return false;
  }
  return true;
}
// The hung piece's centre relative to its wall tile's top corner on the floor.
export function wallAnchor(item){return {x:(wallSide(item)==='left'?-1:1)*item.u*32,y:item.u*16-item.height};}
export function surfaceHeight(item,items,definitions){
  const table=items.find(other=>other.id===item.supportId);
  return table?definitions.get(table.type)?.surfaceHeight??24:0;
}
export function canPlace(item,items,definitions,isTile,avatar,floorHeight=()=>0,hasWall=()=>false){
  const def=definitions.get(item.type);
  if(!def||!isPlaced(item))return false;
  if(isWallItem(def))return !item.supportId&&canHang(item,def,hasWall);
  const cells=footprint(item,def);
  if(cells.some(([x,z])=>!isTile(x,z)))return false;
  if(new Set(cells.map(([x,z])=>floorHeight(x,z))).size>1)return false;
  if(item.supportId){
    const table=items.find(other=>other.id===item.supportId);
    if(!canStack(def)||!table||table.id===item.id||table.supportId||!isPlaced(table)||definitions.get(table.type)?.category!=='Tables')return false;
    const surface=new Set(footprint(table,definitions.get(table.type)).map(cell=>cell.join(',')));
    if(cells.some(cell=>!surface.has(cell.join(','))))return false;
    const occupied=new Set(items.filter(other=>other.id!==item.id&&isPlaced(other)&&other.supportId===item.supportId).flatMap(other=>footprint(other,definitions.get(other.type)).map(cell=>cell.join(','))));
    return !cells.some(cell=>occupied.has(cell.join(',')));
  }
  if(def.category!=='Rugs'&&avatar&&cells.some(([x,z])=>x===Math.floor(avatar.x)&&z===Math.floor(avatar.z)))return false;
  const occupied=new Set(items.filter(other=>other.id!==item.id&&!other.supportId&&isPlaced(other)&&!isWallItem(definitions.get(other.type))&&(definitions.get(other.type).category==='Rugs')===(def.category==='Rugs')).flatMap(other=>footprint(other,definitions.get(other.type)).map(cell=>cell.join(','))));
  return !cells.some(cell=>occupied.has(cell.join(',')));
}
// A seat is every tile of a Seating piece, or for pieces such as vehicles one
// tile per rotation with the avatar's facing and pixel nudge set by the piece.
export function seatFor(item,definition,point){
  if(!definition||!isPlaced(item))return null;
  const spot=definition.seat?.[item.rotation];
  if(spot){
    const cells=(spot.cells??[spot.cell]).map(([x,z])=>[item.x+x,item.z+z]);
    const index=point?Math.max(0,cells.findIndex(([x,z])=>x===Math.floor(point.x)&&z===Math.floor(point.z))):0;
    const offset=spot.offsets?.[index]??spot.offset;
    return {cells,direction:spot.direction,offsetX:offset?.[0]??0,offsetY:offset?.[1]};
  }
  if(definition.category==='Seating')return {cells:footprint(item,definition),direction:item.rotation,offsetX:0,offsetY:undefined};
  return null;
}
// Where to stand to use a piece: the nearest walkable tile touching it (or the
// table carrying it), and the way to face the piece from there. Standing on such
// a tile already means only turning.
export function approachFor(item,items,definitions,from,canWalk){
  const def=definitions.get(item.type);
  if(!def||!isPlaced(item))return null;
  const own=footprint(item,def),table=items.find(other=>other.id===item.supportId);
  const base=table&&isPlaced(table)?[...own,...footprint(table,definitions.get(table.type))]:own;
  const taken=new Set(base.map(c=>c.join(',')));
  const spots=[];
  for(const [x,z] of base)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const key=`${x+dx},${z+dz}`;
    if(taken.has(key)||!canWalk(x+dx,z+dz))continue;
    taken.add(key);spots.push([x+dx,z+dz]);
  }
  if(!spots.length)return null;
  const here=[Math.floor(from.x),Math.floor(from.z)];
  const [x,z]=spots.find(s=>s[0]===here[0]&&s[1]===here[1])??spots.sort((a,b)=>Math.hypot(a[0]+.5-from.x,a[1]+.5-from.z)-Math.hypot(b[0]+.5-from.x,b[1]+.5-from.z))[0];
  const [cx,cz]=[...own].sort((a,b)=>Math.abs(a[0]-x)+Math.abs(a[1]-z)-Math.abs(b[0]-x)-Math.abs(b[1]-z))[0];
  const dx=cx-x,dz=cz-z;
  return {x,z,direction:Math.abs(dx)>Math.abs(dz)?(dx>0?2:6):(dz>0?4:0)};
}
export function blocksTile(x,z,items,definitions){
  return items.some(item=>isPlaced(item)&&takesFloor(definitions.get(item.type))&&footprint(item,definitions.get(item.type)).some(([a,b])=>a===x&&b===z));
}
export function restoreItems(value,definitions){
  if(!Array.isArray(value))return [];
  const seen=new Set();
  return value.slice(0,200).filter(item=>{
    if(!item||typeof item.id!=='string'||seen.has(item.id)||!definitions.has(item.type))return false;
    if(!definitions.get(item.type).views.some(v=>v.direction===item.rotation))return false;
    if(!(item.x===null&&item.z===null)&&!(isPlaced(item)&&item.x>=0&&item.z>=0&&item.x<100&&item.z<100))return false;
    if(item.supportId!==undefined&&(typeof item.supportId!=='string'||!isPlaced(item)))return false;
    // A power flag belongs to the decks and to built pieces marked switchable.
    if(item.on!==undefined&&(typeof item.on!=='boolean'||!(item.type==='custom_dj_decks'||definitions.get(item.type).switchable)))return false;
    const wall=isWallItem(definitions.get(item.type));
    if(wall&&isPlaced(item)&&!(Number.isFinite(item.u)&&Number.isFinite(item.height)))return false;
    if(!wall&&(item.u!==undefined||item.height!==undefined))return false;
    if(item.owner!==undefined&&typeof item.owner!=='string')return false;
    seen.add(item.id);return true;
  }).map(({id,type,rotation,x,z,supportId,on,u,height,owner})=>({id,type,rotation,x,z,...(supportId?{supportId}:{}),...(on!==undefined?{on}:{}),...(isPlaced({x,z})&&u!==undefined?{u,height}:{}),...(owner?{owner}:{})}));
}
// Carry a table's contents through the same translation and quarter-turns.
export function moveWithContents(items,replacement,definitions){
  const original=items.find(item=>item.id===replacement.id);
  if(!original)return [...items,replacement];
  const turns=((replacement.rotation-original.rotation+8)%8)/2;
  const originalCells=footprint(original,definitions.get(original.type));
  const width=Math.max(...originalCells.map(c=>c[0]))-original.x+1;
  const depth=Math.max(...originalCells.map(c=>c[1]))-original.z+1;
  return items.map(item=>{
    if(item.id===replacement.id)return replacement;
    if(item.supportId!==original.id)return item;
    if(!isPlaced(replacement)){const next={...item,x:null,z:null};delete next.supportId;return next;}
    const def=definitions.get(item.type);
    const rotated=footprint(item,def).map(([x,z])=>{
      x-=original.x;z-=original.z;
      if(turns===1)return [depth-1-z,x];
      if(turns===2)return [width-1-x,depth-1-z];
      if(turns===3)return [z,width-1-x];
      return [x,z];
    });
    const wanted=(item.rotation+turns*2)%8;
    const rotation=def.views.find(v=>v.direction===wanted)?.direction??def.views.find(v=>v.direction%4===wanted%4)?.direction??item.rotation;
    return {...item,rotation,x:replacement.x+Math.min(...rotated.map(c=>c[0])),z:replacement.z+Math.min(...rotated.map(c=>c[1]))};
  });
}
export function pickupWithContents(items,id,remove=false){
  return items.filter(item=>!remove||item.id!==id).map(item=>{
    if(item.id!==id&&item.supportId!==id)return item;
    const next={...item,x:null,z:null};delete next.supportId;delete next.u;delete next.height;return next;
  });
}
