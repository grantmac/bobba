import {internalQuery,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';

export const page=internalQuery({args:{cursor:v.union(v.string(),v.null())},handler:async(ctx,{cursor})=>{
  const page=await ctx.db.query('assets').paginate({cursor,numItems:5});
  return {...page,page:page.page.map(a=>({id:a._id,name:a.name,parts:a.parts}))};
}});

// Only an internal/admin caller can replace sprites. Original files remain available
// to open tabs and for rollback. A concurrent edit must not be overwritten.
export const replace=internalMutation({args:{id:v.id('assets'),previousParts:v.string(),files:v.array(v.object({previous:v.id('_storage'),next:v.id('_storage')}))},handler:async(ctx,{id,previousParts,files})=>{
  const asset=await ctx.db.get(id);
  if(!asset||JSON.stringify(asset.parts)!==previousParts)return false;
  const sources=new Set(asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean)));
  if(new Set(files.map(f=>f.previous)).size!==files.length)throw Error('Duplicate sprite replacement');
  for(const file of files){
    if(!sources.has(file.previous))throw Error('Sprite no longer belongs to this asset');
    const original=await ctx.db.system.get(file.previous),next=await ctx.db.system.get(file.next);
    if(!original||!next||(next.contentType&&next.contentType!=='image/png')||next.size>=original.size)throw Error('Replacement must be a smaller PNG');
  }
  const replacements=new Map(files.map(f=>[f.previous,f.next]));
  const parts=asset.parts.map(p=>({...p,storageId:replacements.get(p.storageId)??p.storageId,...(p.foregroundStorageId?{foregroundStorageId:replacements.get(p.foregroundStorageId)??p.foregroundStorageId}:{})}));
  await ctx.db.patch(id,{parts,...(replacements.has(asset.icon)?{icon:replacements.get(asset.icon)}:{})});
  return true;
}});
