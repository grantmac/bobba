export function footprint(item, definition) {
  const swap=item.rotation%4===2;
  const width=swap?definition.depth:definition.width,depth=swap?definition.width:definition.depth;
  return Array.from({length:width*depth},(_,i)=>[item.x+i%width,item.z+Math.floor(i/width)]);
}
export function isPlaced(item){return Number.isInteger(item.x)&&Number.isInteger(item.z);}
export function canStack(def){return ['Decor','Plants','Lighting'].includes(def?.category);}
export function surfaceHeight(item,items,definitions){
  const table=items.find(other=>other.id===item.supportId);
  return table?definitions.get(table.type)?.surfaceHeight??24:0;
}
export function canPlace(item,items,definitions,isTile,avatar,floorHeight=()=>0){
  const def=definitions.get(item.type);
  if(!def||!isPlaced(item))return false;
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
  const occupied=new Set(items.filter(other=>other.id!==item.id&&!other.supportId&&isPlaced(other)&&(definitions.get(other.type).category==='Rugs')===(def.category==='Rugs')).flatMap(other=>footprint(other,definitions.get(other.type)).map(cell=>cell.join(','))));
  return !cells.some(cell=>occupied.has(cell.join(',')));
}
export function blocksTile(x,z,items,definitions){
  return items.some(item=>isPlaced(item)&&definitions.get(item.type).category!=='Rugs'&&footprint(item,definitions.get(item.type)).some(([a,b])=>a===x&&b===z));
}
export function restoreItems(value,definitions){
  if(!Array.isArray(value))return [];
  const seen=new Set();
  return value.slice(0,200).filter(item=>{
    if(!item||typeof item.id!=='string'||seen.has(item.id)||!definitions.has(item.type))return false;
    if(!definitions.get(item.type).views.some(v=>v.direction===item.rotation))return false;
    if(!(item.x===null&&item.z===null)&&!(isPlaced(item)&&item.x>=0&&item.z>=0&&item.x<100&&item.z<100))return false;
    if(item.supportId!==undefined&&(typeof item.supportId!=='string'||!isPlaced(item)))return false;
    if(item.on!==undefined&&(typeof item.on!=='boolean'||item.type!=='custom_dj_decks'))return false;
    seen.add(item.id);return true;
  }).map(({id,type,rotation,x,z,supportId,on})=>({id,type,rotation,x,z,...(supportId?{supportId}:{}),...(on!==undefined?{on}:{})}));
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
    const next={...item,x:null,z:null};delete next.supportId;return next;
  });
}
