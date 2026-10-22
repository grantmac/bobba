import {internal} from '../_generated/api.js';

export const identityVersion=player=>player.identityVersion??0;
export const botState=ctx=>ctx.db.query('botState').withIndex('by_key',q=>q.eq('key','main')).unique();

// One durable wake-up per bot. Earlier wake-ups replace later ones; obsolete jobs
// are harmless because tick checks the timestamp before doing any work.
export async function scheduleBotTick(ctx,state,delay=60000){
  const at=Date.now()+delay;
  if(state.nextTickAt!==undefined&&state.nextTickAt<=at&&state.nextTickAt>Date.now())return;
  await ctx.db.patch(state._id,{nextTickAt:at});
  await ctx.scheduler.runAfter(delay,internal.bot.tick,{scheduledAt:at});
}

export async function wakeBotRoaming(ctx,player){
  if(player.kind==='bot')return;
  const state=await botState(ctx);
  if(!state)return; // Maintenance/configuration installs the resident once.
  if(state.enabled&&state.roaming)await scheduleBotTick(ctx,state);
}

export async function wakeBot(ctx,state,delay=1200){
  if(!state.enabled||state.scheduled||state.busyUntil>Date.now())return;
  await ctx.db.patch(state._id,{scheduled:true});
  await ctx.scheduler.runAfter(Math.max(delay,state.lastReplyAt+3000-Date.now()),internal.botBrain.respond,{});
  // Recover an action that fails to start; claim extends this protection to its lease.
  await scheduleBotTick(ctx,state,Math.max(delay,state.lastReplyAt+3000-Date.now())+65000);
}

// Called from the same transaction as the human message/arrival. Bot output never enters here.
export async function queueBotEvent(ctx,player,kind,body='',messageId){
  if(kind==='arrival')await wakeBotRoaming(ctx,player);
  const state=await botState(ctx);
  if(!state?.enabled||player.kind==='bot'||!process.env.FIREWORKS_API_KEY)return;
  await ctx.db.insert('botEvents',{kind,playerId:player._id,identityVersion:identityVersion(player),body,
    ...(messageId?{messageId}:{}),createdAt:Date.now(),status:'pending',attempts:0});
  await wakeBot(ctx,state);
}
