import {mutation,query,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';
import {DEFAULT_ROOM,fail,validName,validateLook,validateRoom,validateFurniture,tileSet,isPlaced,cells,blocked,atTime,freePosition,findPath,playerTiles} from './lib/rules.js';
import {internal} from './_generated/api.js';
import {furniture} from './lib/catalog.js';
const SESSION_AGE=30*24*60*60*1000,ADMIN_AGE=12*60*60*1000;
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function validToken(token){if(!/^[a-f0-9]{64}$/.test(token))fail('Please enter the room again.');}
async function playerFor(ctx,token,admin=false){
  validToken(token);const digest=await hash(token);
  const session=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!session||session.expiresAt<Date.now())fail('Your session has ended. Please enter the room again.');
  const player=await ctx.db.get(session.playerId);
  if(!player)fail('Please enter the room again.');
  if(admin&&player.role!=='admin')fail('Only Grant can edit the room.');
  return player;
}
async function getRoom(ctx){return await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();}
function publicPlayer(p){return {id:p._id,name:p.name,role:p.role,look:p.look,route:p.route,startedAt:p.startedAt,direction:p.direction,seatId:p.seatId,lastSeen:p.lastSeen,action:p.action??null,actionStarted:p.actionStarted??0};}
export const join=mutation({args:{token:v.string(),name:v.string(),look:v.any(),entryCode:v.optional(v.string())},handler:async(ctx,args)=>{
  validToken(args.token);validateLook(args.look);const named=validName(args.name),digest=await hash(args.token);
  const oldSession=await ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(oldSession){const p=await playerFor(ctx,args.token);if(p.name.toLowerCase()!==named.key)fail('Please start a new session.');return publicPlayer(p);}
  let admin=false;
  if(args.entryCode){
    if(args.entryCode.length>200||!process.env.GRANT_ENTRY_HASH||!equal(await hash(args.entryCode),process.env.GRANT_ENTRY_HASH))fail('This private entry link is not valid.');
    admin=true;
  }
  if(!admin&&named.key==='grant')fail('That name is reserved. Please choose another name.');
  const key=admin?'grant':named.key;
  let player=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey',key)).unique();
  if(player&&!admin)fail('That name is already taken. Please choose another.');
  const now=Date.now();
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(51);
  if(online.length>=50&&!player)fail('The room is full. Please try again shortly.');
  let room=await getRoom(ctx);
  if(!room){const id=await ctx.db.insert('rooms',{key:'main',options:DEFAULT_ROOM,furniture:[],revision:0});room=await ctx.db.get(id);}
  const occupied=playerTiles(online,now,player?._id);
  const position=freePosition(room,player?atTime(player,now):undefined,occupied);
  let playerId;
  if(player){
    playerId=player._id;
    await ctx.db.patch(playerId,{look:args.look,lastSeen:now,route:[position],startedAt:now,seatId:null});
  }else playerId=await ctx.db.insert('players',{name:admin?'Grant':named.name,nameKey:key,role:admin?'admin':'guest',look:args.look,route:[position],startedAt:now,direction:2,seatId:null,lastSeen:now,lastChat:0});
  await ctx.db.insert('sessions',{tokenHash:digest,playerId,expiresAt:now+(admin?ADMIN_AGE:SESSION_AGE)});
  return publicPlayer(await ctx.db.get(playerId));
}});
// Public visitors can watch the shared room before choosing a character.
export const preview=query({args:{},handler:async ctx=>{
  const room=await getRoom(ctx),now=Date.now();
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  return {serverTime:now,room:{options:room?.options??DEFAULT_ROOM,furniture:room?.furniture.filter(isPlaced)??[]},players:players.map(publicPlayer)};
}});
export const me=query({args:{token:v.string()},handler:async(ctx,{token})=>publicPlayer(await playerFor(ctx,token))});
export const state=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const me=await playerFor(ctx,token),room=await getRoom(ctx),now=Date.now();
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  if(!players.some(p=>p._id===me._id))players.push(me);
  const messages=await ctx.db.query('messages').withIndex('by_time').order('desc').take(30);
  return {serverTime:now,me:publicPlayer(me),players:players.map(publicPlayer),room:{options:room.options,revision:room.revision,furniture:room.furniture.filter(i=>me.role==='admin'||isPlaced(i))},messages:messages.reverse().map(({_id,name,color,body,mode,x,z,sentAt,playerId})=>({id:_id,name,color,body,mode,x,z,sentAt,playerId}))};
}});
export const heartbeat=mutation({args:{token:v.string(),connectionId:v.string()},handler:async(ctx,{token,connectionId})=>{
  const p=await playerFor(ctx,token),now=Date.now();
  if(!/^[a-f0-9]{64}$/.test(connectionId))fail('Invalid connection.');
  const old=await ctx.db.query('connections').withIndex('by_connection',q=>q.eq('connectionId',connectionId)).unique();
  if(old&&old.playerId!==p._id)fail('Invalid connection.');
  if(old)await ctx.db.patch(old._id,{lastSeen:now});
  else await ctx.db.insert('connections',{connectionId,playerId:p._id,tokenHash:await hash(token),lastSeen:now});
  let positionUpdate={};
  if(p.lastSeen<=now-45000){
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
export const move=mutation({args:{token:v.string(),x:v.number(),z:v.number(),seatId:v.optional(v.string())},handler:async(ctx,args)=>{
  const p=await playerFor(ctx,args.token),room=await getRoom(ctx),now=Date.now();
  if(!Number.isInteger(args.x)||!Number.isInteger(args.z))fail('Choose a floor tile.');
  const target={x:args.x,z:args.z};let seat=null;
  if(args.seatId){seat=room.furniture.find(i=>i.id===args.seatId&&isPlaced(i)&&furniture[i.type].category==='Seating');if(!seat||!cells(seat).some(([x,z])=>x===target.x&&z===target.z))fail('That seat is not available.');}
  if(seat){
    const others=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
    if(others.some(other=>other._id!==p._id&&other.seatId===seat.id&&Math.floor(other.route.at(-1).x)===target.x&&Math.floor(other.route.at(-1).z)===target.z))fail('Someone is already using that seat.');
  }
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  const route=findPath(room,atTime(p,now),target,seat?.id,playerTiles(online,now,p._id));
  if(!route)fail('That tile cannot be reached.');
  const a=route.at(-2),b=route.at(-1),dx=a?b.x-a.x:0,dz=a?b.z-a.z:0;
  const direction=seat?.rotation??(dx||dz?(Math.abs(dx)>Math.abs(dz)?(dx>0?2:6):(dz>0?4:0)):p.direction);
  await ctx.db.patch(p._id,{route,startedAt:now,seatId:seat?.id??null,direction,lastSeen:now,action:null});
  return {route,startedAt:now,seatId:seat?.id??null,direction};
}});
export const gesture=mutation({args:{token:v.string(),action:v.union(v.literal('wave'),v.literal('dance'))},handler:async(ctx,{token,action})=>{
  const p=await playerFor(ctx,token),room=await getRoom(ctx),now=Date.now();
  if(now-(p.actionStarted??0)<300)fail('Please wait a moment.');
  const online=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',now-45000)).take(50);
  const seated=p.seatId&&atTime(p,now).x===p.route.at(-1).x&&atTime(p,now).z===p.route.at(-1).z;
  const keepSeat=action==='wave'&&seated;
  const position=keepSeat?atTime(p,now):freePosition(room,atTime(p,now),playerTiles(online,now,p._id));
  await ctx.db.patch(p._id,{action:action==='dance'&&p.action==='dance'?null:action,actionStarted:now,route:[position],startedAt:now,seatId:keepSeat?p.seatId:null,lastSeen:now});
}});
export const chat=mutation({args:{token:v.string(),body:v.string(),mode:v.union(v.literal('Say'),v.literal('Whisper'),v.literal('Shout'))},handler:async(ctx,{token,body,mode})=>{
  const p=await playerFor(ctx,token),now=Date.now(),text=body.trim();
  if(!text||text.length>400)fail('Messages must contain 1–400 characters.');
  if(now-p.lastChat<350)fail('Please wait a moment before sending another message.');
  const position=atTime(p,now);
  await ctx.db.insert('messages',{playerId:p._id,name:p.name,color:p.look.top.color,body:text,mode,...position,sentAt:now});
  await ctx.db.patch(p._id,{lastChat:now,lastSeen:now});
}});
async function resetPlayers(ctx,room){
  const players=await ctx.db.query('players').withIndex('by_seen',q=>q.gt('lastSeen',Date.now()-60000)).take(100);
  const occupied=new Set();
  for(const p of players){const pos=freePosition(room,atTime(p,Date.now()),occupied);occupied.add(`${Math.floor(pos.x)},${Math.floor(pos.z)}`);await ctx.db.patch(p._id,{route:[pos],startedAt:Date.now(),seatId:null,action:null});}
}
export const setFurniture=mutation({args:{token:v.string(),items:v.array(v.any()),revision:v.number()},handler:async(ctx,{token,items,revision})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');
  validateFurniture(items,room.options);const next={...room,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{furniture:items,revision:revision+1});await resetPlayers(ctx,next);
}});
export const setOptions=mutation({args:{token:v.string(),options:v.any(),revision:v.number()},handler:async(ctx,{token,options,revision})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);
  if(room.revision!==revision)fail('The room changed. Please try that edit again.');validateRoom(options);
  const tiles=tileSet(options),items=room.furniture.map(item=>isPlaced(item)&&cells(item).some(cell=>!tiles.has(cell.join(',')))?{...item,x:null,z:null}:item);
  const next={...room,options,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{options,furniture:items,revision:revision+1});await resetPlayers(ctx,next);
}});
export const cleanup=internalMutation({args:{},handler:async ctx=>{
  const expired=await ctx.db.query('sessions').withIndex('by_expiry',q=>q.lt('expiresAt',Date.now())).take(100);
  for(const s of expired)await ctx.db.delete(s._id);
  const oldMessages=await ctx.db.query('messages').withIndex('by_time',q=>q.lt('sentAt',Date.now()-7*86400000)).take(200);
  for(const m of oldMessages)await ctx.db.delete(m._id);
}});
export const seed=mutation({args:{token:v.string(),options:v.any(),items:v.array(v.any())},handler:async(ctx,{token,options,items})=>{
  await playerFor(ctx,token,true);const room=await getRoom(ctx);if(room.revision!==0)return;
  validateRoom(options);validateFurniture(items,options);const next={...room,options,furniture:items};freePosition(next);
  await ctx.db.patch(room._id,{options,furniture:items,revision:1});await resetPlayers(ctx,next);
}});
