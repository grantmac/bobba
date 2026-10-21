import {ConvexError} from 'convex/values';
import {choices as appearanceChoices,colors as appearanceColors} from './appearance.js';
import {shapes,wallColors,floorColors,furniture} from './catalog.js';
import {canPlace} from '../../shared/furniture-model.js';
import {roomLayout,tileDrop} from '../../shared/room-layout.js';
export const DEFAULT_ROOM={shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true};
const COLORS=['#624631','#302525','#ad7443','#d5ad60','#eee0b2','#f2eeee','#42454c','#b34c43','#d77998','#d77998','#78578d','#536ea5','#72a6b0','#6b8c64','#9eae6a','#bd8e55','#55677e'];
const SKIN=['#f5d9bd','#e8b18a','#cf936e','#b87952','#925f42','#704734','#50362a','#f0c8a4'];
export function fail(message){throw new ConvexError(message);}
export function validName(raw){
  const name=raw.normalize('NFKC').trim();
  if(!/^[A-Za-z][A-Za-z0-9 _-]{1,19}$/.test(name))fail('Use 2–20 letters, numbers, spaces, underscores, or hyphens.');
  return {name,key:name.toLowerCase()};
}
export function validateLook(look){
  if(!look||typeof look!=='object'||!['hair','skin','top','bottom','shoes'].every(key=>look[key])||Object.keys(look).some(key=>!appearanceChoices[key]))fail('Choose a valid appearance.');
  for(const [key,part] of Object.entries(look)){
    if(!part||!appearanceChoices[key].includes(part.model)||!appearanceColors[key].includes(part.color)||Object.keys(part).some(k=>!['model','color','color2'].includes(k))||(part.color2!==undefined&&!appearanceColors[key].includes(part.color2)))fail('Choose a valid appearance.');
  }
  return look;
}
export function validateRoom(options){
  if(!options||Object.keys(options).length!==6||!shapes[options.shape]||!['plain','tiles','checks','stripes'].includes(options.wall)||!['plain','wood','tiles','carpet'].includes(options.floor)||!wallColors.includes(options.wallColor)||!floorColors.includes(options.floorColor)||typeof options.window!=='boolean')fail('Invalid room settings.');
  return options;
}
export const isPlaced=item=>Number.isInteger(item.x)&&Number.isInteger(item.z);
export function cells(item){
  const def=furniture[item.type],swap=item.rotation%4===2,w=swap?def.depth:def.width,d=swap?def.width:def.depth;
  return Array.from({length:w*d},(_,i)=>[item.x+i%w,item.z+Math.floor(i/w)]);
}
export const layoutFor=options=>roomLayout(shapes[options.shape]);
export function wallTileSet(options){return tileSet(options);}
export function tileSet(options){return new Set(layoutFor(options).tiles.map(t=>t.join(',')));}
export function blocked(room,x,z,ignore=null){
  return room.furniture.some(i=>i.id!==ignore&&isPlaced(i)&&furniture[i.type].category!=='Rugs'&&cells(i).some(([a,b])=>a===x&&b===z));
}
export function validateFurniture(items,options){
  if(items.length>200)fail('The room can hold up to 200 pieces.');
  const ids=new Set(),occupied=new Set(),rugs=new Set(),tiles=tileSet(options),layout=layoutFor(options);
  for(const item of items){
    if(!item||Object.keys(item).some(key=>!['id','type','rotation','x','z','supportId','on'].includes(key))||!['id','type','rotation','x','z'].every(key=>Object.hasOwn(item,key))||typeof item.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(item.id)||ids.has(item.id))fail('Invalid furniture.');
    if(item.on!==undefined&&(typeof item.on!=='boolean'||item.type!=='custom_dj_decks'))fail('Invalid furniture power setting.');
    ids.add(item.id);const def=furniture[item.type];
    if(!def||!def.views.some(v=>v.direction===item.rotation))fail('Invalid furniture type or rotation.');
    if(item.x===null&&item.z===null){if(item.supportId!==undefined)fail('Inventory items cannot be on a table.');continue;}
    if(!isPlaced(item))fail('Invalid furniture position.');
    if(new Set(cells(item).map(([x,z])=>tileDrop(layout,x,z))).size>1)fail('Furniture cannot straddle the step.');
    if(item.supportId!==undefined){if(typeof item.supportId!=='string'||!item.supportId)fail('Invalid furniture support.');continue;}
    const target=def.category==='Rugs'?rugs:occupied;
    for(const cell of cells(item)){const key=cell.join(',');if(!tiles.has(key)||target.has(key))fail('Furniture must fit in a free floor space.');target.add(key);}
  }
  const definitions=new Map(Object.entries(furniture));
  for(const item of items.filter(i=>i.supportId)){
    if(!canPlace(item,items,definitions,(x,z)=>tiles.has(`${x},${z}`)))fail('Items must fit on a free tabletop.');
  }
}
export function atTime(player,now){
  const route=player.route;let distance=Math.max(0,now-player.startedAt)/1000*3.2;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],length=Math.hypot(b.x-a.x,b.z-a.z);
    if(distance<length&&length>0)return {x:a.x+(b.x-a.x)*distance/length,z:a.z+(b.z-a.z)*distance/length};
    distance-=length;
  }
  return route.at(-1);
}
// Reserve the remaining walk, including its destination, so simultaneous routes
// cannot cross or claim the same tile. Reservations release as the player moves.
export function playerTiles(players,now,exclude=null){
  const result=new Set();
  for(const p of players){
    if(p._id===exclude||p.lastSeen<=now-45000)continue;
    let remaining=Math.max(0,now-p.startedAt)/1000*3.2;
    const position=atTime(p,now);result.add(`${Math.floor(position.x)},${Math.floor(position.z)}`);
    for(let i=1;i<p.route.length;i++){
      const a=p.route[i-1],b=p.route[i],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(remaining<length){result.add(`${Math.floor(a.x)},${Math.floor(a.z)}`);for(const point of p.route.slice(i))result.add(`${Math.floor(point.x)},${Math.floor(point.z)}`);break;}
      remaining-=length;
    }
  }
  return result;
}
export function freePosition(room,preferred={x:3.5,z:4.5},occupied=new Set()){
  const free=layoutFor(room.options).tiles.filter(([x,z])=>!blocked(room,x,z)&&!occupied.has(`${x},${z}`));
  if(!free.length)fail('There is no free space for another character.');
  free.sort((a,b)=>Math.hypot(a[0]+.5-preferred.x,a[1]+.5-preferred.z)-Math.hypot(b[0]+.5-preferred.x,b[1]+.5-preferred.z));
  return {x:free[0][0]+.5,z:free[0][1]+.5};
}
export function findPath(room,start,end,seatId=null,occupied=new Set()){
  const tiles=tileSet(room.options),key=p=>`${p.x},${p.z}`,origin={x:Math.floor(start.x),z:Math.floor(start.z)};
  if(!tiles.has(key(end))||occupied.has(key(end)))return null;
  const queue=[origin],parents=new Map([[key(origin),null]]);
  for(let i=0;i<queue.length&&!parents.has(key(end));i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const p={x:queue[i].x+dx,z:queue[i].z+dz};
    const allowed=seatId&&p.x===end.x&&p.z===end.z?seatId:null;
    if(tiles.has(key(p))&&!occupied.has(key(p))&&!blocked(room,p.x,p.z,allowed)&&!parents.has(key(p))){parents.set(key(p),queue[i]);queue.push(p);}
  }
  if(!parents.has(key(end)))return null;
  const route=[];for(let p=end;p;p=parents.get(key(p)))route.unshift({x:p.x+.5,z:p.z+.5});
  if(Math.hypot(route[0].x-start.x,route[0].z-start.z)<.001)route.shift();
  return [start,...route];
}
