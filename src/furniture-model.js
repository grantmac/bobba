export function footprint(item, definition) {
  const swap=item.rotation%4===2;
  const width=swap?definition.depth:definition.width,depth=swap?definition.width:definition.depth;
  return Array.from({length:width*depth},(_,i)=>[item.x+i%width,item.z+Math.floor(i/width)]);
}
export function isPlaced(item){return Number.isInteger(item.x)&&Number.isInteger(item.z);}
export function canPlace(item,items,definitions,isTile,avatar){
  const def=definitions.get(item.type);
  if(!def||!isPlaced(item))return false;
  const cells=footprint(item,def);
  if(cells.some(([x,z])=>!isTile(x,z)))return false;
  if(def.category!=='Rugs'&&avatar&&cells.some(([x,z])=>x===Math.floor(avatar.x)&&z===Math.floor(avatar.z)))return false;
  const occupied=new Set(items.filter(other=>other.id!==item.id&&isPlaced(other)&&(definitions.get(other.type).category==='Rugs')===(def.category==='Rugs')).flatMap(other=>footprint(other,definitions.get(other.type)).map(cell=>cell.join(','))));
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
    seen.add(item.id);return true;
  }).map(({id,type,rotation,x,z})=>({id,type,rotation,x,z}));
}
