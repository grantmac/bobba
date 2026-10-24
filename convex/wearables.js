import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
import {fail,validateLook} from './lib/rules.js';
import {choices} from './lib/appearance.js';
const slot=v.union(v.literal('headwear'),v.literal('top'),v.literal('jacket'));
const templateFields=w=>w.templateModel?{templateModel:w.templateModel}:{};
export const create=mutation({args:{agentToken:v.string(),name:v.string(),slot,templateModel:v.optional(v.string()),storageId:v.id('_storage')},handler:async(ctx,args)=>{
  const {player}=await agentFor(ctx,args.agentToken),name=args.name.normalize('NFKC').trim();
  if(!name||name.length>40)fail('Use a name of 1–40 characters.');
  if(args.slot==='top'&&!choices.top.includes(args.templateModel))fail('Choose the shirt template returned by design_wearable.');
  if(args.slot!=='top'&&args.templateModel!==undefined)fail('Only tops use a shirt template.');
  const file=await ctx.db.system.get(args.storageId);
  if(!file||!['image/png','image/webp'].includes(file.contentType)||file.size>4*1024*1024)fail('Upload a PNG or WebP smaller than 4 MB.');
  const id=await ctx.db.insert('wearables',{ownerId:player._id,ownerName:player.name,name,slot:args.slot,...templateFields(args),storageId:args.storageId,createdAt:Date.now()});
  return {id,name,slot:args.slot,...templateFields(args)};
}});
async function listFor(ctx,player){
  const own=await ctx.db.query('wearables').withIndex('by_owner',q=>q.eq('ownerId',player._id)).order('desc').take(100);
  const items=await Promise.all(own.map(async w=>({id:w._id,name:w.name,slot:w.slot,...templateFields(w),ownerName:w.ownerName,url:await ctx.storage.getUrl(w.storageId)})));
  for(const w of player.wearables??[])if(!items.some(item=>item.id===w.id))items.push(w);
  return items;
}
export const list=query({args:{token:v.string()},handler:async(ctx,{token})=>listFor(ctx,await playerFor(ctx,token))});
export const listAgent=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>listFor(ctx,(await agentFor(ctx,agentToken)).player)});
export const applyOutfit=mutation({args:{token:v.string(),look:v.any(),wearableIds:v.array(v.id('wearables'))},handler:async(ctx,{token,look,wearableIds})=>{
  const player=await playerFor(ctx,token);validateLook(look);
  if(wearableIds.length>3||new Set(wearableIds).size!==wearableIds.length)fail('Choose one wearable per slot.');
  const wearables=[];
  for(const id of wearableIds){
    const w=await ctx.db.get(id);if(!w||wearables.some(other=>other.slot===w.slot))fail('Choose one wearable per slot.');
    const url=await ctx.storage.getUrl(w.storageId);if(!url)fail('That wearable image is missing.');
    wearables.push({id,name:w.name,slot:w.slot,...templateFields(w),url});
  }
  await ctx.db.patch(player._id,{look,wearables,lookVersion:(player.lookVersion??0)+1});
}});
async function equipFor(ctx,player,{slot,wearableId}){
  let wearable;
  if(wearableId){
    const w=await ctx.db.get(wearableId);
    if(!w||w.slot!==slot)fail('Choose a wearable for that slot.');
    const url=await ctx.storage.getUrl(w.storageId);if(!url)fail('That wearable image is missing.');
    wearable={id:w._id,name:w.name,slot:w.slot,...templateFields(w),url};
  }
  const wearables=(player.wearables??[]).filter(w=>w.slot!==slot);
  if(wearable)wearables.push(wearable);
  await ctx.db.patch(player._id,{wearables,lookVersion:(player.lookVersion??0)+1});
  return {wearables};
}
const equipArgs={slot,wearableId:v.union(v.id('wearables'),v.null())};
export const equip=mutation({args:{token:v.string(),...equipArgs},handler:async(ctx,args)=>equipFor(ctx,await playerFor(ctx,args.token),args)});
export const equipAgent=mutation({args:{agentToken:v.string(),...equipArgs},handler:async(ctx,args)=>equipFor(ctx,(await agentFor(ctx,args.agentToken)).player,args)});
export const outfit=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  const {player}=await agentFor(ctx,agentToken);return {look:player.look,wearables:player.wearables??[]};
}});
