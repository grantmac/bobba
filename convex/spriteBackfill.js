"use node";
import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {convertStoredImages} from '../server/storage-webp.js';

// Five assets per page, including icons and foregrounds. Originals remain valid
// for open tabs and rollback. Dry runs do not download or store any images.
export const run=internalAction({args:{cursor:v.optional(v.union(v.string(),v.null())),apply:v.optional(v.boolean())},handler:async(ctx,{cursor=null,apply=false})=>{
  const page=await ctx.runQuery(internal.spriteMaintenance.page,{cursor});
  const changes=[];let filesChecked=0,sourceBytes=0,optimizedBytes=0;
  if(apply)for(const asset of page.page){
    const result=await convertStoredImages(ctx,[...asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean)),asset.icon]);
    const {files}=result;filesChecked+=result.filesChecked;
    if(!files.length)continue;
    // On an ambiguous mutation failure keep uploads: the commit may have succeeded.
    const committed=await ctx.runMutation(internal.spriteMaintenance.replace,{id:asset.id,previousParts:JSON.stringify(asset.parts),previousIcon:asset.icon,files:files.map(({previous,next})=>({previous,next}))});
    if(!committed)throw Error(`Asset ${asset.id} changed during conversion; rerun to include its latest images. Originals and candidate uploads retained.`);
    changes.push({assetId:asset.id,name:asset.name,files});
    for(const file of files){sourceBytes+=file.sourceBytes;optimizedBytes+=file.optimizedBytes;}
  }
  return {candidates:page.page.length,filesChecked,sourceBytes,optimizedBytes,changes,isDone:page.isDone,cursor:page.continueCursor};
}});
