// Picking up preserves instance state; deleting the instance removes it.
export async function discardRemovedPrograms(ctx,previous,next){
  const keep=new Set(next.map(item=>item.id));
  for(const item of previous){
    if(keep.has(item.id)||!item.type.startsWith('asset_'))continue;
    const row=await ctx.db.query('programInstances').withIndex('by_item',q=>q.eq('itemId',item.id)).unique();
    if(row)await ctx.db.delete(row._id);
  }
}
