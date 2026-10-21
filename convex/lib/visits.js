// Guest book bookkeeping: one visit per stay. A visit opens when a player joins or comes
// back after timing out, and closes when their last connection drops or they time out.
const AWAY=45000;
export async function openVisit(ctx,player,now){
  const open=await ctx.db.query('visits').withIndex('by_open',q=>q.eq('leftAt',null)).filter(q=>q.eq(q.field('playerId'),player._id)).first();
  if(open)return;
  await ctx.db.insert('visits',{playerId:player._id,name:player.name,enteredAt:now,leftAt:null});
}
export async function closeVisits(ctx,playerId,leftAt){
  for(const visit of await ctx.db.query('visits').withIndex('by_open',q=>q.eq('leftAt',null)).filter(q=>q.eq(q.field('playerId'),playerId)).collect())await ctx.db.patch(visit._id,{leftAt});
}
// Players who stopped heartbeating without a clean disconnect: close at the moment they were last seen.
export async function closeStaleVisits(ctx,now){
  for(const visit of await ctx.db.query('visits').withIndex('by_open',q=>q.eq('leftAt',null)).take(100)){
    const player=await ctx.db.get(visit.playerId);
    if(!player)await ctx.db.patch(visit._id,{leftAt:now});
    else if(player.lastSeen<=now-AWAY)await ctx.db.patch(visit._id,{leftAt:Math.max(visit.enteredAt,player.lastSeen)});
  }
}
