import {internalQuery,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';

export const page=internalQuery({args:{cursor:v.union(v.string(),v.null())},handler:async(ctx,{cursor})=>{
  const page=await ctx.db.query('rooms').paginate({cursor,numItems:5});
  return {...page,page:page.page.map(room=>({id:room._id,spaces:(room.spaces??[]).filter(s=>s.floorImage||s.wallImage).map(({id,floorImage,wallImage})=>({id,...(floorImage?{floorImage}:{}),...(wallImage?{wallImage}:{})}))}))};
}});

export const replace=internalMutation({args:{id:v.id('rooms'),spaceId:v.string(),files:v.array(v.object({previous:v.id('_storage'),next:v.id('_storage')}))},handler:async(ctx,{id,spaceId,files})=>{
  const room=await ctx.db.get(id),space=room?.spaces?.find(s=>s.id===spaceId);
  if(!space)return false;
  const sources=new Set([space.floorImage,space.wallImage].filter(Boolean));
  if(new Set(files.map(f=>f.previous)).size!==files.length)throw Error('Duplicate surface replacement');
  for(const file of files){
    if(!sources.has(file.previous))return false;
    const next=await ctx.db.system.get(file.next);
    if(!next||(next.contentType&&next.contentType!=='image/webp'))throw Error('Replacement must be a WebP');
  }
  const replacements=new Map(files.map(f=>[f.previous,f.next]));
  await ctx.db.patch(id,{spaces:room.spaces.map(s=>s.id!==spaceId?s:{...s,
    ...(s.floorImage?{floorImage:replacements.get(s.floorImage)??s.floorImage}:{}),
    ...(s.wallImage?{wallImage:replacements.get(s.wallImage)??s.wallImage}:{})}),revision:room.revision+1});
  return true;
}});
