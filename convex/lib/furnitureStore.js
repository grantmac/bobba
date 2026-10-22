// Furniture lives one row per piece, keyed by the zone it stands in (shared/room-layout.js
// zoneAt) or 'inventory' while picked up. Everything here works a zone at a time: a change
// loads the zones it touches, checks each as a complete list, and writes only the rows that
// changed, so a chair placed in one space never re-sends or re-validates another.
import {isPlaced,isWallItem} from '../../shared/furniture-model.js';
import {zoneAt,MAIN_ZONE} from '../../shared/room-layout.js';
import {fail,layoutFor,validateFurniture,healOrphans,ownSpaceCheck,freePosition,blocked,atTime,zonePlayers} from './rules.js';
import {definitionsFor,assertOwnedChanges,PLACED_LIMIT_PER_PLAYER} from './assets.js';
export const INVENTORY='inventory';
export const ZONE_CHANGE_LIMIT=250;
const FIELDS=['id','type','rotation','x','z','supportId','on','u','height','owner'];
// One shape for every piece, whichever way it arrived, so two copies compare as text.
export function normalizeItem(item){
  const out={};
  for(const key of FIELDS)if(item[key]!==undefined)out[key]=item[key];
  return out;
}
export const sameItem=(a,b)=>JSON.stringify(normalizeItem(a))===JSON.stringify(normalizeItem(b));
export const docItem=doc=>normalizeItem(doc);
export const itemZone=(layout,item)=>isPlaced(item)?zoneAt(layout,item.x,item.z):INVENTORY;
export async function itemDoc(ctx,id){return await ctx.db.query('furniture').withIndex('by_item',q=>q.eq('id',id)).unique();}
export async function zoneItems(ctx,zone){return (await ctx.db.query('furniture').withIndex('by_zone',q=>q.eq('zone',zone)).collect()).map(docItem);}
// What a player holds: their own picked-up pieces, plus the stock ones (no owner) for Grant.
export async function inventoryItems(ctx,playerId,admin=false){
  const own=await ctx.db.query('furniture').withIndex('by_owner',q=>q.eq('owner',playerId).eq('zone',INVENTORY)).collect();
  const stock=admin?await ctx.db.query('furniture').withIndex('by_owner',q=>q.eq('owner',undefined).eq('zone',INVENTORY)).collect():[];
  return [...stock,...own].map(docItem);
}
export async function ownedItems(ctx,playerId){return (await ctx.db.query('furniture').withIndex('by_owner',q=>q.eq('owner',playerId)).collect()).map(docItem);}
// Attach the furniture of some zones to a room record, so the placement rules (which read
// `room.furniture` and `room.definitions`) see exactly those zones.
export async function loadZones(ctx,room,zones){
  const list=[...new Set(zones)];
  room.furniture=(await Promise.all(list.map(zone=>zoneItems(ctx,zone)))).flat();
  room.zones=list;room.definitions=await definitionsFor(ctx,room.furniture);
  return room;
}
function record(layout,item){
  const n=normalizeItem(item);
  return {id:n.id,zone:itemZone(layout,n),type:n.type,rotation:n.rotation,x:n.x,z:n.z,supportId:n.supportId,on:n.on,u:n.u,height:n.height,owner:n.owner};
}
const fields=({id,zone,type,rotation,x,z,supportId,on,u,height,owner})=>({id,zone,type,rotation,x,z,supportId,on,u,height,owner});
// Apply a list of changes: each is a whole piece as it should now be, or {id, removed:true}.
// Checks every zone the changes touch as a complete list, enforces ownership for builders,
// writes the differences, and nudges anyone now standing inside a piece onto a free tile.
export async function applyChanges(ctx,room,player,changes){
  const admin=player.role==='admin',layout=layoutFor(room.options,room.spaces??[]);
  if(!Array.isArray(changes)||changes.length>ZONE_CHANGE_LIMIT)fail('Too many changes at once.');
  const ids=new Set();
  for(const change of changes){
    if(!change||typeof change!=='object'||typeof change.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(change.id)||ids.has(change.id))fail('Invalid furniture.');
    if(change.removed!==undefined){if(change.removed!==true||Object.keys(change).length!==2)fail('Invalid furniture.');}
    else if(Object.keys(change).some(key=>!FIELDS.includes(key)))fail('Invalid furniture.');
    ids.add(change.id);
  }
  const before=new Map();
  for(const id of ids){const doc=await itemDoc(ctx,id);if(doc)before.set(id,doc);}
  // Every zone a changed piece leaves or enters is checked whole.
  const zones=new Set();
  for(const change of changes){
    const old=before.get(change.id);if(old&&old.zone!==INVENTORY)zones.add(old.zone);
    if(!change.removed){const zone=itemZone(layout,change);if(zone!==INVENTORY)zones.add(zone);}
  }
  const lists=new Map();
  for(const zone of zones)lists.set(zone,(await zoneItems(ctx,zone)).filter(item=>!ids.has(item.id)));
  const after=new Map();
  for(const change of changes){
    if(change.removed)continue;
    const item=normalizeItem(change),zone=itemZone(layout,item);
    after.set(item.id,item);
    if(zone!==INVENTORY)lists.get(zone).push(item);
  }
  // A piece left on a table that is gone or picked up goes back to its owner's hands.
  for(const [zone,list] of lists){
    const healed=healOrphans(list);
    for(let i=0;i<list.length;i++)if(healed[i]!==list[i]){
      const item=healed[i];ids.add(item.id);after.set(item.id,item);
      if(!before.has(item.id)){const doc=await itemDoc(ctx,item.id);if(doc)before.set(item.id,doc);}
    }
    lists.set(zone,healed.filter(isPlaced));
  }
  const definitions=await definitionsFor(ctx,[...[...lists.values()].flat(),...after.values()]);
  if(!admin){
    const previous=[...ids].map(id=>before.get(id)).filter(Boolean).map(docItem),next=[...ids].map(id=>after.get(id)).filter(Boolean);
    try{assertOwnedChanges(previous,next,player._id,definitions,ownSpaceCheck(room.options,room.spaces??[],player._id,definitions));}catch(error){fail(error.message);}
    const mine=await ownedItems(ctx,player._id);
    const placed=mine.filter(item=>!ids.has(item.id)&&isPlaced(item)).length+next.filter(item=>item.owner===player._id&&isPlaced(item)).length;
    if(placed>PLACED_LIMIT_PER_PLAYER)fail(`You can place up to ${PLACED_LIMIT_PER_PLAYER} pieces.`);
  }
  validateFurniture([...after.values()].filter(item=>!isPlaced(item)),room.options,definitions,room.spaces??[],INVENTORY);
  for(const [zone,list] of lists)validateFurniture(list,room.options,definitions,room.spaces??[],zone);
  // Write only what differs; remember which zones' floors changed.
  const onFloor=(item,zone)=>!!item&&zone!==INVENTORY&&isPlaced(item)&&!isWallItem(definitions[item.type]);
  const floorChanged=new Set();
  for(const id of ids){
    const old=before.get(id),item=after.get(id);
    if(old&&onFloor(docItem(old),old.zone))floorChanged.add(old.zone);
    if(old&&!item){await ctx.db.delete(old._id);continue;}
    if(!item)continue;
    const next=record(layout,item);
    if(onFloor(item,next.zone))floorChanged.add(next.zone);
    if(old){if(sameItem(docItem(old),item)&&old.zone===next.zone)continue;await ctx.db.patch(old._id,fields(next));}
    else await ctx.db.insert('furniture',next);
  }
  for(const zone of floorChanged)await displacePlayers(ctx,room,zone,lists.get(zone)??[],definitions,ids);
  return {zones:[...zones]};
}
// Anyone standing in, or walking into, a piece that just arrived steps to the nearest free tile,
// and anyone sitting on a piece that changed stands up.
async function displacePlayers(ctx,room,zone,items,definitions,changed){
  const view={...room,furniture:items,definitions},now=Date.now(),players=await zonePlayers(ctx,zone,now);
  const occupied=new Set();
  for(const p of players){
    const at=atTime(p,now),end=p.route.at(-1),seatChanged=!!p.seatId&&p.seatId!=='pit'&&changed.has(p.seatId);
    const stuck=seatChanged||blocked(view,Math.floor(at.x),Math.floor(at.z))||blocked(view,Math.floor(end.x),Math.floor(end.z));
    if(!stuck){occupied.add(`${Math.floor(end.x)},${Math.floor(end.z)}`);continue;}
    const pos=freePosition(view,at,occupied,zone);occupied.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);
    await ctx.db.patch(p._id,{route:[pos],startedAt:now,seatId:null,action:null});
  }
}
// The old whole-list protocol, kept for tests and for tabs from before zones: the list stands
// for the lobby, the player's own hands and whichever spaces it places into, and is turned into
// the changes that get those there. Zones the list never mentions are left alone, so a tab that
// only ever saw the lobby cannot sweep a space clean. A client from before built pieces existed
// (no `knowsAssets`) dropped them as unknown types; those stay too.
export async function changesFromList(ctx,room,player,items,knowsAssets=true){
  const admin=player.role==='admin',layout=layoutFor(room.options,room.spaces??[]);
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'))fail('Invalid furniture.');
  const zones=new Set([MAIN_ZONE,...items.map(item=>itemZone(layout,item)).filter(zone=>zone!==INVENTORY)]);
  const current=[...(await Promise.all([...zones].map(zone=>zoneItems(ctx,zone)))).flat(),...await inventoryItems(ctx,player._id,admin)];
  const sent=new Map(items.map(item=>[item.id,item])),changes=[];
  for(const item of items){const old=current.find(c=>c.id===item.id);if(!old||!sameItem(old,item))changes.push(item);}
  for(const old of current)if(!sent.has(old.id)&&(admin||isPlaced(old)||old.owner===player._id)&&(knowsAssets||!old.type.startsWith('asset_')))changes.push({id:old.id,removed:true});
  return changes;
}
// Every piece in the world, for the rare admin-wide operations (reshaping the room, seeding).
export async function allItems(ctx){return (await ctx.db.query('furniture').collect()).map(docItem);}
// Replace the world's furniture outright (admin only), re-zoning every piece.
export async function replaceAll(ctx,room,items){
  const layout=layoutFor(room.options,room.spaces??[]);
  const existing=await ctx.db.query('furniture').collect(),keep=new Map(items.map(item=>[item.id,item]));
  for(const doc of existing){
    const item=keep.get(doc.id);
    if(!item){await ctx.db.delete(doc._id);continue;}
    const next=record(layout,item);keep.delete(doc.id);
    if(sameItem(docItem(doc),item)&&doc.zone===next.zone)continue;
    await ctx.db.patch(doc._id,fields(next));
  }
  for(const item of keep.values())await ctx.db.insert('furniture',record(layout,item));
}
// Slide the placed pieces of some zones along x (a resized space moves the ones after it).
export async function shiftItems(ctx,nextLayout,zones,shouldShift,delta){
  for(const zone of new Set(zones))for(const doc of await ctx.db.query('furniture').withIndex('by_zone',q=>q.eq('zone',zone)).collect()){
    if(!isPlaced(doc)||!shouldShift(doc))continue;
    const x=doc.x+delta;await ctx.db.patch(doc._id,{x,zone:zoneAt(nextLayout,x,doc.z)});
  }
}
