import {mutation,query,internalMutation,internalQuery} from './_generated/server.js';
import {v} from 'convex/values';
import {DEFAULT_ROOM,isOnline,onlinePlayers,ownSpaceCheck,healOrphans,fail,validName,validateLook,validateRoom,validateFurniture,tileSet,wallTileSet,wallChecker,isPlaced,cells,blocked,atTime,freePosition,findPath,playerTiles,layoutFor,pitSeat} from './lib/rules.js';
import {internal} from './_generated/api.js';
import {furniture} from './lib/catalog.js';
import {POSTERS,STICKY_COLORS,STICKY_LIMIT,STICKY_TEXT_LIMIT,validWallPosition,validPosterPosition,relocateStickies} from '../shared/stickies.js';
import {seatFor,isWallItem,canHang} from '../shared/furniture-model.js';
import {openVisit,closeVisits,closeStaleVisits} from './lib/visits.js';
import {definitionsFor,assertOwnedChanges} from './lib/assets.js';
import {discardRemovedPrograms} from './lib/programs.js';
import {queueBotEvent} from './lib/bot_events.js';
const SESSION_AGE=30*24*60*60*1000,ADMIN_AGE=12*60*60*1000;
// A guest name frees up this long after its holder was last seen; Grant is reserved for good.
const NAME_REUSE_AFTER=4*60*60*1000;
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
async function getRoom(ctx,withDefinitions=true){const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();if(room&&withDefinitions)room.definitions=await definitionsFor(ctx);return room;}
export function publicPlayer(p){return {id:p._id,name:p.name,role:p.role,...(p.kind?{kind:p.kind}:{}),look:p.look,route:p.route,startedAt:p.startedAt,direction:p.direction,seatId:p.seatId,lastSeen:p.lastSeen,action:p.action??null,actionStarted:p.actionStarted??0,drink:p.drink??null,typingUntil:p.typingUntil??0};}
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
  if(oldSession){const p=await playerFor(ctx,args.token);if(p.name.toLowerCase()!==named.key)fail('Please start a new session.');return publicPlayer(p);}
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
  const online=await onlinePlayers(ctx,now,51);
  if(online.length>=50&&!player)fail('The room is full. Please try again shortly.');
  let room=await getRoom(ctx);
  if(!room){const id=await ctx.db.insert('rooms',{key:'main',options:DEFAULT_ROOM,furniture:[],revision:0});room=await ctx.db.get(id);}
  const occupied=playerTiles(online,now,player?._id);
  const position=freePosition(room,player?atTime(player,now):undefined,occupied);
  let playerId;
  if(player){
    playerId=player._id;
    await ctx.db.patch(playerId,{online:undefined,look:args.replaceLook?args.look:player.look,lastSeen:now,route:[position],startedAt:now,seatId:null,drink:null,typingUntil:0,action:null});
  }else playerId=await ctx.db.insert('players',{name:admin?'Grant':named.name,nameKey:key,role:admin?'admin':'guest',look:args.look,route:[position],startedAt:now,direction:2,seatId:null,drink:null,lastSeen:now,lastChat:0});
  await ctx.db.insert('sessions',{role:admin?'admin':'guest',tokenHash:digest,playerId,expiresAt:now+(admin?ADMIN_AGE:SESSION_AGE)});
  await ctx.scheduler.runAfter(45000,internal.room.expireArrival,{playerId,seenAt:now});
  const joined=await ctx.db.get(playerId);
  await openVisit(ctx,joined,now);
  await notifyArrival(ctx,joined,now,args.pageOrigin);
  await queueBotEvent(ctx,joined,'arrival');
  return publicPlayer(joined);
}});
// Public visitors can watch the shared room before choosing a character.
// Spaces as clients see them: uploaded pictures become URLs and the storage ids stay server-side.
export async function publicSpaces(ctx,room){
  return Promise.all((room?.spaces??[]).map(async({floorImage,wallImage,...space})=>({...space,
    ...(floorImage?{floorImageUrl:await ctx.storage.getUrl(floorImage)}:{}),...(wallImage?{wallImageUrl:await ctx.storage.getUrl(wallImage)}:{})})));
}
export const preview=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx,false),now=Date.now();
  const players=await onlinePlayers(ctx,now);
  return {serverTime:now,room:{danceFloorOn:room?.danceFloorOn??true,fridge:room?.fridge??null,revision:room?.revision??0,options:room?.options??DEFAULT_ROOM,spaces:await publicSpaces(ctx,room),furniture:room?.furniture.filter(isPlaced)??[],stickies:room?.stickies??[]},players:players.map(publicPlayer)};
}});
export const presence=query({args:{},handler:async ctx=>{
  const now=Date.now();return {serverTime:now,players:(await onlinePlayers(ctx,now)).map(publicPlayer)};
}});
export const chatFeed=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  await sessionFor(ctx,token);
  const messages=await ctx.db.query('messages').withIndex('by_time').order('desc').take(30);
  return messages.reverse().map(({_id,name,color,body,mode,x,z,sentAt,playerId})=>({id:_id,name,color,body,mode,x,z,sentAt,playerId}));
}});
export const scene=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx,false);
  return {danceFloorOn:room?.danceFloorOn??true,fridge:room?.fridge??null,revision:room?.revision??0,options:room?.options??DEFAULT_ROOM,spaces:await publicSpaces(ctx,room),furniture:room?.furniture.filter(isPlaced)??[],stickies:room?.stickies??[]};
}});
export const session=query({args:{token:v.string()},handler:async(ctx,{token})=>({id:(await sessionFor(ctx,token)).playerId})});
export const me=query({args:{token:v.string()},handler:async(ctx,{token})=>publicPlayer(await playerFor(ctx,token))});
export const voiceIdentity=internalQuery({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  if(!isOnline(player))fail('Enter the room before joining voice.');
  return player._id;
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
// Room contents on their own subscription: they change rarely, so player movement no
// longer re-sends the furniture list to everyone.
export const roomState=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const session=await sessionFor(ctx,token),role=session.role??(await ctx.db.get(session.playerId))?.role,room=await getRoom(ctx,false);
  return {danceFloorOn:room.danceFloorOn??true,fridge:room.fridge??null,options:room.options,spaces:await publicSpaces(ctx,room),revision:room.revision,furniture:room.furniture.filter(i=>role==='admin'||isPlaced(i)||i.owner===session.playerId),stickies:room.stickies??[]};
}});
// Older open tabs still receive room contents until their automatic update completes.
export const state=query({args:{token:v.string(),presenceOnly:v.optional(v.boolean())},handler:async(ctx,{token,presenceOnly=false})=>{
  const me=await playerFor(ctx,token),now=Date.now(),room=presenceOnly?null:await getRoom(ctx);
  const players=await onlinePlayers(ctx,now);
  if(!players.some(p=>p._id===me._id))players.push(me);
  const messages=await ctx.db.query('messages').withIndex('by_time').order('desc').take(30);
  return {serverTime:now,me:publicPlayer(me),players:players.map(publicPlayer),...(presenceOnly?{}:{room:{danceFloorOn:room.danceFloorOn??true,fridge:room.fridge??null,options:room.options,spaces:await publicSpaces(ctx,room),revision:room.revision,furniture:room.furniture.filter(i=>me.role==='admin'||isPlaced(i)||i.owner===me._id),stickies:room.stickies??[]}}),messages:messages.reverse().map(({_id,name,color,body,mode,x,z,sentAt,playerId})=>({id:_id,name,color,body,mode,x,z,sentAt,playerId}))};
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
    const room=await getRoom(ctx),online=await onlinePlayers(ctx,now);
    positionUpdate={route:[freePosition(room,atTime(p,now),playerTiles(online,now,p._id))],startedAt:now,seatId:null};
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
  const p=await playerFor(ctx,token);validateLook(look);await ctx.db.patch(p._id,{look,lastSeen:Date.now()});
}});
export const move=mutation({args:{token:v.string(),x:v.number(),z:v.number(),seatId:v.optional(v.string()),direction:v.optional(v.union(v.literal(0),v.literal(2),v.literal(4),v.literal(6)))},handler:async(ctx,args)=>{
  return await movePlayer(ctx,await playerFor(ctx,args.token),args);
}});
// Both human and bot movement use the same server-checked paths and seat reservations.
export async function movePlayer(ctx,p,args){
  const room=await getRoom(ctx),now=Date.now();
  if(!Number.isInteger(args.x)||!Number.isInteger(args.z))fail('Choose a floor tile.');
  const target={x:args.x,z:args.z};let seat=null;
  let spot=null;
  if(args.seatId){seat=room.furniture.find(i=>i.id===args.seatId&&isPlaced(i));spot=seat&&seatFor(seat,room.definitions[seat.type]);if(!spot||!spot.cells.some(([x,z])=>x===target.x&&z===target.z))fail('That seat is not available.');}
  const online=await onlinePlayers(ctx,now);
  if(seat&&online.some(other=>other._id!==p._id&&other.seatId===seat.id&&Math.floor(other.route.at(-1).x)===target.x&&Math.floor(other.route.at(-1).z)===target.z))fail('Someone is already using that seat.');
  const route=findPath(room,atTime(p,now),target,seat?.id,playerTiles(online,now,p._id));
  if(!route)fail('That tile cannot be reached.');
  const a=route.at(-2),b=route.at(-1),dx=a?b.x-a.x:0,dz=a?b.z-a.z:0;
  // The sunken sofa's ring tiles seat whoever stops on them, facing the middle.
  const pit=seat?null:pitSeat(layoutFor(room.options),target.x,target.z);
  const direction=spot?.direction??pit?.direction??args.direction??(dx||dz?(Math.abs(dx)>Math.abs(dz)?(dx>0?2:6):(dz>0?4:0)):p.direction);
  const seatId=seat?.id??(pit?'pit':null);
  await ctx.db.patch(p._id,{route,startedAt:now,seatId,direction,lastSeen:now,action:!seatId&&(p.action==='dance'||p.action==='breakdance')?p.action:null});
  return {route,startedAt:now,seatId,direction};
}
// Fridges serve nearby players; the bar serves a player after they reach a stool.
export const takeDrink=mutation({args:{token:v.string(),id:v.string()},handler:async(ctx,{token,id})=>{
  const p=await playerFor(ctx,token),room=await getRoom(ctx),now=Date.now();
  const source=room.furniture.find(i=>i.id===id&&isPlaced(i)&&['fridge','dmg_fridge','custom_bar'].includes(i.type));
  if(!source)fail('There is no fridge or bar there.');
  const at=atTime(p,now),x=Math.floor(at.x),z=Math.floor(at.z);
  if(source.type==='custom_bar'){
    const end=p.route.at(-1),spot=seatFor(source,room.definitions[source.type],at);
    if(p.seatId!==id||Math.hypot(at.x-end.x,at.z-end.z)>.001||!spot.cells.some(([cx,cz])=>cx===x&&cz===z))fail('Sit on a bar stool first.');
  }else if(!cells(source,room.definitions).some(([cx,cz])=>Math.abs(cx-x)<=1&&Math.abs(cz-z)<=1))fail('Walk up to the fridge first.');
  if(now-(p.drink??0)<800)fail('Please wait a moment.');
  await ctx.db.patch(p._id,{drink:now,lastSeen:now});
  if(source.type!=='custom_bar')await ctx.db.patch(room._id,{fridge:{id,at:now}});
}});
export const gesture=mutation({args:{token:v.string(),action:v.union(v.literal('wave'),v.literal('dance'),v.literal('breakdance'))},handler:async(ctx,{token,action})=>{
  const p=await playerFor(ctx,token),room=await getRoom(ctx),now=Date.now();
  if(now-(p.actionStarted??0)<300)fail('Please wait a moment.');
  const online=await onlinePlayers(ctx,now);
  const seated=p.seatId&&atTime(p,now).x===p.route.at(-1).x&&atTime(p,now).z===p.route.at(-1).z;
  const keepSeat=action==='wave'&&seated;
  const position=keepSeat?atTime(p,now):freePosition(room,atTime(p,now),playerTiles(online,now,p._id));
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
export const chat=mutation({args:{token:v.string(),body:v.string(),mode:v.union(v.literal('Say'),v.literal('Whisper'),v.literal('Shout'))},handler:async(ctx,{token,body,mode})=>{
  const p=await playerFor(ctx,token),now=Date.now(),text=body.trim();
  if(!text||text.length>400)fail('Messages must contain 1–400 characters.');
  if(now-p.lastChat<350)fail('Please wait a moment before sending another message.');
  const position=atTime(p,now);
  const messageId=await ctx.db.insert('messages',{playerId:p._id,name:p.name,color:p.look.top.color,body:text,mode,...position,sentAt:now});
  await ctx.db.patch(p._id,{lastChat:now,lastSeen:now,typingUntil:0});
  await queueBotEvent(ctx,p,'chat',text,messageId);
}});
async function resetPlayers(ctx,room){
  const players=await onlinePlayers(ctx,Date.now(),100);
  const occupied=new Set();
  for(const p of players){const pos=freePosition(room,atTime(p,Date.now()),occupied);occupied.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);await ctx.db.patch(p._id,{route:[pos],startedAt:Date.now(),seatId:null,action:null});}
}
export const setFurniture=mutation({args:{token:v.string(),items:v.array(v.any()),revision:v.number(),knowsAssets:v.optional(v.boolean())},handler:async(ctx,{token,items,revision,knowsAssets})=>{
  const player=await playerFor(ctx,token);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');
  // Guests never receive anyone else's inventory. Keep omitted hidden pieces on the server.
  if(player.role!=='admin'){
    const sent=new Set(items.map(item=>item.id));
    items=[...items,...room.furniture.filter(item=>!isPlaced(item)&&item.owner!==player._id&&!sent.has(item.id))];
  }
  // A client built before player pieces existed drops them as unknown types; keep those.
  if(!knowsAssets){const sent=new Set(items.map(i=>i.id));items=[...items,...room.furniture.filter(i=>i.type.startsWith('asset_')&&!sent.has(i.id))];}
  items=healOrphans(items);
  validateFurniture(items,room.options,room.definitions,room.spaces??[]);
  // Builders may only touch what they built; Grant may change anything.
  if(player.role!=='admin'){try{assertOwnedChanges(healOrphans(room.furniture),items,player._id,room.definitions,ownSpaceCheck(room.options,room.spaces??[],player._id,room.definitions));}catch(error){fail(error.message);}}
  const next={...room,furniture:items};freePosition(next);
  // Hanging a wall piece never displaces anyone, so only floor changes reset players.
  const placement=value=>JSON.stringify(value.filter(item=>!isWallItem(room.definitions[item.type])).map(({on,...item})=>item));
  const changedPlacement=placement(items)!==placement(room.furniture);
  await discardRemovedPrograms(ctx,room.furniture,items);
  await ctx.db.patch(room._id,{furniture:items,revision:revision+1});
  if(changedPlacement)await resetPlayers(ctx,next);
}});
export const setDanceFloor=mutation({args:{token:v.string(),on:v.boolean()},handler:async(ctx,{token,on})=>{
  await playerFor(ctx,token);const room=await getRoom(ctx);
  await ctx.db.patch(room._id,{danceFloorOn:on});
}});
// Power is shared, but this narrow mutation cannot move or replace furniture.
export const setDeckPower=mutation({args:{token:v.string(),id:v.string(),on:v.boolean()},handler:async(ctx,{token,id,on})=>{
  await playerFor(ctx,token);const room=await getRoom(ctx);
  const item=room.furniture.find(item=>item.id===id);
  if(!item||!isPlaced(item)||!(item.type==='custom_dj_decks'||room.definitions[item.type]?.switchable))fail('Select a piece in the room that can be switched.');
  if((item.on??true)===on)return;
  await ctx.db.patch(room._id,{furniture:room.furniture.map(item=>item.id===id?{...item,on}:item),revision:room.revision+1});
}});
export const setOptions=mutation({args:{token:v.string(),options:v.any(),revision:v.number()},handler:async(ctx,{token,options,revision})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');validateRoom(options);
  const spaces=room.spaces??[],tiles=tileSet(options,spaces),items=room.furniture.map(item=>isPlaced(item)&&cells(item,room.definitions).some(cell=>!tiles.has(cell.join(',')))?{...item,x:null,z:null}:item);
  const hasWall=wallChecker(options,spaces);
  for(const item of items){
    if(item.supportId&&(!isPlaced(item)||!items.some(table=>table.id===item.supportId&&isPlaced(table)))){item.x=null;item.z=null;delete item.supportId;}
    if(isWallItem(room.definitions[item.type])&&isPlaced(item)&&!canHang(item,room.definitions[item.type],hasWall)){item.x=null;item.z=null;delete item.u;delete item.height;}
  }
  validateFurniture(items,options,room.definitions,spaces);
  const next={...room,options,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{options,furniture:items,stickies:relocateStickies(room.stickies??[],wallTileSet(options)),revision:revision+1});await resetPlayers(ctx,next);
}});
const posterKind=v.union(...Object.keys(POSTERS).map(kind=>v.literal(kind)));
const wallPosition=v.object({x:v.number(),z:v.number(),side:v.union(v.literal('left'),v.literal('right')),u:v.number(),height:v.number()});
function stickyText(text){if(text.length>STICKY_TEXT_LIMIT||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))fail('Notes can contain up to 2,000 characters.');}
export const createSticky=mutation({args:{token:v.string(),id:v.string(),position:wallPosition,poster:v.optional(posterKind)},handler:async(ctx,{token,id,position,poster})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx),notes=room.stickies??[];
  if(!/^[a-f0-9-]{36}$/.test(id))fail('Invalid note.');
  if(notes.some(n=>n.id===id))return;
  if(notes.length>=STICKY_LIMIT)fail('The room has reached its 100-note limit.');
  if(!(poster?validPosterPosition:validWallPosition)(position,wallTileSet(room.options)))fail('Place the item on a continuous section of wall.');
  await ctx.db.patch(room._id,{stickies:[...notes,{id,...position,text:'',color:STICKY_COLORS[0],revision:0,...(poster?{poster}:{})}]});
}});
export const editSticky=mutation({args:{token:v.string(),id:v.string(),revision:v.number(),text:v.string(),color:v.string(),position:v.optional(wallPosition)},handler:async(ctx,args)=>{
  await playerFor(ctx,args.token,true);const room=await getRoom(ctx),notes=room.stickies??[],note=notes.find(n=>n.id===args.id);
  if(!note)fail('This note has been removed.');
  if(note.revision!==args.revision)fail('This note changed. Close without saving and reopen it to see the latest text.');
  if(note.poster&&(args.text!==''||args.color!==note.color))fail('Poster artwork cannot be edited.');
  stickyText(args.text);if(!STICKY_COLORS.includes(args.color))fail('Invalid note colour.');
  if(args.position&&!(note.poster?validPosterPosition:validWallPosition)(args.position,wallTileSet(room.options)))fail('Place the item on a continuous section of wall.');
  await ctx.db.patch(room._id,{stickies:notes.map(n=>n.id===note.id?{...n,...args.position,text:args.text,color:args.color,revision:n.revision+1}:n)});
}});
export const appendSticky=mutation({args:{token:v.string(),id:v.string(),text:v.string()},handler:async(ctx,{token,id,text})=>{
  await playerFor(ctx,token);const room=await getRoom(ctx),notes=room.stickies??[],note=notes.find(n=>n.id===id);
  if(!note)fail('This note has been removed.');
  if(note.poster)fail('Text cannot be added to a poster.');
  if(!text.trim())return;stickyText(note.text+text);
  await ctx.db.patch(room._id,{stickies:notes.map(n=>n.id===id?{...n,text:n.text+text,revision:n.revision+1}:n)});
}});
export const deleteSticky=mutation({args:{token:v.string(),id:v.string(),revision:v.number()},handler:async(ctx,{token,id,revision})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx),note=room.stickies?.find(n=>n.id===id);
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
  await playerFor(ctx,token,true);const room=await getRoom(ctx);if(room.revision!==0)return;
  validateRoom(options);validateFurniture(items,options,room?.definitions,room?.spaces??[]);const next={...room,options,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{options,furniture:items,revision:1});await resetPlayers(ctx,next);
}});
