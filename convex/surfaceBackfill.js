"use node";
import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {convertStoredImages} from '../server/storage-webp.js';

export const run=internalAction({args:{cursor:v.optional(v.union(v.string(),v.null())),apply:v.optional(v.boolean())},handler:async(ctx,{cursor=null,apply=false})=>{
  const page=await ctx.runQuery(internal.surfaceMaintenance.page,{cursor});
  const changes=[];let filesChecked=0,sourceBytes=0,optimizedBytes=0;
  if(apply)for(const room of page.page)for(const space of room.spaces){
    const result=await convertStoredImages(ctx,[space.floorImage,space.wallImage].filter(Boolean));
    const {files}=result;filesChecked+=result.filesChecked;
    if(!files.length)continue;
    const committed=await ctx.runMutation(internal.surfaceMaintenance.replace,{id:room.id,spaceId:space.id,files:files.map(({previous,next})=>({previous,next}))});
    if(!committed)throw Error(`Space ${space.id} changed during conversion; rerun to include its latest images. Originals and candidate uploads retained.`);
    changes.push({roomId:room.id,spaceId:space.id,files});
    for(const file of files){sourceBytes+=file.sourceBytes;optimizedBytes+=file.optimizedBytes;}
  }
  return {candidates:page.page.reduce((n,r)=>n+r.spaces.length,0),filesChecked,sourceBytes,optimizedBytes,changes,isDone:page.isDone,cursor:page.continueCursor};
}});
