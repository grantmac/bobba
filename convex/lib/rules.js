import {ConvexError} from 'convex/values';
import {choices as appearanceChoices,colors as appearanceColors} from './appearance.js';
import {shapes,wallColors,floorColors,furniture} from './catalog.js';
import {canPlace,isWallItem,canHang,takesFloor} from '../../shared/furniture-model.js';
import {roomLayout,tileDrop,pitSeat,backWallTiles,onWalkway,zoneAt,zoneTiles,zoneTileSet,MAIN_ZONE,ZONE_CAP} from '../../shared/room-layout.js';
import {SPACE_LIMIT,SPACES_PER_PLAYER,SPACE_SIZE,SPACE_NAME_MAX,SPACE_FLOORS,SPACE_WALLS,SPACE_FITS,isHexColor} from '../../shared/spaces.js';
export {pitSeat,zoneAt,MAIN_ZONE,ZONE_CAP};
export const isOnline=(player,now=Date.now())=>!!player&&(player.online??player.lastSeen>now-45000);
// Everyone online, world-wide: only for rare admin-wide operations, never a hot path.
export async function onlinePlayers(ctx,now,limit=50){
  const live=await ctx.db.query('players').withIndex('by_online',q=>q.eq('online',true)).take(limit);
  if(live.length>=limit)return live;
  const legacy=await ctx.db.query('players').withIndex('by_online',q=>q.eq('online',undefined).gt('lastSeen',now-45000)).take(limit-live.length);
  return [...live,...legacy];
}
// The players in one zone. `online` is undefined between joining and the first heartbeat, so
// an arriving player counts while recently seen. Reading one zone's index range means a move
// elsewhere in the world never wakes this zone's subscribers.
export async function zonePlayers(ctx,zone,now,limit=ZONE_CAP+1){
  const live=await ctx.db.query('players').withIndex('by_zone',q=>q.eq('zone',zone).eq('online',true)).take(limit);
  if(live.length>=limit)return live;
  const arriving=await ctx.db.query('players').withIndex('by_zone',q=>q.eq('zone',zone).eq('online',undefined).gt('lastSeen',now-45000)).take(limit-live.length);
  return [...live,...arriving];
}
// The players in several zones at once, without duplicates.
export async function zonesPlayers(ctx,zones,now){
  const seen=new Map();
  for(const zone of new Set(zones))for(const p of await zonePlayers(ctx,zone,now))seen.set(p._id,p);
  return [...seen.values()];
}
export const playerZone=player=>player.zone??MAIN_ZONE;
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
export function cells(item,defs=furniture){
  const def=defs[item.type],swap=item.rotation%4===2,w=swap?def.depth:def.width,d=swap?def.width:def.depth;
  return Array.from({length:w*d},(_,i)=>[item.x+i%w,item.z+Math.floor(i/w)]);
}
export const layoutFor=(options,spaces=[])=>roomLayout(shapes[options.shape],spaces);
// Walls that stickies and posters can use: the main room and the dance terrace.
export function wallTileSet(options){const layout=layoutFor(options);return new Set([...layout.mainTiles,...layout.danceTiles].map(t=>t.join(',')));}
// Walls that furniture can hang on: those plus the back wall behind the lounge and any added spaces.
export function hangingWallTileSet(options,spaces=[]){const layout=layoutFor(options,spaces);return new Set([...layout.mainTiles,...layout.danceTiles,...backWallTiles(layout)].map(t=>t.join(',')));}
export function tileSet(options,spaces=[]){return layoutFor(options,spaces).tileSet;}
export function wallChecker(options,spaces=[]){
  const walls=hangingWallTileSet(options,spaces),tiles=tileSet(options,spaces);
  return (x,z,side)=>walls.has(`${x},${z}`)&&!tiles.has(side==='left'?`${x-1},${z}`:`${x},${z-1}`);
}
export function blocked(room,x,z,ignore=null){
  const defs=room.definitions??furniture;
  return room.furniture.some(i=>i.id!==ignore&&isPlaced(i)&&takesFloor(defs[i.type])&&cells(i,defs).some(([a,b])=>a===x&&b===z));
}
// Where furniture may stand, as 'x,z' keys: the lounge, the pool water and the walkway stay clear.
// Given a zone, only that zone's share, so a zone's pieces are checked against its own tiles.
export function placeableTiles(layout,zone=null){
  const all=zone===null?[...layout.mainTiles,...layout.danceTiles,...layout.poolDeckTiles,...layout.parkingTiles,...layout.spaceTiles]:zone===MAIN_ZONE?[...layout.mainTiles,...layout.danceTiles,...layout.poolDeckTiles,...layout.parkingTiles]:zoneTiles(layout,zone);
  return new Set(all.map(cell=>cell.join(',')));
}
// Not a per-player cap: a guard on how much one zone is asked to check at once. Floor pieces are
// bounded by tiles anyway; only wall and tabletop pieces can pile up.
export const ZONE_PIECE_LIMIT=1000;
// `items` is a complete list for one zone (or the whole room when zone is null): collisions and
// tabletop checks are exact because a piece never straddles two zones.
export function validateFurniture(items,options,defs=furniture,spaces=[],zone=null){
  if(items.length>ZONE_PIECE_LIMIT)fail(`${zone===null?'The room':'A space'} can hold up to ${ZONE_PIECE_LIMIT} pieces.`);
  const ids=new Set(),occupied=new Set(),rugs=new Set(),layout=layoutFor(options,spaces),tiles=placeableTiles(layout,zone),hasWall=wallChecker(options,spaces);
  for(const item of items){
    if(!item||Object.keys(item).some(key=>!['id','type','rotation','x','z','supportId','on','u','height','owner'].includes(key))||!['id','type','rotation','x','z'].every(key=>Object.hasOwn(item,key))||typeof item.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(item.id)||ids.has(item.id))fail('Invalid furniture.');
    if(item.on!==undefined&&(typeof item.on!=='boolean'||!(item.type==='custom_dj_decks'||defs[item.type]?.switchable)))fail('Invalid furniture power setting.');
    if(item.owner!==undefined&&(typeof item.owner!=='string'||!item.owner))fail('Invalid furniture owner.');
    ids.add(item.id);const def=defs[item.type];
    if(!def||!def.views.some(v=>v.direction===item.rotation))fail('Invalid furniture type or rotation.');
    if(!isWallItem(def)&&(item.u!==undefined||item.height!==undefined))fail('Invalid furniture: only wall pieces have a wall position.');
    if(item.x===null&&item.z===null){if(item.supportId!==undefined||item.u!==undefined||item.height!==undefined)fail('Inventory items cannot be on a table or wall.');continue;}
    if(!isPlaced(item))fail('Invalid furniture position.');
    if(isWallItem(def)){if(item.supportId!==undefined||!canHang(item,def,hasWall))fail('Wall pieces must hang on a continuous section of wall.');if(zone!==null&&zoneAt(layout,item.x,item.z)!==zone)fail('Wall pieces must hang in the space they belong to.');continue;}
    if(new Set(cells(item,defs).map(([x,z])=>tileDrop(layout,x,z))).size>1)fail('Furniture cannot straddle the step.');
    if(new Set(cells(item,defs).map(([x,z])=>zoneAt(layout,x,z))).size>1)fail('Furniture cannot straddle two spaces.');
    if(item.supportId!==undefined){if(typeof item.supportId!=='string'||!item.supportId)fail('Invalid furniture support.');continue;}
    const target=def.category==='Rugs'?rugs:occupied;
    for(const cell of cells(item,defs)){const key=cell.join(',');if(onWalkway(layout,...cell))fail('The walkway in front of the spaces stays clear of furniture.');if(!tiles.has(key)||target.has(key))fail('Furniture must fit in a free floor space.');target.add(key);}
  }
  const definitions=new Map(Object.entries(defs));
  for(const item of items.filter(i=>i.supportId)){
    if(!canPlace(item,items,definitions,(x,z)=>tiles.has(`${x},${z}`)))fail('Items must fit on a free tabletop.');
  }
}
// A block of floor a player adds through their agent. Its position follows from the chain order.
export function validateSpace(space,spaces,playerId,isAdmin=false){
  if(spaces.length>=SPACE_LIMIT)fail(`The room can take up to ${SPACE_LIMIT} added spaces.`);
  if(!isAdmin&&spaces.filter(s=>s.owner===playerId).length>=SPACES_PER_PLAYER)fail(`You can add up to ${SPACES_PER_PLAYER} space${SPACES_PER_PLAYER===1?'':'s'}; remove yours first to add another.`);
  const name=validSpaceName(space.name),floor=space.floor??'carpet',floorColor=space.floorColor??floorColors[0];
  if(!SPACE_FLOORS.includes(floor))fail(`Floor must be one of ${SPACE_FLOORS.join(', ')}.`);
  if(!isHexColor(floorColor))fail('Floor colour must be a hex colour like #b59232.');
  return {name,width:SPACE_SIZE,depth:SPACE_SIZE,floor,floorColor:floorColor.toLowerCase()};
}
function validSpaceName(raw){
  const name=String(raw??'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(name.length<1||name.length>SPACE_NAME_MAX||/[^\p{L}\p{N} '&.,!-]/u.test(name))fail(`Name the space with 1 to ${SPACE_NAME_MAX} letters, numbers, spaces or basic punctuation.`);
  return name;
}
// A piece left pointing at a table that is no longer in the room goes back to its owner's
// inventory, so one stranded piece can never block every save with a failed tabletop check.
export function healOrphans(items){
  const placed=new Set(items.filter(i=>isPlaced(i)&&!i.supportId).map(i=>i.id));
  return items.map(item=>{if(!item.supportId||placed.has(item.supportId))return item;const next={...item,x:null,z:null};delete next.supportId;return next;});
}
// Builders may put their pieces only in their own spaces: floor pieces (and what sits on their
// tables) on those tiles, wall pieces on that stretch of the back wall. Pieces placed before the
// rule stay where they are until moved. Grant builds anywhere.
export function ownSpaceCheck(options,spaces,playerId,defs){
  const mine=layoutFor(options,spaces).spaces.filter(s=>s.owner===playerId),tiles=new Set(mine.flatMap(s=>s.tiles.map(c=>c.join(','))));
  return {hasSpace:mine.length>0,within:item=>{const def=defs[item.type];return !!def&&(isWallItem(def)?item.z===0&&tiles.has(`${item.x},0`):cells(item,defs).every(c=>tiles.has(c.join(','))));}};
}
// Restyle a space: only the fields given change, and null clears a wall choice or a picture. Picture
// uploads are checked by the mutation; here they are already storage ids.
export function validateSpaceStyle(patch,space){
  const next={...space};
  if(patch.name!==undefined)next.name=validSpaceName(patch.name);
  if(patch.floor!==undefined){if(!SPACE_FLOORS.includes(patch.floor))fail(`Floor must be one of ${SPACE_FLOORS.join(', ')}.`);next.floor=patch.floor;}
  if(patch.floorColor!==undefined){if(!isHexColor(patch.floorColor))fail('Floor colour must be a hex colour like #b59232.');next.floorColor=patch.floorColor.toLowerCase();}
  if(patch.wall===null)delete next.wall;else if(patch.wall!==undefined){if(!SPACE_WALLS.includes(patch.wall))fail(`Wall must be one of ${SPACE_WALLS.join(', ')}.`);next.wall=patch.wall;}
  if(patch.wallColor===null)delete next.wallColor;else if(patch.wallColor!==undefined){if(!isHexColor(patch.wallColor))fail('Wall colour must be a hex colour like #787e9c.');next.wallColor=patch.wallColor.toLowerCase();}
  for(const [image,fit] of [['floorImage','floorFit'],['wallImage','wallFit']]){
    if(patch[image]===null)delete next[image];else if(patch[image]!==undefined)next[image]=patch[image];
    if(patch[fit]!==undefined){if(!SPACE_FITS.includes(patch[fit]))fail(`Fit must be ${SPACE_FITS.join(' or ')}.`);next[fit]=patch[fit];}
    if(next[image])next[fit]??='tile';else delete next[fit];
  }
  return next;
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
    if(p._id===exclude||!isOnline(p,now))continue;
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
// The nearest free tile to a point, within one zone (the lobby by default): a player never lands
// somewhere whose furniture was not loaded.
export function freePosition(room,preferred={x:3.5,z:4.5},occupied=new Set(),zone=MAIN_ZONE){
  const layout=layoutFor(room.options,room.spaces??[]),candidates=zone===null?layout.tiles:zoneTiles(layout,zone);
  const free=candidates.filter(([x,z])=>!blocked(room,x,z)&&!occupied.has(`${x},${z}`));
  if(!free.length)fail('There is no free space for another character.');
  free.sort((a,b)=>Math.hypot(a[0]+.5-preferred.x,a[1]+.5-preferred.z)-Math.hypot(b[0]+.5-preferred.x,b[1]+.5-preferred.z));
  return {x:free[0][0]+.5,z:free[0][1]+.5};
}
// A route to a seat may cross that piece's own tiles, so a car parked against a
// wall can still be entered from whichever side is open.
// The search stays inside the zones whose furniture is loaded (`room.zones`), or the whole room.
export function findPath(room,start,end,seatId=null,occupied=new Set()){
  const seat=seatId&&room.furniture.find(item=>item.id===seatId),stools=seat&&(room.definitions??furniture)[seat.type].seat?.[seat.rotation]?.cells;
  const layout=layoutFor(room.options,room.spaces??[]),tiles=room.zones?zoneTileSet(layout,room.zones):layout.tileSet,key=p=>`${p.x},${p.z}`,origin={x:Math.floor(start.x),z:Math.floor(start.z)};
  if(!tiles.has(key(end))||occupied.has(key(end)))return null;
  const queue=[origin],parents=new Map([[key(origin),null]]);
  for(let i=0;i<queue.length&&!parents.has(key(end));i++)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const p={x:queue[i].x+dx,z:queue[i].z+dz};
    const allowed=stools&&!stools.some(([x,z])=>seat.x+x===p.x&&seat.z+z===p.z)?null:seatId;
    if(tiles.has(key(p))&&!occupied.has(key(p))&&!blocked(room,p.x,p.z,allowed)&&!parents.has(key(p))){parents.set(key(p),queue[i]);queue.push(p);}
  }
  if(!parents.has(key(end)))return null;
  const route=[];for(let p=end;p;p=parents.get(key(p)))route.unshift({x:p.x+.5,z:p.z+.5});
  if(Math.hypot(route[0].x-start.x,route[0].z-start.z)<.001)route.shift();
  return [start,...route];
}
