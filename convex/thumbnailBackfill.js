"use node";
import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {decodeImage} from '../shared/image-codec.js';
import {assetThumbnail} from '../shared/asset-thumbnail.js';

// Run one bounded page at a time after deployment. Re-running is safe; converted
// icons no longer match their sprite ids. Dry runs do not download or store images.
export const run=internalAction({args:{cursor:v.optional(v.union(v.string(),v.null())),apply:v.optional(v.boolean())},handler:async(ctx,{cursor=null,apply=false})=>{
  const page=await ctx.runQuery(internal.thumbnailMaintenance.page,{cursor});
  let converted=0,sourceBytes=0,thumbnailBytes=0;
  if(apply)for(const asset of page.page){
    const source=await ctx.storage.get(asset.icon);
    if(!source)throw new Error(`Missing sprite for ${asset.id}`);
    const image=await decodeImage(Buffer.from(await source.arrayBuffer()));
    let foreground;
    if(asset.part.foregroundStorageId){
      const blob=await ctx.storage.get(asset.part.foregroundStorageId);
      if(!blob)throw new Error(`Missing foreground for ${asset.id}`);
      foreground=await decodeImage(Buffer.from(await blob.arrayBuffer()));
    }
    const webp=await assetThumbnail(image,{frame:asset.part.frames?.[0],foreground});
    const icon=await ctx.storage.store(new Blob([new Uint8Array(webp)],{type:'image/webp'}));
    if(await ctx.runMutation(internal.thumbnailMaintenance.replace,{id:asset.id,previous:asset.icon,icon})){
      converted++;sourceBytes+=source.size;thumbnailBytes+=webp.length;
    }
  }
  return {candidates:page.page.length,converted,sourceBytes,thumbnailBytes,isDone:page.isDone,cursor:page.continueCursor};
}});
