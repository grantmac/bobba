import {mutation,query,internalMutation,internalQuery} from './_generated/server.js';
import {v} from 'convex/values';
import {DEFAULT_ROOM,fail,validName,validateLook,validateRoom,validateFurniture,tileSet,wallTileSet,wallChecker,isPlaced,cells,blocked,atTime,freePosition,findPath,playerTiles,layoutFor,pitSeat} from './lib/rules.js';
import {internal} from './_generated/api.js';
import {furniture} from './lib/catalog.js';
import {POSTERS,STICKY_COLORS,STICKY_LIMIT,STICKY_TEXT_LIMIT,validWallPosition,validPosterPosition,relocateStickies} from '../shared/stickies.js';
import {seatFor,isWallItem,canHang} from '../shared/furniture-model.js';
import {openVisit,closeVisits,closeStaleVisits} from './lib/visits.js';
import {definitionsFor,assertOwnedChanges} from './lib/assets.js';
const SESSION_AGE=30*24*60*60*1000,ADMIN_AGE=12*60*60*1000;
// A guest name frees up this long after its holder was last seen; Grant is reserved for good.
const NAME_REUSE_AFTER=4*60*60*1000;
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function validToken(token){if(!/^[a-f0-9]{64}$/.test(token))fail('Please enter the room again.');}
export async function playerFor(ctx,token,admin=false){
  validToken(token);const digest=await hash(token);
  const session=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!session||session.expiresAt<Date.now())fail('Your session has ended. Please enter the room again.');
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
async function getRoom(ctx){const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();if(room)room.definitions=await definitionsFor(ctx);return room;}
function publicPlayer(p){return {id:p._id,name:p.name,role:p.role,look:p.look,route:p.route,startedAt:p.startedAt,direction:p.direction,seatId:p.seatId,lastSeen:p.lastSeen,action:p.action??null,actionStarted:p.actionStarted??0,drink:p.drink??null,typingUntil:p.typingUntil??0};}
async function checkEntryCode(code){
  if(!code||code.length>200||!process.env.GRANT_ENTRY_HASH||!equal(await hash(code),process.env.GRANT_ENTRY_HASH))fail('This private entry link is not valid.');
}
export const entryAppearance=query({args:{entryCode:v.string()},handler:async(ctx,{entryCode})=>{
  await checkEntryCode(entryCode);
  const player=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey','grant')).unique();
  return player?.look??null;
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
  const now=Date.now();let takeover=false;
  if(player&&!admin){
    if(now-player.lastSeen<NAME_REUSE_AFTER)fail('That name is already taken. It frees up four hours after its last visit.');
    // The name's previous holder has been away long enough: hand the record to the newcomer and
    // end the old holder's sessions and connections, so they re-enter under a fresh name.
    for(const s of await ctx.db.query('sessions').withIndex('by_expiry',q=>q.gt('expiresAt',0)).filter(q=>q.eq(q.field('playerId'),player._id)).collect())await ctx.db.delete(s._id);
    for(const c of await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(c._id);
    takeover=true;
  }
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(51);
  if(online.length>=50&&!player)fail('The room is full. Please try again shortly.');
  let room=await getRoom(ctx);
  if(!room){const id=await ctx.db.insert('rooms',{key:'main',options:DEFAULT_ROOM,furniture:[],revision:0});room=await ctx.db.get(id);}
  const occupied=playerTiles(online,now,player?._id);
  const position=freePosition(room,player?atTime(player,now):undefined,occupied);
  let playerId;
  if(player){
    playerId=player._id;
    await ctx.db.patch(playerId,{look:takeover||args.replaceLook?args.look:player.look,lastSeen:now,route:[position],startedAt:now,seatId:null,drink:null,typingUntil:0,action:null,...(takeover?{lastJoinAlertAt:undefined}:{})});
  }else playerId=await ctx.db.insert('players',{name:admin?'Grant':named.name,nameKey:key,role:admin?'admin':'guest',look:args.look,route:[position],startedAt:now,direction:2,seatId:null,drink:null,lastSeen:now,lastChat:0});
  await ctx.db.insert('sessions',{tokenHash:digest,playerId,expiresAt:now+(admin?ADMIN_AGE:SESSION_AGE)});
  const joined=await ctx.db.get(playerId);
  await openVisit(ctx,joined,now);
  await notifyArrival(ctx,joined,now,args.pageOrigin);
  return publicPlayer(joined);
}});
// Public visitors can watch the shared room before choosing a character.
export const preview=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx),now=Date.now();
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  return {serverTime:now,room:{danceFloorOn:room?.danceFloorOn??true,fridge:room?.fridge??null,revision:room?.revision??0,options:room?.options??DEFAULT_ROOM,furniture:room?.furniture.filter(isPlaced)??[],stickies:room?.stickies??[]},players:players.map(publicPlayer)};
}});
export const me=query({args:{token:v.string()},handler:async(ctx,{token})=>publicPlayer(await playerFor(ctx,token))});
export const voiceIdentity=internalQuery({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  if(player.lastSeen<=Date.now()-45000)fail('Enter the room before joining voice.');
  return player._id;
}});
// Room contents on their own subscription: they change rarely, so player movement no
// longer re-sends the furniture list to everyone.
export const roomState=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const me=await playerFor(ctx,token),room=await getRoom(ctx);
  return {danceFloorOn:room.danceFloorOn??true,fridge:room.fridge??null,options:room.options,revision:room.revision,furniture:room.furniture.filter(i=>me.role==='admin'||isPlaced(i)),stickies:room.stickies??[]};
}});
// Older open tabs still receive room contents until their automatic update completes.
export const state=query({args:{token:v.string(),presenceOnly:v.optional(v.boolean())},handler:async(ctx,{token,presenceOnly=false})=>{
  const me=await playerFor(ctx,token),now=Date.now(),room=presenceOnly?null:await getRoom(ctx);
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  if(!players.some(p=>p._id===me._id))players.push(me);
  const messages=await ctx.db.query('messages').withIndex('by_time').order('desc').take(30);
  return {serverTime:now,me:publicPlayer(me),players:players.map(publicPlayer),...(presenceOnly?{}:{room:{danceFloorOn:room.danceFloorOn??true,fridge:room.fridge??null,options:room.options,revision:room.revision,furniture:room.furniture.filter(i=>me.role==='admin'||isPlaced(i)),stickies:room.stickies??[]}}),messages:messages.reverse().map(({_id,name,color,body,mode,x,z,sentAt,playerId})=>({id:_id,name,color,body,mode,x,z,sentAt,playerId}))};
}});
export const heartbeat=mutation({args:{token:v.string(),connectionId:v.string(),pageOrigin:v.optional(v.string())},handler:async(ctx,{token,connectionId,pageOrigin})=>{
  const p=await playerFor(ctx,token),now=Date.now();
  if(!/^[a-f0-9]{64}$/.test(connectionId))fail('Invalid connection.');
  const old=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(old&&old.playerId!==p._id)fail('Invalid connection.');
  if(old)await ctx.db.patch(old._id,{lastSeen:now});
  else await ctx.db.insert('connections',{connectionId,playerId:p._id,tokenHash:await hash(token),lastSeen:now});
  await closeStaleVisits(ctx,now);
  let positionUpdate={};
  if(p.lastSeen<=now-45000){
    await openVisit(ctx,p,now);
    await notifyArrival(ctx,p,now,pageOrigin);
    const room=await getRoom(ctx),online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
    positionUpdate={route:[freePosition(room,atTime(p,now),playerTiles(online,now,p._id))],startedAt:now,seatId:null};
  }
  await ctx.db.patch(p._id,{lastSeen:now,...positionUpdate});
  await ctx.scheduler.runAfter(45000,internal.room.expireConnection,{connectionId,seenAt:now});
}});
async function removeConnection(ctx,connection){
  await ctx.db.delete(connection._id);
  const remaining=await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',connection.playerId)).collect();
  await ctx.db.patch(connection.playerId,{lastSeen:Math.max(0,...remaining.map(c=>c.lastSeen))});
  if(!remaining.length)await closeVisits(ctx,connection.playerId,Date.now());
}
export const disconnect=internalMutation({args:{token:v.string(),connectionId:v.string()},handler:async(ctx,{token,connectionId})=>{
  validToken(token);const connection=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(connection&&equal(connection.tokenHash,await hash(token)))await removeConnection(ctx,connection);
}});
export const expireConnection=internalMutation({args:{connectionId:v.string(),seenAt:v.number()},handler:async(ctx,{connectionId,seenAt})=>{
  const connection=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(connection&&connection.lastSeen===seenAt)await removeConnection(ctx,connection);
}});
export const leave=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const p=await playerFor(ctx,token),digest=await hash(token),session=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  await ctx.db.delete(session._id);await ctx.db.patch(p._id,{lastSeen:0});
}});
export const appearance=mutation({args:{token:v.string(),look:v.any()},handler:async(ctx,{token,look})=>{
  const p=await playerFor(ctx,token);validateLook(look);await ctx.db.patch(p._id,{look,lastSeen:Date.now()});
}});
export const move=mutation({args:{token:v.string(),x:v.number(),z:v.number(),seatId:v.optional(v.string()),direction:v.optional(v.union(v.literal(0),v.literal(2),v.literal(4),v.literal(6)))},handler:async(ctx,args)=>{
  const p=await playerFor(ctx,args.token),room=await getRoom(ctx),now=Date.now();
  if(!Number.isInteger(args.x)||!Number.isInteger(args.z))fail('Choose a floor tile.');
  const target={x:args.x,z:args.z};let seat=null;
  let spot=null;
  if(args.seatId){seat=room.furniture.find(i=>i.id===args.seatId&&isPlaced(i));spot=seat&&seatFor(seat,room.definitions[seat.type]);if(!spot||!spot.cells.some(([x,z])=>x===target.x&&z===target.z))fail('That seat is not available.');}
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
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
}});
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
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  const seated=p.seatId&&atTime(p,now).x===p.route.at(-1).x&&atTime(p,now).z===p.route.at(-1).z;
  const keepSeat=action==='wave'&&seated;
  const position=keepSeat?atTime(p,now):freePosition(room,atTime(p,now),playerTiles(online,now,p._id));
  await ctx.db.patch(p._id,{action:action!=='wave'&&p.action===action?null:action,actionStarted:now,route:[position],startedAt:now,seatId:keepSeat?p.seatId:null,lastSeen:now});
}});
// A short lease clears a typing bubble even if a tab loses its connection.
export const setTyping=mutation({args:{token:v.string(),typing:v.boolean()},handler:async(ctx,{token,typing})=>{
  const p=await playerFor(ctx,token),now=Date.now();
  if(typing&&p.lastSeen<=now-45000)fail('Enter the room before typing.');
  if(typing&&(p.typingUntil??0)>now+3000)return;
  if(!typing&&!p.typingUntil)return;
  await ctx.db.patch(p._id,{typingUntil:typing?now+4000:0});
}});
export const chat=mutation({args:{token:v.string(),body:v.string(),mode:v.union(v.literal('Say'),v.literal('Whisper'),v.literal('Shout'))},handler:async(ctx,{token,body,mode})=>{
  const p=await playerFor(ctx,token),now=Date.now(),text=body.trim();
  if(!text||text.length>400)fail('Messages must contain 1–400 characters.');
  if(now-p.lastChat<350)fail('Please wait a moment before sending another message.');
  const position=atTime(p,now);
  await ctx.db.insert('messages',{playerId:p._id,name:p.name,color:p.look.top.color,body:text,mode,...position,sentAt:now});
  await ctx.db.patch(p._id,{lastChat:now,lastSeen:now,typingUntil:0});
}});
async function resetPlayers(ctx,room){
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',Date.now()-60000)).take(100);
  const occupied=new Set();
  for(const p of players){const pos=freePosition(room,atTime(p,Date.now()),occupied);occupied.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);await ctx.db.patch(p._id,{route:[pos],startedAt:Date.now(),seatId:null,action:null});}
}
export const setFurniture=mutation({args:{token:v.string(),items:v.array(v.any()),revision:v.number(),knowsAssets:v.optional(v.boolean())},handler:async(ctx,{token,items,revision,knowsAssets})=>{
  const player=await playerFor(ctx,token);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');
  // A client built before player pieces existed drops them as unknown types; keep those.
  if(!knowsAssets){const sent=new Set(items.map(i=>i.id));items=[...items,...room.furniture.filter(i=>i.type.startsWith('asset_')&&!sent.has(i.id))];}
  validateFurniture(items,room.options,room.definitions);
  // Builders may only touch what they built; Grant may change anything.
  if(player.role!=='admin'){try{assertOwnedChanges(room.furniture,items,player._id,room.definitions);}catch(error){fail(error.message);}}
  const next={...room,furniture:items};freePosition(next);
  // Hanging a wall piece never displaces anyone, so only floor changes reset players.
  const placement=value=>JSON.stringify(value.filter(item=>!isWallItem(room.definitions[item.type])).map(({on,...item})=>item));
  const changedPlacement=placement(items)!==placement(room.furniture);
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
  if(!item||item.type!=='custom_dj_decks'||!isPlaced(item))fail('Select decks that are in the room.');
  if((item.on??true)===on)return;
  await ctx.db.patch(room._id,{furniture:room.furniture.map(item=>item.id===id?{...item,on}:item),revision:room.revision+1});
}});
export const setOptions=mutation({args:{token:v.string(),options:v.any(),revision:v.number()},handler:async(ctx,{token,options,revision})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');validateRoom(options);
  const tiles=tileSet(options),items=room.furniture.map(item=>isPlaced(item)&&cells(item,room.definitions).some(cell=>!tiles.has(cell.join(',')))?{...item,x:null,z:null}:item);
  const hasWall=wallChecker(options);
  for(const item of items){
    if(item.supportId&&(!isPlaced(item)||!items.some(table=>table.id===item.supportId&&isPlaced(table)))){item.x=null;item.z=null;delete item.supportId;}
    if(isWallItem(room.definitions[item.type])&&isPlaced(item)&&!canHang(item,room.definitions[item.type],hasWall)){item.x=null;item.z=null;delete item.u;delete item.height;}
  }
  validateFurniture(items,options,room.definitions);
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
  const expired=await ctx.db.query('sessions').withIndex('by_expiry',q=>q.lt('expiresAt',Date.now())).take(100);
  for(const s of expired)await ctx.db.delete(s._id);
  const oldMessages=await ctx.db.query('messages').withIndex('by_time',q=>q.lt('sentAt',Date.now()-7*86400000)).take(200);
  for(const m of oldMessages)await ctx.db.delete(m._id);
  await closeStaleVisits(ctx,Date.now());
}});
export const seed=mutation({args:{token:v.string(),options:v.any(),items:v.array(v.any())},handler:async(ctx,{token,options,items})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);if(room.revision!==0)return;
  validateRoom(options);validateFurniture(items,options,room?.definitions);const next={...room,options,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{options,furniture:items,revision:1});await resetPlayers(ctx,next);
}});
