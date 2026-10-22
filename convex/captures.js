// Pictures of the room for agents. The hosted endpoint (api/mcp.js, room_picture) files a request;
// whichever open room tab claims it first renders the frame off-screen, uploads it (src/snapshot.js)
// and marks it done; the endpoint fetches the picture, hands it to the agent and discards it.
import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail} from './lib/rules.js';
import {agentFor} from './agents.js';
import {playerFor,sessionFor} from './room.js';
const region=v.object({x:v.number(),z:v.number(),width:v.number(),depth:v.number()});
// A request older than this is nobody's to take; a taker silent for this long loses it.
const STALE=20000,RETAKE=8000;
const takeable=(c,now)=>c.status==='pending'||(c.status==='taking'&&(c.takenAt??0)<now-RETAKE);
async function roomArtwork(ctx,storageId){
  const assets=await ctx.db.query('assets').collect();
  if(assets.some(asset=>asset.icon===storageId||asset.parts.some(part=>part.storageId===storageId||part.foregroundStorageId===storageId)))return true;
  const room=await ctx.db.query('rooms').first();
  return (room?.spaces??[]).some(space=>space.floorImage===storageId||space.wallImage===storageId);
}
async function discardPicture(ctx,storageId){
  if(!await roomArtwork(ctx,storageId))await ctx.storage.delete(storageId).catch(()=>{});
}
export const request=mutation({args:{agentToken:v.string(),region:v.optional(region)},handler:async(ctx,{agentToken,region})=>{
  const {player}=await agentFor(ctx,agentToken),now=Date.now();
  // Housekeeping: anything older than ten minutes goes, picture included.
  for(const old of await ctx.db.query('captures').withIndex('by_time',q=>q.lt('requestedAt',now-600000)).take(20)){if(old.storageId)await discardPicture(ctx,old.storageId);await ctx.db.delete(old._id);}
  return await ctx.db.insert('captures',{playerId:player._id,requestedAt:now,status:'pending',...(region?{region}:{})});
}});
// The oldest request an open tab could take right now, or null.
export const pending=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  // Session validation preserves expiry and moderation without watching every player move.
  await sessionFor(ctx,token);const now=Date.now();
  const next=(await ctx.db.query('captures').withIndex('by_time',q=>q.gt('requestedAt',now-STALE)).collect()).find(c=>takeable(c,now));
  return next?{id:next._id,region:next.region??null}:null;
}});
export const take=mutation({args:{token:v.string(),id:v.id('captures')},handler:async(ctx,{token,id})=>{
  const player=await playerFor(ctx,token),capture=await ctx.db.get(id),now=Date.now();
  if(!capture||capture.requestedAt<now-STALE||!takeable(capture,now))return false;
  await ctx.db.patch(id,{status:'taking',takenBy:player._id,takenAt:now});return true;
}});
export const uploadUrl=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{await playerFor(ctx,token);return await ctx.storage.generateUploadUrl();}});
export const finish=mutation({args:{token:v.string(),id:v.id('captures'),storageId:v.id('_storage')},handler:async(ctx,{token,id,storageId})=>{
  const player=await playerFor(ctx,token),capture=await ctx.db.get(id);
  if(!capture)fail('That picture request is gone.');
  if(capture.takenBy!==player._id)fail('Another tab took this picture.');
  if(capture.status!=='taking')fail('That picture request is no longer being taken.');
  if(await roomArtwork(ctx,storageId))fail('A screenshot cannot use existing room artwork.');
  await ctx.db.patch(id,{status:'done',storageId,doneAt:Date.now()});
}});
export const failed=mutation({args:{token:v.string(),id:v.id('captures'),reason:v.string()},handler:async(ctx,{token,id,reason})=>{
  const player=await playerFor(ctx,token),capture=await ctx.db.get(id);
  if(capture&&capture.takenBy===player._id&&capture.status==='taking')await ctx.db.patch(id,{status:'failed',reason:reason.slice(0,200)});
}});
export const result=query({args:{agentToken:v.string(),id:v.id('captures')},handler:async(ctx,{agentToken,id})=>{
  const {player}=await agentFor(ctx,agentToken),capture=await ctx.db.get(id);
  if(!capture||capture.playerId!==player._id)fail('No such picture request.');
  const taker=capture.takenBy?await ctx.db.get(capture.takenBy):null;
  return {status:capture.status,url:capture.storageId?await ctx.storage.getUrl(capture.storageId):null,reason:capture.reason??null,takenBy:taker?.name??null};
}});
export const discard=mutation({args:{agentToken:v.string(),id:v.id('captures')},handler:async(ctx,{agentToken,id})=>{
  const {player}=await agentFor(ctx,agentToken),capture=await ctx.db.get(id);
  if(!capture||capture.playerId!==player._id)return;
  if(capture.storageId)await discardPicture(ctx,capture.storageId);
  await ctx.db.delete(id);
}});
