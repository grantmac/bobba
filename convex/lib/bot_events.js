import {internal} from '../_generated/api.js';

export const identityVersion=player=>player.identityVersion??0;
export const botState=ctx=>ctx.db.query('botState').withIndex('by_key',q=>q.eq('key','main')).unique();

export async function wakeBot(ctx,state,delay=1200){
  if(!state.enabled||state.scheduled||state.busyUntil>Date.now())return;
  await ctx.db.patch(state._id,{scheduled:true});
  await ctx.scheduler.runAfter(Math.max(delay,state.lastReplyAt+3000-Date.now()),internal.botBrain.respond,{});
}

// Called from the same transaction as the human message/arrival. Bot output never enters here.
export async function queueBotEvent(ctx,player,kind,body='',messageId){
  const state=await botState(ctx);
  if(!state?.enabled||player.kind==='bot'||!process.env.FIREWORKS_API_KEY)return;
  await ctx.db.insert('botEvents',{kind,playerId:player._id,identityVersion:identityVersion(player),body,
    ...(messageId?{messageId}:{}),createdAt:Date.now(),status:'pending',attempts:0});
  await wakeBot(ctx,state);
}
