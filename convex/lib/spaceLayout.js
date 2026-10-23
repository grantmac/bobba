import {fail,layoutFor,atTime,zoneAt,MAIN_ZONE,isPlaced,findPath,zonesPlayers,playerTiles} from './rules.js';
import {loadZones} from './furnitureStore.js';
import {SPACE_LEVELS} from '../../shared/spaces.js';
import {tileDrop} from '../../shared/room-layout.js';

// Layout edits are atomic with their contents. Translate by each space's own delta,
// including wall pieces and tabletop children, and stop walks that use changed tiles.
export async function applySpaceLayout(ctx,room,spaces){
  const before=layoutFor(room.options,room.spaces??[]),after=layoutFor(room.options,spaces),now=Date.now();
  const changes=new Map();
  for(const old of before.spaces){
    const next=after.spaces.find(s=>s.id===old.id);
    if(next&&(next.x!==old.x||next.z!==old.z))changes.set(old.id,{dx:next.x-old.x,dz:next.z-old.z});
  }
  for(const [zone,{dx,dz}] of changes)for(const doc of await ctx.db.query('furniture').withIndex('by_zone',q=>q.eq('zone',zone)).collect()){
    if(isPlaced(doc))await ctx.db.patch(doc._id,{x:doc.x+dx,z:doc.z+dz});
  }
  const translate=p=>{
    const delta=changes.get(zoneAt(before,p.x,p.z));
    return delta?{x:p.x+delta.dx,z:p.z+delta.dz}:p;
  };
  const changed=p=>{
    const x=Math.floor(p.x),z=Math.floor(p.z);
    return changes.has(zoneAt(before,x,z))||!after.tileSet.has(`${x},${z}`)||zoneAt(before,x,z)!==zoneAt(after,x,z)||tileDrop(before,x,z)!==tileDrop(after,x,z);
  };
  // Includes saved/offline characters, whose next resume must use the new coordinates.
  const zones=[undefined,MAIN_ZONE,...before.spaces.map(s=>s.id)],seen=new Set();
  for(const zone of zones)for(const player of await ctx.db.query('players').withIndex('by_zone',q=>q.eq('zone',zone)).collect()){
    if(seen.has(player._id))continue;seen.add(player._id);
    if(!player.route.some(changed))continue;
    const current=atTime(player,now);let point=translate(current),seatId=player.seatId;
    if(!after.tileSet.has(`${Math.floor(point.x)},${Math.floor(point.z)}`)||(!changes.has(zoneAt(before,current.x,current.z))&&changed(current))){
      // A shortened walkway or a removed tier returns its occupants to the nearest
      // protected walkway tile. These tiles cannot hold furniture.
      const tiles=after.walkwayTiles.length?after.walkwayTiles:before.loungeTiles;
      const nearest=tiles.reduce((a,b)=>Math.hypot(b[0]+.5-point.x,b[1]+.5-point.z)<Math.hypot(a[0]+.5-point.x,a[1]+.5-point.z)?b:a);
      point={x:nearest[0]+.5,z:nearest[1]+.5};seatId=null;
    }
    const end=player.route.at(-1);
    if(current.x!==end.x||current.z!==end.z)seatId=null;
    let route=[point];
    const target=translate(end),from=zoneAt(after,point.x,point.z),to=zoneAt(after,target.x,target.z);
    if(current.x!==end.x||current.z!==end.z){
      const world=await loadZones(ctx,{...room,spaces},[from,to,MAIN_ZONE]);
      const occupied=playerTiles(await zonesPlayers(ctx,world.zones,now),now,player._id);
      route=findPath(world,point,{x:Math.floor(target.x),z:Math.floor(target.z)},player.seatId,occupied)??route;
      if(route.length>1)seatId=player.seatId;
    }
    await ctx.db.patch(player._id,{route,startedAt:now,seatId,zone:route.length>1?to:from});
  }
  const stickies=(room.stickies??[]).map(s=>({...s,...translate(s)}));
  await ctx.db.patch(room._id,{spaces,stickies,revision:room.revision+1});
  return after;
}

export async function moveSpaceLevel(ctx,room,player,spaceId,level){
  if(!SPACE_LEVELS.includes(level))fail('Choose the upper, middle, or lower level.');
  const spaces=room.spaces??[],index=spaces.findIndex(s=>s.id===spaceId);
  if(index<0)fail('That space is no longer available.');
  if(spaces[index].owner!==player._id&&player.role!=='admin')fail('That space is not yours.');
  if((spaces[index].level??0)===level)return {spaceId,level};
  await applySpaceLayout(ctx,room,spaces.map((s,i)=>i===index?{...s,level}:s));
  return {spaceId,level};
}
