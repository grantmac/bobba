import {internal} from '../_generated/api.js';
import {atTime} from './rules.js';
import {CONVERSATION_MS,hearsChat,mentionsBot} from './bot_policy.js';

export const identityVersion=player=>player.identityVersion??0;
export const inBotConversation=(player,now)=>player.botConversation?.identityVersion===identityVersion(player)&&player.botConversation.until>now;
export async function renewBotConversation(ctx,player){
  await ctx.db.patch(player._id,{botConversation:{identityVersion:identityVersion(player),until:Date.now()+CONVERSATION_MS}});
}
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
  let conversation=false;
  if(kind==='chat'){
    const bot=await ctx.db.get(state.playerId),now=Date.now();
    const mentioned=mentionsBot(body,state.name);
    conversation=mentioned||inBotConversation(player,now);
    const heardByBot=!!bot&&(conversation||hearsChat(body,state.name,atTime(player,now),atTime(bot,now)));
    // Preserve hearing at send time, even if either avatar moves before the AI responds.
    if(messageId)await ctx.db.patch(messageId,{heardByBot});
    if(!heardByBot)return;
    if(mentioned)await renewBotConversation(ctx,player);
  }
  await ctx.db.insert('botEvents',{kind,playerId:player._id,identityVersion:identityVersion(player),body,conversation,
    ...(messageId?{messageId}:{}),createdAt:Date.now(),status:'pending',attempts:0});
  await wakeBot(ctx,state);
}
