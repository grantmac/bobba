import {mutation,query,internalMutation,internalQuery} from './_generated/server.js';
import {v} from 'convex/values';
import {DEFAULT_ROOM,isOnline,onlinePlayers,zonePlayers,zonesPlayers,playerZone,MAIN_ZONE,ZONE_CAP,zoneAt,fail,validName,validateLook,validateRoom,validateFurniture,tileSet,wallTileSet,wallChecker,isPlaced,cells,atTime,freePosition,findPath,playerTiles,layoutFor,pitSeat} from './lib/rules.js';
import {internal} from './_generated/api.js';
import {POSTERS,STICKY_COLORS,STICKY_LIMIT,STICKY_TEXT_LIMIT,validWallPosition,validPosterPosition,relocateStickies} from '../shared/stickies.js';
import {seatFor,isWallItem,canHang} from '../shared/furniture-model.js';
import {openVisit,closeVisits,closeStaleVisits} from './lib/visits.js';
import {definitionsFor} from './lib/assets.js';
import {loadZones,zoneItems,inventoryItems,itemDoc,applyChanges,changesFromList,allItems,replaceAll,ZONE_CHANGE_LIMIT} from './lib/furnitureStore.js';
import {queueBotEvent} from './lib/bot_events.js';
const SESSION_AGE=30*24*60*60*1000,ADMIN_AGE=12*60*60*1000;
// A guest name frees up this long after its holder was last seen; Grant is reserved for good.
const NAME_REUSE_AFTER=4*60*60*1000;
const CHAT_WINDOW=30;
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function validToken(token){if(!/^[a-f0-9]{64}$/.test(token))fail('Please enter the room again.');}
export async function sessionFor(ctx,token){
  validToken(token);const digest=await hash(token);
  const session=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!session||session.expiresAt<Date.now())fail('Your session has ended. Please enter the room again.');
  if((session.blockedUntil??0)>Date.now())fail('You have been removed from the room for 10 minutes. Please return later.');
  return session;
}
export async function playerFor(ctx,token,admin=false){
  const session=await sessionFor(ctx,token);
  const player=await ctx.db.get(session.playerId);
  if(!player)fail('Please enter the room again.');
  if(admin&&player.role!=='admin')fail('Only Grant can edit the room.');
  return player;
}
async function notifyArrival(ctx,player,now,pageOrigin){
  if(!['https://chat.grantm.ac','https://habbo-room.vercel.app'].includes(pageOrigin))return;
  if(player.role==='admin'||!process.env.NTFY_TOPIC||(player.lastJoinAlertAt!==undefined&&now-player.lastJoinAlertAt<60000))return;
  await ctx.db.patch(player._id,{lastJoinAlertAt:now});
  await ctx.scheduler.runAfter(0,internal.notifications.roomJoin,{name:player.name});
}
// The world map (shape, spaces, notes). With `zones`, the furniture of those zones comes too,
// with the catalogue definitions those pieces need, so the placement rules can run on it.
async function getRoom(ctx,zones=null){
  const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
  if(room&&zones)await loadZones(ctx,room,zones);
  return room;
}
async function roomFor(ctx){
  let room=await getRoom(ctx);
  if(!room){const id=await ctx.db.insert('rooms',{key:'main',options:DEFAULT_ROOM,revision:0});room=await ctx.db.get(id);}
  // A room from before zones still carries its furniture in the map: move it over once.
  if(room.furniture?.length)await ctx.scheduler.runAfter(0,internal.migrate.furniture,{});
  return room;
}
// Lobby-wide switches live apart from the map, so a drink never re-sends the map to everyone.
async function signalsFor(ctx){
  const doc=await ctx.db.query('signals').withIndex('by_key',q=>q.eq('key','main')).unique();
  if(doc)return doc;
  const room=await getRoom(ctx);
  return {key:'main',danceFloorOn:room?.danceFloorOn,fridge:room?.fridge};
}
async function patchSignals(ctx,patch){
  const doc=await ctx.db.query('signals').withIndex('by_key',q=>q.eq('key','main')).unique();
  if(doc)await ctx.db.patch(doc._id,patch);
  else{const room=await getRoom(ctx);await ctx.db.insert('signals',{key:'main',danceFloorOn:room?.danceFloorOn,fridge:room?.fridge,...patch});}
}
const publicSignals=s=>({danceFloorOn:s.danceFloorOn??true,fridge:s.fridge??null});
// What others see of a player. Movement updates leave the appearance out: it travels once, by
// `look`, whenever `lookVersion` changes. Legacy callers still get it inline.
export function publicPlayer(p,withLook=false){
  return {id:p._id,name:p.name,role:p.role,...(p.kind?{kind:p.kind}:{}),...(withLook?{look:p.look}:{}),lookVersion:p.lookVersion??0,zone:playerZone(p),route:p.route,startedAt:p.startedAt,direction:p.direction,seatId:p.seatId,action:p.action??null,actionStarted:p.actionStarted??0,drink:p.drink??null,typingUntil:p.typingUntil??0};
}
const publicMessage=({_id,name,color,body,mode,x,z,sentAt,playerId,zone})=>({id:_id,name,color,body,mode,x,z,sentAt,playerId,zone:zone??MAIN_ZONE});
async function checkEntryCode(code){
  if(!code||code.length>200||!process.env.GRANT_ENTRY_HASH||!equal(await hash(code),process.env.GRANT_ENTRY_HASH))fail('This private entry link is not valid.');
}
export const entryAppearance=query({args:{entryCode:v.string()},handler:async(ctx,{entryCode})=>{
  await checkEntryCode(entryCode);
  const player=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey','grant')).unique();
  return player?.look??null;
}});
// This is a preview; join checks again atomically before assigning the name.
export const checkName=query({args:{name:v.string(),entryCode:v.optional(v.string())},handler:async(ctx,{name,entryCode})=>{
  const named=validName(name);
  if(entryCode){await checkEntryCode(entryCode);return;}
  if(named.key==='grant')fail('That name is reserved. Please choose another name.');
  const player=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey',named.key)).unique();
  if(player?.kind==='bot')fail('That name is reserved for the room bot.');
  if(player?.savedAt&&!entryCode)fail('That name belongs to a saved character. Use your room key or choose another name.');
  if((player?.blockedUntil??0)>Date.now())fail('You have been removed from the room for 10 minutes. Please return later.');
  if(player&&(isOnline(player)||Date.now()-player.lastSeen<NAME_REUSE_AFTER))fail('That name is already taken. Please choose another name.');
}});
export const join=mutation({args:{token:v.string(),name:v.string(),look:v.any(),entryCode:v.optional(v.string()),replaceLook:v.optional(v.boolean()),pageOrigin:v.optional(v.string())},handler:async(ctx,args)=>{
  validToken(args.token);validateLook(args.look);const named=validName(args.name),digest=await hash(args.token);
  const oldSession=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(oldSession){const p=await playerFor(ctx,args.token);if(p.name.toLowerCase()!==named.key)fail('Please start a new session.');return publicPlayer(p,true);}
  let admin=false;
  if(args.entryCode){
    await checkEntryCode(args.entryCode);
    admin=true;
  }
  if(!admin&&named.key==='grant')fail('That name is reserved. Please choose another name.');
  const key=admin?'grant':named.key;
  let player=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey',key)).unique();
  if(player?.kind==='bot')fail('That name is reserved for the room bot.');
  if((player?.blockedUntil??0)>Date.now())fail('You have been removed from the room for 10 minutes. Please return later.');
  if(player?.savedAt&&!admin)fail('That name belongs to a saved character. Use your room key or choose another name.');
  const now=Date.now();
  if(player&&!admin){
    if(isOnline(player,now)||now-player.lastSeen<NAME_REUSE_AFTER)fail('That name is already taken. It frees up four hours after its last visit.');
    // Retire the unsaved identity; never transfer its belongings or memories to a newcomer.
    for(const s of await ctx.db.query('sessions').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(s._id);
    for(const c of await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(c._id);
    for(const link of await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(link._id);
    await closeVisits(ctx,player._id,now);
    await ctx.db.patch(player._id,{nameKey:`retired:${player._id}`,online:false,identityVersion:(player.identityVersion??0)+1});
    player=null;
  }
  // Everyone enters through the lobby, which holds a bounded crowd like any other zone.
  const lobby=await zonePlayers(ctx,MAIN_ZONE,now);
  if(lobby.length>=ZONE_CAP&&!lobby.some(p=>p._id===player?._id))fail('The room is full. Please try again shortly.');
  const room=await roomFor(ctx);await loadZones(ctx,room,[MAIN_ZONE]);
  const occupied=playerTiles(lobby,now,player?._id);
  const position=freePosition(room,player&&playerZone(player)===MAIN_ZONE?atTime(player,now):undefined,occupied,MAIN_ZONE);
  let playerId;
  const newLook=!player||args.replaceLook;
  if(player){
    playerId=player._id;
    await ctx.db.patch(playerId,{online:undefined,zone:MAIN_ZONE,look:newLook?args.look:player.look,...(newLook?{lookVersion:(player.lookVersion??0)+1}:{}),lastSeen:now,route:[position],startedAt:now,seatId:null,drink:null,typingUntil:0,action:null});
  }else playerId=await ctx.db.insert('players',{name:admin?'Grant':named.name,nameKey:key,role:admin?'admin':'guest',look:args.look,lookVersion:0,zone:MAIN_ZONE,route:[position],startedAt:now,direction:2,seatId:null,drink:null,lastSeen:now,lastChat:0});
  await ctx.db.insert('sessions',{role:admin?'admin':'guest',tokenHash:digest,playerId,expiresAt:now+(admin?ADMIN_AGE:SESSION_AGE)});
  await ctx.scheduler.runAfter(45000,internal.room.expireArrival,{playerId,seenAt:now});
  const joined=await ctx.db.get(playerId);
  await openVisit(ctx,joined,now);
  await notifyArrival(ctx,joined,now,args.pageOrigin);
  await queueBotEvent(ctx,joined,'arrival');
  return publicPlayer(joined,true);
}});
// Spaces as clients see them: uploaded pictures become URLs and the storage ids stay server-side.
export async function publicSpaces(ctx,room){
  return Promise.all((room?.spaces??[]).map(async({floorImage,wallImage,...space})=>({...space,
    ...(floorImage?{floorImageUrl:await ctx.storage.getUrl(floorImage)}:{}),...(wallImage?{wallImageUrl:await ctx.storage.getUrl(wallImage)}:{})})));
}
async function publicMap(ctx,room){
  return {revision:room?.revision??0,options:room?.options??DEFAULT_ROOM,spaces:await publicSpaces(ctx,room),stickies:room?.stickies??[]};
}
// Public visitors watch the lobby before choosing a character: its map, switches, furniture and people.
export const preview=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx),now=Date.now();
  const players=await zonePlayers(ctx,MAIN_ZONE,now);
  return {serverTime:now,room:{...publicSignals(await signalsFor(ctx)),...await publicMap(ctx,room),furniture:await zoneItems(ctx,MAIN_ZONE)},players:players.map(p=>publicPlayer(p,true))};
}});
// Who is in a zone. Without a zone (tabs from before zones) it is the lobby, appearances included.
export const presence=query({args:{zone:v.optional(v.string())},handler:async(ctx,{zone})=>{
  const now=Date.now(),players=await zonePlayers(ctx,zone??MAIN_ZONE,now);
  return {serverTime:now,zone:zone??MAIN_ZONE,players:players.map(p=>publicPlayer(p,zone===undefined))};
}});
// One player's appearance, fetched when their lookVersion changes rather than sent with every move.
export const look=query({args:{id:v.id('players')},handler:async(ctx,{id})=>{
  const p=await ctx.db.get(id);if(!p)return null;
  return {look:p.look,lookVersion:p.lookVersion??0};
}});
// The last few messages said in a zone (the player's own zone when none is given).
export const chatFeed=query({args:{token:v.string(),zone:v.optional(v.string())},handler:async(ctx,{token,zone})=>{
  const session=await sessionFor(ctx,token);
  if(zone===undefined)zone=playerZone(await ctx.db.get(session.playerId));
  const messages=await ctx.db.query('messages').withIndex('by_zone_time',q=>q.eq('zone',zone)).order('desc').take(CHAT_WINDOW);
  return messages.reverse().map(publicMessage);
}});
export const scene=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx);
  return {...publicSignals(await signalsFor(ctx)),...await publicMap(ctx,room),furniture:await zoneItems(ctx,MAIN_ZONE)};
}});
export const session=query({args:{token:v.string()},handler:async(ctx,{token})=>({id:(await sessionFor(ctx,token)).playerId})});
export const me=query({args:{token:v.string()},handler:async(ctx,{token})=>publicPlayer(await playerFor(ctx,token),true)});
export const voiceIdentity=internalQuery({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  if(!isOnline(player))fail('Enter the room before joining voice.');
  return {playerId:player._id,zone:playerZone(player)};
}});
// Remember every issued tab identity, including disconnected tabs, so moderation can revoke them.
export const registerVoice=internalMutation({args:{token:v.string(),identity:v.string()},handler:async(ctx,{token,identity})=>{
  const player=await playerFor(ctx,token);
  if(!isOnline(player))fail('Enter the room before joining voice.');
  if(identity!==player._id&&!identity.startsWith(`${player._id}#`))fail('Invalid voice identity.');
  const old=await ctx.db.query('voiceGrants').withIndex('by_identity',q=>q.eq('identity',identity)).unique();
  const expiresAt=Date.now()+12*3600000;
  if(old)await ctx.db.patch(old._id,{expiresAt});else await ctx.db.insert('voiceGrants',{playerId:player._id,identity,expiresAt});
}});
// The map on its own subscription: it changes only when the room is reshaped or a space is
// added, restyled or resized, so neither movement nor furniture re-sends it.
export const roomMap=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  await sessionFor(ctx,token);return await publicMap(ctx,await getRoom(ctx));
}});
export const signals=query({args:{},handler:async ctx=>publicSignals(await signalsFor(ctx))});
// The furniture standing in one zone. Clients subscribe to the zones they can see.
export const zoneFurniture=query({args:{token:v.string(),zone:v.string()},handler:async(ctx,{token,zone})=>{
  await sessionFor(ctx,token);return await zoneItems(ctx,zone);
}});
// The pieces a player has picked up (plus the stock ones for Grant).
export const inventory=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const session=await sessionFor(ctx,token),role=session.role??(await ctx.db.get(session.playerId))?.role;
  return await inventoryItems(ctx,session.playerId,role==='admin');
}});
// Tabs from before zones still receive the lobby's contents until their automatic update completes.
export const roomState=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const session=await sessionFor(ctx,token),role=session.role??(await ctx.db.get(session.playerId))?.role,room=await getRoom(ctx);
  return {...publicSignals(await signalsFor(ctx)),...await publicMap(ctx,room),furniture:[...await zoneItems(ctx,MAIN_ZONE),...await inventoryItems(ctx,session.playerId,role==='admin')]};
}});
export const state=query({args:{token:v.string(),presenceOnly:v.optional(v.boolean())},handler:async(ctx,{token,presenceOnly=false})=>{
  const me=await playerFor(ctx,token),now=Date.now(),zone=playerZone(me);
  const players=await zonePlayers(ctx,zone,now);
  if(!players.some(p=>p._id===me._id))players.push(me);
  const messages=await ctx.db.query('messages').withIndex('by_zone_time',q=>q.eq('zone',zone)).order('desc').take(CHAT_WINDOW);
  const room=presenceOnly?null:{...publicSignals(await signalsFor(ctx)),...await publicMap(ctx,await getRoom(ctx)),furniture:[...await zoneItems(ctx,zone),...await inventoryItems(ctx,me._id,me.role==='admin')]};
  return {serverTime:now,me:publicPlayer(me,true),players:players.map(p=>publicPlayer(p,true)),...(presenceOnly?{}:{room}),messages:messages.reverse().map(publicMessage)};
}});
export const heartbeat=mutation({args:{token:v.string(),connectionId:v.string(),pageOrigin:v.optional(v.string())},handler:async(ctx,{token,connectionId,pageOrigin})=>{
  const session=await sessionFor(ctx,token),now=Date.now();
  if(!/^[a-f0-9]{64}$/.test(connectionId))fail('Invalid connection.');
  const old=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(old&&(old.playerId!==session.playerId||!equal(old.tokenHash,await hash(token))))fail('Invalid connection.');
  // The hot path touches only a tiny connection row, never players, visits or room data.
  if(old&&old.expiryAt!==undefined&&old.lastSeen>now-45000){await ctx.db.patch(old._id,{lastSeen:now});return {serverTime:now};}
  const p=await ctx.db.get(session.playerId);if(!p)fail('Please enter the room again.');
  if(session.role===undefined)await ctx.db.patch(session._id,{role:p.role});
  const expiryAt=now+45000;
  if(old)await ctx.db.patch(old._id,{lastSeen:now,expiryAt});
  else await ctx.db.insert('connections',{connectionId,playerId:p._id,tokenHash:await hash(token),lastSeen:now,expiryAt});
  let positionUpdate={};
  if(!isOnline(p,now)){
    await openVisit(ctx,p,now);await notifyArrival(ctx,p,now,pageOrigin);
    await queueBotEvent(ctx,p,'arrival');
    // Coming back after a drop: a free tile near where they were, in the zone they were in.
    const zone=playerZone(p),room=await getRoom(ctx,[zone]),around=await zonePlayers(ctx,zone,now);
    positionUpdate={route:[freePosition(room,atTime(p,now),playerTiles(around,now,p._id),zone)],startedAt:now,seatId:null,zone};
  }
  if(p.online!==true)await ctx.db.patch(p._id,{online:true,lastSeen:now,...positionUpdate});
  await ctx.scheduler.runAfter(45000,internal.room.expireConnection,{connectionId,seenAt:now});
  return {serverTime:now};
}});
async function removeConnection(ctx,connection){
  await ctx.db.delete(connection._id);
  const remaining=await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',connection.playerId)).collect();
  if(remaining.some(c=>c.lastSeen>Date.now()-45000))return;
  await ctx.db.patch(connection.playerId,{online:false,lastSeen:Date.now()});
  await closeVisits(ctx,connection.playerId,Date.now());
}
export const expireArrival=internalMutation({args:{playerId:v.id('players'),seenAt:v.number()},handler:async(ctx,{playerId,seenAt})=>{
  const p=await ctx.db.get(playerId);
  if(p&&p.online===undefined&&p.lastSeen<=seenAt){
    await ctx.db.patch(playerId,{online:false});await closeVisits(ctx,playerId,Date.now());
  }
}});
export const disconnect=internalMutation({args:{token:v.string(),connectionId:v.string()},handler:async(ctx,{token,connectionId})=>{
  validToken(token);const connection=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(connection&&equal(connection.tokenHash,await hash(token)))await removeConnection(ctx,connection);
}});
export const expireConnection=internalMutation({args:{connectionId:v.string(),seenAt:v.number()},handler:async(ctx,{connectionId,seenAt})=>{
  const connection=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(!connection)return;
  // Ignore pre-upgrade jobs and superseded leases. One timer follows each connection.
  if(connection.expiryAt!==undefined&&connection.expiryAt!==seenAt+45000)return;
  if(connection.expiryAt===undefined){if(connection.lastSeen===seenAt)await removeConnection(ctx,connection);return;}
  const remaining=connection.lastSeen+45000-Date.now();
  if(remaining<=0){await removeConnection(ctx,connection);return;}
  await ctx.db.patch(connection._id,{expiryAt:connection.lastSeen+45000});
  await ctx.scheduler.runAfter(remaining,internal.room.expireConnection,{connectionId,seenAt:connection.lastSeen});
}});
export const leave=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const p=await playerFor(ctx,token),digest=await hash(token),session=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  await ctx.db.delete(session._id);
  const connections=await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',p._id)).collect();
  for(const connection of connections)if(connection.tokenHash===digest)await ctx.db.delete(connection._id);
  if(!connections.some(c=>c.tokenHash!==digest&&c.lastSeen>Date.now()-45000)){
    await ctx.db.patch(p._id,{online:false,lastSeen:Date.now()});await closeVisits(ctx,p._id,Date.now());
  }
}});
export const appearance=mutation({args:{token:v.string(),look:v.any()},handler:async(ctx,{token,look})=>{
  const p=await playerFor(ctx,token);validateLook(look);await ctx.db.patch(p._id,{look,lookVersion:(p.lookVersion??0)+1,lastSeen:Date.now()});
}});
// A walk loads only the zones it can pass through: where the player is, where they are going,
// and the lobby that joins everything. Entering a zone counts against its cap.
export const move=mutation({args:{token:v.string(),x:v.number(),z:v.number(),seatId:v.optional(v.string()),direction:v.optional(v.union(v.literal(0),v.literal(2),v.literal(4),v.literal(6)))},handler:async(ctx,args)=>{
  return await movePlayer(ctx,await playerFor(ctx,args.token),args);
}});
// Both human and bot movement use the same server-checked paths, seat reservations and zone caps.
export async function movePlayer(ctx,p,args){
  const now=Date.now();
  if(!Number.isInteger(args.x)||!Number.isInteger(args.z))fail('Choose a floor tile.');
  const map=await roomFor(ctx),layout=layoutFor(map.options,map.spaces??[]);
  if(!layout.tileSet.has(`${args.x},${args.z}`))fail('That tile cannot be reached.');
  const from=playerZone(p),to=zoneAt(layout,args.x,args.z);
  const room=await getRoom(ctx,[from,to,MAIN_ZONE]);
  const target={x:args.x,z:args.z};let seat=null;
  let spot=null;
  if(args.seatId){seat=room.furniture.find(i=>i.id===args.seatId&&isPlaced(i));spot=seat&&seatFor(seat,room.definitions[seat.type]);if(!spot||!spot.cells.some(([x,z])=>x===target.x&&z===target.z))fail('That seat is not available.');}
  const online=await zonesPlayers(ctx,room.zones,now);
  if(to!==from&&online.filter(other=>other._id!==p._id&&playerZone(other)===to).length>=ZONE_CAP)fail('That space is full right now.');
  if(seat&&online.some(other=>other._id!==p._id&&other.seatId===seat.id&&Math.floor(other.route.at(-1).x)===target.x&&Math.floor(other.route.at(-1).z)===target.z))fail('Someone is already using that seat.');
  const route=findPath(room,atTime(p,now),target,seat?.id,playerTiles(online,now,p._id));
  if(!route)fail('That tile cannot be reached.');
  const a=route.at(-2),b=route.at(-1),dx=a?b.x-a.x:0,dz=a?b.z-a.z:0;
  // The sunken sofa's ring tiles seat whoever stops on them, facing the middle.
  const pit=seat?null:pitSeat(layout,target.x,target.z);
  const direction=spot?.direction??pit?.direction??args.direction??(dx||dz?(Math.abs(dx)>Math.abs(dz)?(dx>0?2:6):(dz>0?4:0)):p.direction);
  const seatId=seat?.id??(pit?'pit':null);
  await ctx.db.patch(p._id,{route,startedAt:now,seatId,direction,zone:to,lastSeen:now,action:!seatId&&(p.action==='dance'||p.action==='breakdance')?p.action:null});
  return {route,startedAt:now,seatId,direction,zone:to};
}
// Fridges serve nearby players; the bar serves a player after they reach a stool.
export const takeDrink=mutation({args:{token:v.string(),id:v.string()},handler:async(ctx,{token,id})=>{
  const p=await playerFor(ctx,token),now=Date.now(),room=await getRoom(ctx,[playerZone(p)]);
  const source=room.furniture.find(i=>i.id===id&&isPlaced(i)&&['fridge','dmg_fridge','custom_bar'].includes(i.type));
  if(!source)fail('There is no fridge or bar there.');
  const at=atTime(p,now),x=Math.floor(at.x),z=Math.floor(at.z);
  if(source.type==='custom_bar'){
    const end=p.route.at(-1),spot=seatFor(source,room.definitions[source.type],at);
    if(p.seatId!==id||Math.hypot(at.x-end.x,at.z-end.z)>.001||!spot.cells.some(([cx,cz])=>cx===x&&cz===z))fail('Sit on a bar stool first.');
  }else if(!cells(source,room.definitions).some(([cx,cz])=>Math.abs(cx-x)<=1&&Math.abs(cz-z)<=1))fail('Walk up to the fridge first.');
  if(now-(p.drink??0)<800)fail('Please wait a moment.');
  await ctx.db.patch(p._id,{drink:now,lastSeen:now});
  if(source.type!=='custom_bar')await patchSignals(ctx,{fridge:{id,at:now}});
}});
export const gesture=mutation({args:{token:v.string(),action:v.union(v.literal('wave'),v.literal('dance'),v.literal('breakdance'))},handler:async(ctx,{token,action})=>{
  const p=await playerFor(ctx,token),now=Date.now(),zone=playerZone(p),room=await getRoom(ctx,[zone]);
  if(now-(p.actionStarted??0)<300)fail('Please wait a moment.');
  const online=await zonePlayers(ctx,zone,now);
  const seated=p.seatId&&atTime(p,now).x===p.route.at(-1).x&&atTime(p,now).z===p.route.at(-1).z;
  const keepSeat=action==='wave'&&seated;
  const position=keepSeat?atTime(p,now):freePosition(room,atTime(p,now),playerTiles(online,now,p._id),zone);
  await ctx.db.patch(p._id,{action:action!=='wave'&&p.action===action?null:action,actionStarted:now,route:[position],startedAt:now,seatId:keepSeat?p.seatId:null,lastSeen:now});
}});
// A short lease clears a typing bubble even if a tab loses its connection.
export const setTyping=mutation({args:{token:v.string(),typing:v.boolean()},handler:async(ctx,{token,typing})=>{
  const p=await playerFor(ctx,token),now=Date.now();
  if(typing&&!isOnline(p,now))fail('Enter the room before typing.');
  if(typing&&(p.typingUntil??0)>now+3000)return;
  if(!typing&&!p.typingUntil)return;
  await ctx.db.patch(p._id,{typingUntil:typing?now+4000:0});
}});
// A message belongs to the zone its speaker stands in, and reaches those who can see that zone.
export const chat=mutation({args:{token:v.string(),body:v.string(),mode:v.union(v.literal('Say'),v.literal('Whisper'),v.literal('Shout'))},handler:async(ctx,{token,body,mode})=>{
  const p=await playerFor(ctx,token),now=Date.now(),text=body.trim();
  if(!text||text.length>400)fail('Messages must contain 1–400 characters.');
  if(now-p.lastChat<350)fail('Please wait a moment before sending another message.');
  const position=atTime(p,now);
  const messageId=await ctx.db.insert('messages',{playerId:p._id,zone:playerZone(p),name:p.name,color:p.look.top.color,body:text,mode,...position,sentAt:now});
  await ctx.db.patch(p._id,{lastChat:now,lastSeen:now,typingUntil:0});
  await queueBotEvent(ctx,p,'chat',text,messageId);
}});
// Furniture changes arrive as the pieces that changed (each whole, or {id, removed: true}); the
// zones they touch are checked as complete lists and only those rows are written.
export const editFurniture=mutation({args:{token:v.string(),changes:v.array(v.any())},handler:async(ctx,{token,changes})=>{
  const player=await playerFor(ctx,token),room=await roomFor(ctx);
  return await applyChanges(ctx,room,player,changes);
}});
// The whole-list protocol of tabs from before zones: the list stands for the lobby and the
// player's own hands. `revision` is accepted and ignored: the map no longer counts furniture edits.
export const setFurniture=mutation({args:{token:v.string(),items:v.array(v.any()),revision:v.optional(v.number()),knowsAssets:v.optional(v.boolean())},handler:async(ctx,{token,items,knowsAssets})=>{
  const player=await playerFor(ctx,token),room=await roomFor(ctx);
  const changes=await changesFromList(ctx,room,player,items,knowsAssets!==false&&knowsAssets!==undefined);
  if(changes.length>ZONE_CHANGE_LIMIT)fail('Too many changes at once.');
  return await applyChanges(ctx,room,player,changes);
}});
export const setDanceFloor=mutation({args:{token:v.string(),on:v.boolean()},handler:async(ctx,{token,on})=>{
  await playerFor(ctx,token);await patchSignals(ctx,{danceFloorOn:on});
}});
// Power is shared, but this narrow mutation cannot move or replace furniture.
export const setDeckPower=mutation({args:{token:v.string(),id:v.string(),on:v.boolean()},handler:async(ctx,{token,id,on})=>{
  await playerFor(ctx,token);const doc=await itemDoc(ctx,id);
  const definitions=doc?await definitionsFor(ctx,[doc]):{};
  if(!doc||!isPlaced(doc)||!(doc.type==='custom_dj_decks'||definitions[doc.type]?.switchable))fail('Select a piece in the room that can be switched.');
  if((doc.on??true)===on)return;
  await ctx.db.patch(doc._id,{on});
}});
// Reshaping the room is Grant's and rare: every piece is re-checked against the new map, and
// everyone online gets a free tile in whatever zone they now stand in.
async function resettlePlayers(ctx,room){
  const now=Date.now(),layout=layoutFor(room.options,room.spaces??[]),occupied=new Set();
  for(const p of await onlinePlayers(ctx,now,200)){
    const at=atTime(p,now),zone=layout.tileSet.has(`${Math.floor(at.x)},${Math.floor(at.z)}`)?zoneAt(layout,Math.floor(at.x),Math.floor(at.z)):MAIN_ZONE;
    const pos=freePosition(room,at,occupied,zone);occupied.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);
    await ctx.db.patch(p._id,{route:[pos],startedAt:now,seatId:null,action:null,zone});
  }
}
export const setOptions=mutation({args:{token:v.string(),options:v.any(),revision:v.number()},handler:async(ctx,{token,options,revision})=>{
  await playerFor(ctx,token,true);const room=await roomFor(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');validateRoom(options);
  const spaces=room.spaces??[],tiles=tileSet(options,spaces),current=await allItems(ctx),definitions=await definitionsFor(ctx,current);
  const items=current.map(item=>isPlaced(item)&&cells(item,definitions).some(cell=>!tiles.has(cell.join(',')))?{...item,x:null,z:null}:item);
  const hasWall=wallChecker(options,spaces);
  for(const item of items){
    if(item.supportId&&(!isPlaced(item)||!items.some(table=>table.id===item.supportId&&isPlaced(table)))){item.x=null;item.z=null;delete item.supportId;}
    if(isWallItem(definitions[item.type])&&isPlaced(item)&&!canHang(item,definitions[item.type],hasWall)){item.x=null;item.z=null;delete item.u;delete item.height;}
  }
  validateFurniture(items,options,definitions,spaces);
  const next={...room,options,furniture:items,definitions};freePosition(next);
  await ctx.db.patch(room._id,{options,stickies:relocateStickies(room.stickies??[],wallTileSet(options)),revision:revision+1});
  await replaceAll(ctx,next,items);await resettlePlayers(ctx,next);
}});
const posterKind=v.union(...Object.keys(POSTERS).map(kind=>v.literal(kind)));
const wallPosition=v.object({x:v.number(),z:v.number(),side:v.union(v.literal('left'),v.literal('right')),u:v.number(),height:v.number()});
function stickyText(text){if(text.length>STICKY_TEXT_LIMIT||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))fail('Notes can contain up to 2,000 characters.');}
export const createSticky=mutation({args:{token:v.string(),id:v.string(),position:wallPosition,poster:v.optional(posterKind)},handler:async(ctx,{token,id,position,poster})=>{
  await playerFor(ctx,token,true);const room=await roomFor(ctx),notes=room.stickies??[];
  if(!/^[a-f0-9-]{36}$/.test(id))fail('Invalid note.');
  if(notes.some(n=>n.id===id))return;
  if(notes.length>=STICKY_LIMIT)fail('The room has reached its 100-note limit.');
  if(!(poster?validPosterPosition:validWallPosition)(position,wallTileSet(room.options)))fail('Place the item on a continuous section of wall.');
  await ctx.db.patch(room._id,{stickies:[...notes,{id,...position,text:'',color:STICKY_COLORS[0],revision:0,...(poster?{poster}:{})}]});
}});
export const editSticky=mutation({args:{token:v.string(),id:v.string(),revision:v.number(),text:v.string(),color:v.string(),position:v.optional(wallPosition)},handler:async(ctx,args)=>{
  await playerFor(ctx,args.token,true);const room=await roomFor(ctx),notes=room.stickies??[],note=notes.find(n=>n.id===args.id);
  if(!note)fail('This note has been removed.');
  if(note.revision!==args.revision)fail('This note changed. Close without saving and reopen it to see the latest text.');
  if(note.poster&&(args.text!==''||args.color!==note.color))fail('Poster artwork cannot be edited.');
  stickyText(args.text);if(!STICKY_COLORS.includes(args.color))fail('Invalid note colour.');
  if(args.position&&!(note.poster?validPosterPosition:validWallPosition)(args.position,wallTileSet(room.options)))fail('Place the item on a continuous section of wall.');
  await ctx.db.patch(room._id,{stickies:notes.map(n=>n.id===note.id?{...n,...args.position,text:args.text,color:args.color,revision:n.revision+1}:n)});
}});
export const appendSticky=mutation({args:{token:v.string(),id:v.string(),text:v.string()},handler:async(ctx,{token,id,text})=>{
  await playerFor(ctx,token);const room=await roomFor(ctx),notes=room.stickies??[],note=notes.find(n=>n.id===id);
  if(!note)fail('This note has been removed.');
  if(note.poster)fail('Text cannot be added to a poster.');
  if(!text.trim())return;stickyText(note.text+text);
  await ctx.db.patch(room._id,{stickies:notes.map(n=>n.id===id?{...n,text:n.text+text,revision:n.revision+1}:n)});
}});
export const deleteSticky=mutation({args:{token:v.string(),id:v.string(),revision:v.number()},handler:async(ctx,{token,id,revision})=>{
  await playerFor(ctx,token,true);const room=await roomFor(ctx),note=room.stickies?.find(n=>n.id===id);
  if(!note)return;if(note.revision!==revision)fail('This note changed. Reopen it before deleting.');
  await ctx.db.patch(room._id,{stickies:room.stickies.filter(n=>n.id!==id)});
}});
export const cleanup=internalMutation({args:{},handler:async ctx=>{
  for(const grant of await ctx.db.query('voiceGrants').withIndex('by_expiry',q=>q.lt('expiresAt',Date.now())).take(100))await ctx.db.delete(grant._id);
  const expired=await ctx.db.query('sessions').withIndex('by_expiry',q=>q.lt('expiresAt',Date.now())).take(100);
  for(const s of expired)await ctx.db.delete(s._id);
  const oldMessages=await ctx.db.query('messages').withIndex('by_time',q=>q.lt('sentAt',Date.now()-7*86400000)).take(200);
  for(const m of oldMessages)await ctx.db.delete(m._id);
  await closeStaleVisits(ctx,Date.now());
}});
export const seed=mutation({args:{token:v.string(),options:v.any(),items:v.array(v.any())},handler:async(ctx,{token,options,items})=>{
  await playerFor(ctx,token,true);const room=await roomFor(ctx);if(room.revision!==0)return;
  validateRoom(options);const definitions=await definitionsFor(ctx,items);validateFurniture(items,options,definitions,room?.spaces??[]);const next={...room,options,furniture:items,definitions};freePosition(next);
  await ctx.db.patch(room._id,{options,revision:1});await replaceAll(ctx,next,items);await resettlePlayers(ctx,next);
}});
