"use node";
import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {Jimp} from 'jimp';
import {encodePng} from '../shared/png.js';

// Read-only by default. Applying recompresses five assets at a time, never resizes
// them, verifies every decoded pixel, and retains originals. No public upload route.
export const run=internalAction({args:{cursor:v.optional(v.union(v.string(),v.null())),apply:v.optional(v.boolean())},handler:async(ctx,{cursor=null,apply=false})=>{
  const page=await ctx.runQuery(internal.spriteMaintenance.page,{cursor});
  const changes=[];let filesChecked=0,sourceBytes=0,optimizedBytes=0;
  if(apply)for(const asset of page.page){
    const files=[];let committed=false;
    try{
      for(const previous of new Set(asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean)))){
        const blob=await ctx.storage.get(previous);
        if(!blob)throw Error(`Missing sprite for ${asset.id}`);
        const source=Buffer.from(await blob.arrayBuffer()),image=await Jimp.read(source),png=await encodePng(image);
        filesChecked++;
        // Avoid replacing warm browser-cache URLs for negligible byte savings.
        if(source.length-png.length<Math.max(256,source.length*.05))continue;
        const decoded=await Jimp.read(png);
        if(decoded.width!==image.width||decoded.height!==image.height||!decoded.bitmap.data.equals(image.bitmap.data))throw Error('Sprite compression changed pixels');
        const next=await ctx.storage.store(new Blob([new Uint8Array(png)],{type:'image/png'}));
        files.push({previous,next,sourceBytes:source.length,optimizedBytes:png.length});
      }
      if(files.length){
        committed=await ctx.runMutation(internal.spriteMaintenance.replace,{id:asset.id,previousParts:JSON.stringify(asset.parts),files:files.map(({previous,next})=>({previous,next}))});
        if(committed){
          changes.push({assetId:asset.id,name:asset.name,files});
          for(const file of files){sourceBytes+=file.sourceBytes;optimizedBytes+=file.optimizedBytes;}
        }else{
          // The transaction conclusively declined the replacements, so these are unused.
          for(const file of files)await ctx.storage.delete(file.next);
        }
      }
    }catch(error){
      // On an ambiguous mutation failure, retain uploads: the commit may have succeeded.
      // Never risk deleting a file that a room record might now reference.
      throw new Error(`Sprite migration stopped at ${asset.id}: ${error.message}`);
    }
  }
  return {candidates:page.page.length,filesChecked,sourceBytes,optimizedBytes,changes,isDone:page.isDone,cursor:page.continueCursor};
}});
