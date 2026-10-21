import {query,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';
import {playerFor} from './room.js';

// A page of the guest book, newest first; pass the oldest enteredAt you have to page back.
export const page=query({args:{token:v.string(),before:v.optional(v.number())},handler:async(ctx,{token,before})=>{
  await playerFor(ctx,token);
  const visits=await ctx.db.query('visits').withIndex('by_entered',q=>before?q.lt('enteredAt',before):q).order('desc').take(40);
  return {serverTime:Date.now(),visits:visits.map(({_id,name,enteredAt,leftAt,estimated})=>({id:_id,name,enteredAt,leftAt,estimated:estimated??false}))};
}});
// One-off history: every player record predates the guest book, so give each one a visit
// from their first arrival to the last time they were seen. A clean disconnect zeroes
// lastSeen, so those exits are marked estimated. Players still present get an open visit.
export const backfill=internalMutation({args:{},handler:async(ctx)=>{
  const now=Date.now(),players=await ctx.db.query('players').collect();let added=0;
  for(const p of players){
    const any=await ctx.db.query('visits').withIndex('by_open').filter(q=>q.eq(q.field('playerId'),p._id)).first();
    if(any)continue;
    const present=p.lastSeen>now-45000,entered=p._creationTime;
    const leftAt=present?null:p.lastSeen>entered?p.lastSeen:entered;
    await ctx.db.insert('visits',{playerId:p._id,name:p.name,enteredAt:entered,leftAt,estimated:!present&&p.lastSeen<=entered});added++;
  }
  return {added,players:players.length};
}});
