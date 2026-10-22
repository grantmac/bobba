import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
import {fail,isPlaced,onlinePlayers} from './lib/rules.js';
import {validateProgram,programState,programHost} from '../shared/asset-program.js';

const roomFor=ctx=>ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
const recordFor=(ctx,itemId)=>ctx.db.query('programInstances').withIndex('by_item',q=>q.eq('itemId',itemId)).unique();
async function ownedAsset(ctx,agentToken,assetId){
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(assetId);
  if(!asset||(asset.ownerId!==player._id&&player.role!=='admin'))fail('That piece is not yours.');
  return asset;
}
export const get=query({args:{agentToken:v.string(),assetId:v.id('assets')},handler:async(ctx,args)=>{
  const asset=await ownedAsset(ctx,args.agentToken,args.assetId);
  return {program:asset.program??null,revision:asset.programRevision??0};
}});
export const set=mutation({args:{agentToken:v.string(),assetId:v.id('assets'),source:v.union(v.string(),v.null()),initialState:v.optional(v.any()),expectedRevision:v.optional(v.number())},handler:async(ctx,args)=>{
  const asset=await ownedAsset(ctx,args.agentToken,args.assetId),revision=(asset.programRevision??0)+1;
  if(args.expectedRevision!==undefined&&args.expectedRevision!==revision-1)fail('The program changed. Read it again before editing.');
  let program;
  try{if(args.source!==null)program={...validateProgram({source:args.source,initialState:args.initialState===undefined?{}:args.initialState}),revision};}catch(error){fail(error.message);}
  await ctx.db.patch(asset._id,{program,programRevision:revision});
  // A new program version starts from its defaults, including existing copies.
  for(const row of await ctx.db.query('programInstances').withIndex('by_asset',q=>q.eq('assetId',asset._id)).collect())await ctx.db.delete(row._id);
  if(!program&&!asset.switchable){
    const room=await roomFor(ctx);
    if(room){const furniture=room.furniture.map(item=>{if(item.type!==`asset_${asset._id}`)return item;const {on,...rest}=item;return rest;});await ctx.db.patch(room._id,{furniture,revision:room.revision+1});}
  }
  return {assetId:asset._id,revision,enabled:!!program};
}});
async function instance(ctx,itemId){
  const room=await roomFor(ctx),item=room?.furniture.find(i=>i.id===itemId&&isPlaced(i));
  const assetId=item?.type.startsWith('asset_')?ctx.db.normalizeId('assets',item.type.slice(6)):null;
  const asset=assetId?await ctx.db.get(assetId):null;
  if(!asset?.program)fail('That programmed piece is not in the room.');
  return {item,asset,row:await recordFor(ctx,itemId)};
}
const initialRow=(itemId,asset)=>({itemId,assetId:asset._id,version:asset.program.revision,state:asset.program.initialState,revision:0,savedAt:0,serial:0,events:[]});
export const list=query({args:{},handler:async ctx=>{
  const room=await roomFor(ctx),placed=new Set(room?.furniture.filter(isPlaced).map(i=>i.id));
  return (await ctx.db.query('programInstances').collect()).filter(row=>placed.has(row.itemId)).map(({itemId,version,state,revision,serial,events})=>({itemId,version,state,revision,serial,events}));
}});
// Only one online human drives shared state. Rendering still runs on every client.
// Compare-and-swap also protects against duplicate browser tabs and in-flight old versions.
export const save=mutation({args:{token:v.string(),itemId:v.string(),version:v.number(),revision:v.number(),state:v.any()},handler:async(ctx,args)=>{
  const player=await playerFor(ctx,args.token);
  if(programHost(await onlinePlayers(ctx,Date.now()))!==player._id)fail('Another player is hosting furniture programs.');
  const {asset,row}=await instance(ctx,args.itemId);
  if(args.version!==asset.program.revision)fail('The furniture program changed.');
  const current=row??initialRow(args.itemId,asset);
  if(current.revision!==args.revision)fail('The program state changed.');
  if(Date.now()-current.savedAt<1000)fail('Program state can be saved once per second.');
  try{programState(args.state);}catch(error){fail(error.message);}
  const next={...current,state:args.state,revision:current.revision+1,savedAt:Date.now()};
  if(row)await ctx.db.patch(row._id,{state:next.state,revision:next.revision,savedAt:next.savedAt});else await ctx.db.insert('programInstances',next);
  return {revision:next.revision};
}});
export const interact=mutation({args:{token:v.string(),itemId:v.string()},handler:async(ctx,{token,itemId})=>{
  const player=await playerFor(ctx,token),{asset,row}=await instance(ctx,itemId),current=row??initialRow(itemId,asset),now=Date.now();
  if(! (await onlinePlayers(ctx,now)).some(p=>p._id===player._id))fail('Enter the room to use furniture.');
  if(current.events.some(e=>e.playerId===player._id&&now-e.at<300))fail('Please wait before using this piece again.');
  const serial=current.serial+1,events=[...current.events,{serial,playerId:player._id,at:now}].slice(-32);
  if(row)await ctx.db.patch(row._id,{serial,events});else await ctx.db.insert('programInstances',{...current,serial,events});
  return {serial};
}});
