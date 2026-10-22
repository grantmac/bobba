import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
import {fail,isPlaced,isOnline,zonePlayers,MAIN_ZONE} from './lib/rules.js';
import {zoneItems,itemDoc} from './lib/furnitureStore.js';
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
  // Without a program (or a switch of its own) a copy has no power setting any more.
  if(!program&&!asset.switchable)for(const doc of await ctx.db.query('furniture').withIndex('by_type',q=>q.eq('type',`asset_${asset._id}`)).collect())if(doc.on!==undefined)await ctx.db.patch(doc._id,{on:undefined});
  return {assetId:asset._id,revision,enabled:!!program};
}});
// One human drives a piece's shared state and everyone who can see it renders it: the host is
// the elected human among the players in the piece's zone, or among the lobby's when that zone
// is empty, or anyone online when both are. The client picks by the same rule (src/main.js).
async function hostFor(ctx,item){
  const now=Date.now();
  for(const zone of new Set([item.zone,MAIN_ZONE])){const host=programHost(await zonePlayers(ctx,zone,now));if(host)return host;}
  return null;
}
async function instance(ctx,itemId){
  const doc=await itemDoc(ctx,itemId),item=doc&&isPlaced(doc)?doc:null;
  const assetId=item?.type.startsWith('asset_')?ctx.db.normalizeId('assets',item.type.slice(6)):null;
  const asset=assetId?await ctx.db.get(assetId):null;
  if(!asset?.program)fail('That programmed piece is not in the room.');
  return {item,asset,row:await recordFor(ctx,itemId)};
}
const initialRow=(itemId,asset)=>({itemId,assetId:asset._id,version:asset.program.revision,state:asset.program.initialState,revision:0,savedAt:0,serial:0,events:[]});
// The running programs of one zone's placed pieces: clients ask for the zones they can see.
// Without a zone (tests and tools), every placed piece's program, wherever it stands.
export const list=query({args:{zone:v.optional(v.string())},handler:async(ctx,{zone})=>{
  const rows=[];
  if(zone===undefined){for(const row of await ctx.db.query('programInstances').collect()){const doc=await itemDoc(ctx,row.itemId);if(doc&&isPlaced(doc))rows.push(row);}}
  else for(const item of (await zoneItems(ctx,zone)).filter(i=>isPlaced(i)&&i.type.startsWith('asset_'))){
    const row=await ctx.db.query('programInstances').withIndex('by_item',q=>q.eq('itemId',item.id)).unique();
    if(row)rows.push(row);
  }
  return rows.map(({itemId,version,state,revision,serial,events})=>({itemId,version,state,revision,serial,events}));
}});
// Only one online human drives shared state. Rendering still runs on every client.
// Compare-and-swap also protects against duplicate browser tabs and in-flight old versions.
export const save=mutation({args:{token:v.string(),itemId:v.string(),version:v.number(),revision:v.number(),state:v.any()},handler:async(ctx,args)=>{
  const player=await playerFor(ctx,args.token);
  const {asset,row,item}=await instance(ctx,args.itemId);
  const host=await hostFor(ctx,item);
  if(host!==null&&host!==player._id)fail('Another player is hosting furniture programs.');
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
  if(!isOnline(player,now))fail('Enter the room to use furniture.');
  if(current.events.some(e=>e.playerId===player._id&&now-e.at<300))fail('Please wait before using this piece again.');
  const serial=current.serial+1,events=[...current.events,{serial,playerId:player._id,at:now}].slice(-32);
  if(row)await ctx.db.patch(row._id,{serial,events});else await ctx.db.insert('programInstances',{...current,serial,events});
  return {serial};
}});
