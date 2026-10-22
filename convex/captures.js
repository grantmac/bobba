// Retired room captures: keep old tabs idle and let in-flight captures finish/clean up.
import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail} from './lib/rules.js';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
const region=v.object({x:v.number(),z:v.number(),width:v.number(),depth:v.number()});
const retired=()=>fail('Room pictures have been removed. Use room_overview for text-only room checks.');
async function roomArtwork(ctx,storageId){
  const assets=await ctx.db.query('assets').collect();
  if(assets.some(asset=>asset.icon===storageId||asset.parts.some(part=>part.storageId===storageId||part.foregroundStorageId===storageId)))return true;
  const room=await ctx.db.query('rooms').first();
  return (room?.spaces??[]).some(space=>space.floorImage===storageId||space.wallImage===storageId);
}
async function discardPicture(ctx,storageId){
  if(!await roomArtwork(ctx,storageId))await ctx.storage.delete(storageId).catch(()=>{});
}
export const request=mutation({args:{agentToken:v.string(),region:v.optional(region)},handler:retired});
// Constant results add no database dependencies for already-open tabs.
export const pending=query({args:{token:v.string()},handler:async()=>null});
export const take=mutation({args:{token:v.string(),id:v.id('captures')},handler:async()=>false});
export const uploadUrl=mutation({args:{token:v.string()},handler:retired});
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
