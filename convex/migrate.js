// One-off deployment migrations. Each is safe to run again.
import {internalMutation} from './_generated/server.js';
import {layoutFor,zoneAt,MAIN_ZONE} from './lib/rules.js';
import {replaceAll} from './lib/furnitureStore.js';
// The furniture array on the map becomes one row per piece, zoned by where it stands; the
// lobby's switches move to `signals`; every player gets the zone they are standing in.
export const furniture=internalMutation({args:{},handler:async ctx=>{
  const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
  if(!room)return {moved:0};
  const items=room.furniture??[];
  if(items.length)await replaceAll(ctx,room,items);
  if(!await ctx.db.query('signals').withIndex('by_key',q=>q.eq('key','main')).unique())await ctx.db.insert('signals',{key:'main',danceFloorOn:room.danceFloorOn,fridge:room.fridge});
  await ctx.db.patch(room._id,{furniture:undefined});
  const layout=layoutFor(room.options,room.spaces??[]);let players=0;
  for(const p of await ctx.db.query('players').collect()){
    if(p.zone!==undefined)continue;
    // Someone mid-walk belongs where they are going, as `move` records it.
    const end=p.route.at(-1)??{x:3.5,z:4.5},x=Math.floor(end.x),z=Math.floor(end.z);
    await ctx.db.patch(p._id,{zone:layout.tileSet.has(`${x},${z}`)?zoneAt(layout,x,z):MAIN_ZONE,lookVersion:p.lookVersion??0});players++;
  }
  return {moved:items.length,players};
}});

// Update only Grant's exact previous hearing instructions when releasing conversation windows.
export const botHearingPreference=internalMutation({args:{},handler:async ctx=>{
  let updated=0;
  for(const memory of await ctx.db.query('botMemories').take(100)){
    if(!memory.locked||memory.source!=='Grant'||!["Assume people aren't talking to you unless they explicitly use your name.",
      'Consider replying to typed messages from within six tiles, or from anywhere when your name is explicitly mentioned. Stay quiet when you have nothing useful to add.'].includes(memory.text))continue;
    await ctx.db.patch(memory._id,{text:'Consider replying to typed messages from within six tiles, or from anywhere when your name is mentioned. Mentioning your name opens a 60-second conversation window for that person; each reply to them renews it. Answer their follow-ups without requiring your name again. Stay quiet when you have nothing useful to add.',updatedAt:Date.now()});
    updated++;
  }
  if(updated){
    const state=await ctx.db.query('botState').withIndex('by_key',q=>q.eq('key','main')).unique();
    if(state)await ctx.db.patch(state._id,{revision:state.revision+1});
  }
  return {updated};
}});
