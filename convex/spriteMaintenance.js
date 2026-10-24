import {internalQuery,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';

export const page=internalQuery({args:{cursor:v.union(v.string(),v.null())},handler:async(ctx,{cursor})=>{
  const page=await ctx.db.query('assets').paginate({cursor,numItems:5});
  return {...page,page:page.page.map(a=>({id:a._id,name:a.name,parts:a.parts,icon:a.icon}))};
}});

// Metadata hashes identify byte-for-byte duplicates without downloading images.
// Read and patch in one transaction; never share files across separately deletable
// assets, and retain originals for open tabs and rollback.
export const deduplicate=internalMutation({args:{cursor:v.optional(v.union(v.string(),v.null())),apply:v.optional(v.boolean())},handler:async(ctx,{cursor=null,apply=false})=>{
  const page=await ctx.db.query('assets').paginate({cursor,numItems:5});
  const changes=[];let sourceBytes=0,duplicateBytes=0,filesChecked=0;
  for(const asset of page.page){
    const ids=new Set([...asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean)),asset.icon]);
    const canonical=new Map(),replacements=new Map(),files=[];
    for(const id of ids){
      const file=await ctx.db.system.get(id);
      if(!file)throw Error(`Missing sprite file for ${asset.name}`);
      sourceBytes+=file.size;filesChecked++;
      const key=JSON.stringify([file.sha256,file.size,file.contentType??null]);
      if(!file.sha256)continue;
      if(!canonical.has(key)){canonical.set(key,id);continue;}
      const next=canonical.get(key);
      replacements.set(id,next);files.push({previous:id,next,bytes:file.size});duplicateBytes+=file.size;
    }
    if(!files.length)continue;
    if(apply)await ctx.db.patch(asset._id,{
      icon:replacements.get(asset.icon)??asset.icon,
      parts:asset.parts.map(p=>({...p,storageId:replacements.get(p.storageId)??p.storageId,
        ...(p.foregroundStorageId?{foregroundStorageId:replacements.get(p.foregroundStorageId)??p.foregroundStorageId}:{})}))
    });
    changes.push({assetId:asset._id,name:asset.name,files});
  }
  return {cursor:page.continueCursor,isDone:page.isDone,filesChecked,sourceBytes,duplicateBytes,assetsChanged:apply?changes.length:0,changes};
}});

// Only an internal/admin caller can replace sprites. Original files remain available
// to open tabs and for rollback. A concurrent edit must not be overwritten.
export const replace=internalMutation({args:{id:v.id('assets'),previousParts:v.string(),previousIcon:v.id('_storage'),files:v.array(v.object({previous:v.id('_storage'),next:v.id('_storage')}))},handler:async(ctx,{id,previousParts,previousIcon,files})=>{
  const asset=await ctx.db.get(id);
  if(!asset||JSON.stringify(asset.parts)!==previousParts||asset.icon!==previousIcon)return false;
  const sources=new Set([asset.icon,...asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean))]);
  if(new Set(files.map(f=>f.previous)).size!==files.length)throw Error('Duplicate sprite replacement');
  for(const file of files){
    if(!sources.has(file.previous))throw Error('Sprite no longer belongs to this asset');
    const original=await ctx.db.system.get(file.previous),next=await ctx.db.system.get(file.next);
    if(!original||!next||(next.contentType&&next.contentType!=='image/webp'))throw Error('Replacement must be a WebP');
  }
  const replacements=new Map(files.map(f=>[f.previous,f.next]));
  const parts=asset.parts.map(p=>({...p,storageId:replacements.get(p.storageId)??p.storageId,...(p.foregroundStorageId?{foregroundStorageId:replacements.get(p.foregroundStorageId)??p.foregroundStorageId}:{})}));
  await ctx.db.patch(id,{parts,...(replacements.has(asset.icon)?{icon:replacements.get(asset.icon)}:{})});
  return true;
}});
