import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
import {fail,isPlaced,isOnline,zonePlayers,MAIN_ZONE} from './lib/rules.js';
import {zoneItems,itemDoc} from './lib/furnitureStore.js';
import {validateProgram,programState,programHost,programSignal,PROGRAM_CONNECTION_MAX} from '../shared/asset-program.js';

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
async function placedProgram(ctx,itemId){
  const doc=await itemDoc(ctx,itemId),item=doc&&isPlaced(doc)?doc:null;
  const assetId=item?.type.startsWith('asset_')?ctx.db.normalizeId('assets',item.type.slice(6)):null;
  const asset=assetId?await ctx.db.get(assetId):null;
  return asset?.program?{item,asset}:null;
}
async function instance(ctx,itemId){
  const result=await placedProgram(ctx,itemId);
  if(!result)fail('That programmed piece is not in the room.');
  const {item,asset}=result;
  return {item,asset,row:await recordFor(ctx,itemId)};
}
const initialRow=(itemId,asset)=>({itemId,assetId:asset._id,version:asset.program.revision,state:asset.program.initialState,revision:0,savedAt:0,serial:0,events:[]});
const connectionsFor=(ctx,index,id)=>ctx.db.query('programConnections').withIndex(`by_${index}`,q=>q.eq(`${index}Id`,id)).collect();
async function editableInstance(ctx,player,itemId){
  const result=await instance(ctx,itemId);
  if(result.item.owner!==player._id&&player.role!=='admin')fail('That placed piece is not yours.');
  return result;
}
export const getConnections=query({args:{agentToken:v.string(),itemId:v.string()},handler:async(ctx,{agentToken,itemId})=>{
  const {player}=await agentFor(ctx,agentToken);await editableInstance(ctx,player,itemId);
  return {itemId,connections:(await connectionsFor(ctx,'source',itemId)).map(({name,targetId})=>({name,targetId}))};
}});
export const setConnections=mutation({args:{agentToken:v.string(),itemId:v.string(),connections:v.array(v.object({name:v.string(),targetId:v.string()}))},handler:async(ctx,{agentToken,itemId,connections})=>{
  const {player}=await agentFor(ctx,agentToken),source=await editableInstance(ctx,player,itemId);
  if(connections.length>PROGRAM_CONNECTION_MAX)fail('A piece can have at most eight outgoing connections.');
  const keys=new Set();
  for(const link of connections){
    try{programSignal(link.name,null);}catch(error){fail(error.message);}
    const key=JSON.stringify([link.name,link.targetId]);
    if(keys.has(key)||link.targetId===itemId)fail('Connections must be unique and cannot target the same piece.');keys.add(key);
    const target=await editableInstance(ctx,player,link.targetId);
    if(source.item.zone!==target.item.zone)fail('Connected pieces must be in the same space.');
    const incoming=(await connectionsFor(ctx,'target',link.targetId)).filter(l=>l.sourceId!==itemId).length;
    if(incoming+connections.filter(l=>l.targetId===link.targetId).length>PROGRAM_CONNECTION_MAX)fail('A piece can have at most eight incoming connections.');
  }
  const existing=await connectionsFor(ctx,'source',itemId);
  for(const link of existing)if(!keys.has(JSON.stringify([link.name,link.targetId])))await ctx.db.delete(link._id);
  for(const link of connections)if(!existing.some(l=>l.name===link.name&&l.targetId===link.targetId))await ctx.db.insert('programConnections',{sourceId:itemId,...link,revision:0,sentAt:0});
  return {itemId,connections};
}});
export const signal=mutation({args:{token:v.string(),itemId:v.string(),version:v.number(),revision:v.number(),name:v.string(),data:v.any()},handler:async(ctx,args)=>{
  const player=await playerFor(ctx,args.token),{item,asset,row}=await instance(ctx,args.itemId);
  // Match save's empty-space fallback. A viewer in an adjacent space can clear a
  // sensor after the last visitor leaves; concurrent fallback viewers use CAS.
  const host=await hostFor(ctx,item);
  if(!isOnline(player,Date.now())||(host!==null&&host!==player._id))fail('Only the current host can send signals.');
  if(args.version!==asset.program.revision)fail('The furniture program changed.');
  const current=row??initialRow(args.itemId,asset);
  if(args.revision!==(current.signalRevision??0))fail('The signal revision changed.');
  if(Date.now()-(current.signalAt??0)<1000)fail('Signals can be sent once per second per piece.');
  try{programSignal(args.name,args.data);}catch(error){fail(error.message);}
  const links=(await connectionsFor(ctx,'source',args.itemId)).filter(l=>l.name===args.name);
  if(!links.length)fail('No connection exists for that signal.');
  // Recheck placement on every send: pickup and moves cannot deliver across spaces.
  const targets=[];
  for(const link of links){
    const target=await placedProgram(ctx,link.targetId);
    if(target?.item.zone===item.zone)targets.push({link,target});
  }
  if(!targets.length)fail('No connected receiver is active in this space.');
  const revision=(current.signalRevision??0)+1,signalAt=Date.now();
  for(const {link,target} of targets)await ctx.db.patch(link._id,{data:args.data,revision:link.revision+1,sentAt:signalAt,sourceVersion:asset.program.revision,targetVersion:target.asset.program.revision});
  if(row)await ctx.db.patch(row._id,{signalRevision:revision,signalAt});
  else await ctx.db.insert('programInstances',{...current,signalRevision:revision,signalAt});
  return {revision,delivered:targets.length};
}});
// The running programs of one zone's placed pieces: clients ask for the zones they can see.
// Without a zone (tests and tools), every placed piece's program, wherever it stands.
export const list=query({args:{zone:v.optional(v.string())},handler:async(ctx,{zone})=>{
  const rows=[];
  const items=zone===undefined?await ctx.db.query('furniture').collect():await zoneItems(ctx,zone);
  for(const item of items.filter(i=>isPlaced(i)&&i.type.startsWith('asset_'))){
    const row=await ctx.db.query('programInstances').withIndex('by_item',q=>q.eq('itemId',item.id)).unique();
    const outgoing=await connectionsFor(ctx,'source',item.id),incoming=await connectionsFor(ctx,'target',item.id);
    if(!row&&!outgoing.length&&!incoming.length)continue;
    const assetId=ctx.db.normalizeId('assets',item.type.slice(6)),asset=assetId?await ctx.db.get(assetId):null;
    if(!asset?.program)continue;
    const signals=[],connections=[],targetZone=zone??item.zone;
    for(const link of outgoing){
      const target=await placedProgram(ctx,link.targetId),active=target?.item.zone===targetZone;
      connections.push({name:link.name,targetId:link.targetId,active,
        ...(active&&link.sourceVersion===asset.program.revision&&link.targetVersion===target.asset.program.revision&&link.data!==undefined?{data:link.data}:{})});
    }
    for(const link of incoming){
      if(link.targetVersion!==asset.program.revision||link.data===undefined)continue;
      const source=await itemDoc(ctx,link.sourceId),sourceAssetId=source?.type.startsWith('asset_')?ctx.db.normalizeId('assets',source.type.slice(6)):null;
      const sourceAsset=sourceAssetId?await ctx.db.get(sourceAssetId):null;
      if(source&&isPlaced(source)&&source.zone===targetZone&&sourceAsset?.program?.revision===link.sourceVersion)signals.push({id:link._id,sourceId:link.sourceId,name:link.name,data:link.data,revision:link.revision,at:link.sentAt});
    }
    const current=row??initialRow(item.id,asset);
    rows.push({...current,connections,signals});
  }
  return rows.map(({itemId,version,state,revision,serial,events,signalRevision=0,connections,signals})=>({itemId,version,state,revision,serial,events,signalRevision,connections,signals}));
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
