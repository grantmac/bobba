import {internalMutation,query,mutation} from './_generated/server.js';
import {v} from 'convex/values';
import {playerFor} from './room.js';
import {fail} from './lib/rules.js';
import {applySpaceLayout} from './lib/spaceLayout.js';
import {applyChanges} from './lib/furnitureStore.js';
import {HOMEPAGE_SPACE_ID,HOMEPAGE_PIECES} from '../shared/homepage.js';

// Deployment-only, repeatable setup. Uses the normal atomic move and placement rules.
export const install=internalMutation({args:{},handler:async ctx=>{
  const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
  const grant=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey','grant')).unique();
  if(!room||grant?.role!=='admin')fail('The room and Grant must exist before installing the homepage.');
  if((room.spaces??[]).some(s=>s.id===HOMEPAGE_SPACE_ID))return {spaceId:HOMEPAGE_SPACE_ID,created:false};
  const space={id:HOMEPAGE_SPACE_ID,owner:grant._id,ownerName:grant.name,name:"Grant's Homepage",level:0,width:8,depth:8,floor:'wood',floorColor:'#c7a16a',wall:'plain',wallColor:'#82917d',createdAt:Date.now()};
  const spaces=[space,...(room.spaces??[])];
  const layout=await applySpaceLayout(ctx,room,spaces),placed=layout.spaces.find(s=>s.id===space.id);
  const items=HOMEPAGE_PIECES.map(({id,support,...item})=>({...item,id:`homepage-${id}`,owner:grant._id,x:placed.x+item.x,z:placed.z+item.z,...(support?{supportId:`homepage-${support}`}:{})}));
  await applyChanges(ctx,{...room,spaces},grant,items);
  return {spaceId:space.id,created:true,x:placed.x,z:placed.z,pieces:items.length};
}});

const kind=v.union(v.literal('guestbook'),v.literal('suggestion'));
export const notes=query({args:{token:v.string(),kind,cursor:v.optional(v.string()),completed:v.optional(v.boolean())},handler:async(ctx,{token,kind,cursor,completed=false})=>{
  const player=await playerFor(ctx,token),status=completed?'done':'new';
  const result=await ctx.db.query('homepageNotes').withIndex('by_kind_status_time',q=>q.eq('kind',kind).eq('status',status)).order('desc').paginate({cursor:cursor??null,numItems:30});
  return {canManage:player.role==='admin',hasMore:!result.isDone,cursor:result.continueCursor,notes:result.page.map(({_id,name,body,createdAt,response})=>({id:_id,name,body,createdAt,response}))};
}});
export const addNote=mutation({args:{token:v.string(),kind,body:v.string()},handler:async(ctx,{token,kind,body})=>{
  const player=await playerFor(ctx,token),text=body.trim(),now=Date.now();
  if(!text||text.length>500)fail('Write between 1 and 500 characters.');
  const last=await ctx.db.query('homepageNotes').withIndex('by_player_time',q=>q.eq('playerId',player._id)).order('desc').first();
  if(last&&now-last.createdAt<30000)fail('Give it a moment: one note every 30 seconds.');
  return await ctx.db.insert('homepageNotes',{playerId:player._id,name:player.name,kind,body:text,status:'new',createdAt:now});
}});
export const reviewNote=mutation({args:{token:v.string(),id:v.id('homepageNotes'),status:v.union(v.literal('done'),v.literal('hidden')),response:v.optional(v.string())},handler:async(ctx,{token,id,status,response})=>{
  await playerFor(ctx,token,true);
  const note=await ctx.db.get(id);if(!note)fail('That note is no longer available.');
  if(status==='done'&&note.kind!=='suggestion')fail('Only suggestions go in the scrapbook.');
  if(response!==undefined&&response.trim().length>500)fail('Keep the reply under 500 characters.');
  if(status==='done'&&!response?.trim())fail('Add a short note about what changed.');
  await ctx.db.patch(id,{status,...(response!==undefined?{response:response.trim()}:{})});
}});
