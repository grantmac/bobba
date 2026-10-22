import {internalQuery,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';

// Internal, paginated migration: only icons that still reuse a full sprite qualify.
export const page=internalQuery({args:{cursor:v.union(v.string(),v.null())},handler:async(ctx,{cursor})=>{
  const page=await ctx.db.query('assets').paginate({cursor,numItems:10});
  return {...page,page:page.page.filter(a=>a.parts.some(p=>p.storageId===a.icon)).map(a=>({id:a._id,icon:a.icon,part:a.parts.find(p=>p.storageId===a.icon)}))};
}});
export const replace=internalMutation({args:{id:v.id('assets'),previous:v.id('_storage'),icon:v.id('_storage')},handler:async(ctx,{id,previous,icon})=>{
  const asset=await ctx.db.get(id);
  if(!asset||asset.icon!==previous){await ctx.storage.delete(icon);return false;}
  await ctx.db.patch(id,{icon});
  // The old icon is still a room sprite. Never delete it.
  return true;
}});
