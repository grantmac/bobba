import {mutation,query,internalMutation,internalQuery} from './_generated/server.js';
import {v} from 'convex/values';
import {internal} from './_generated/api.js';
import {playerFor,movePlayer} from './room.js';
import {atTime,onlinePlayers,playerTiles,freePosition,validName,fail,isOnline,layoutFor,blocked} from './lib/rules.js';
import {definitionsFor} from './lib/assets.js';
import {closeVisits} from './lib/visits.js';
import {botState,identityVersion,wakeBot} from './lib/bot_events.js';
import {BOT_LOOK,DEFAULT_BOT_NAME,DEFAULT_MODEL,DEFAULT_PERSONALITY} from './lib/bot_policy.js';
import {seatFor} from '../shared/furniture-model.js';

const mode=v.union(v.literal('off'),v.literal('warn'),v.literal('kick'));
const roomFor=ctx=>ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
const configured=()=>!!process.env.FIREWORKS_API_KEY;
const model=()=>process.env.FIREWORKS_MODEL||DEFAULT_MODEL;
const memoryText=text=>{if(!text.trim()||text.length>600)fail('Memories must contain 1–600 characters.');return text.trim();};

async function ensureBot(ctx){
  const existing=await botState(ctx);if(existing)return existing;
  const room=await roomFor(ctx);if(!room)return null;
  room.definitions=await definitionsFor(ctx);
  let name=DEFAULT_BOT_NAME;
  for(let suffix=1;await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey',name.toLowerCase())).unique();suffix++)name=`Lobby Bot ${suffix}`;
  const now=Date.now(),online=await onlinePlayers(ctx,now);
  const position=freePosition(room,undefined,playerTiles(online,now));
  const playerId=await ctx.db.insert('players',{kind:'bot',identityVersion:0,online:true,name,nameKey:name.toLowerCase(),role:'guest',look:BOT_LOOK,route:[position],startedAt:now,direction:2,seatId:null,lastSeen:now,lastChat:0});
  const id=await ctx.db.insert('botState',{key:'main',playerId,enabled:true,roaming:true,name,personality:DEFAULT_PERSONALITY,moderation:'kick',revision:0,run:0,scheduled:false,busyUntil:0,lastReplyAt:0,lastRoamAt:0});
  return ctx.db.get(id);
}

export const status=query({args:{},handler:async ctx=>{
  const state=await botState(ctx);
  return {name:state?.name??DEFAULT_BOT_NAME,playerId:state?.playerId??null,enabled:state?.enabled??false,ready:configured(),listensTo:'typed chat',state:!state?'not installed':!state.enabled?'paused':!configured()?'needs a Fireworks key':state.lastError?'temporarily unavailable':'listening'};
}});

export const manage=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  await playerFor(ctx,token,true);const state=await botState(ctx);
  const memories=await ctx.db.query('botMemories').withIndex('by_updated').order('desc').take(100);
  const moderation=await ctx.db.query('botModeration').withIndex('by_time').order('desc').take(40);
  return {settings:state??{name:DEFAULT_BOT_NAME,personality:DEFAULT_PERSONALITY,enabled:true,roaming:true,moderation:'kick'},ready:configured(),model:model(),memories,moderation};
}});

export const configure=mutation({args:{token:v.string(),name:v.string(),personality:v.string(),enabled:v.boolean(),roaming:v.boolean(),moderation:mode},handler:async(ctx,{token,...settings})=>{
  await playerFor(ctx,token,true);const named=validName(settings.name);
  if(named.key==='grant')fail('Grant is reserved.');
  if(!settings.personality.trim()||settings.personality.length>2000)fail('Personality must contain 1–2000 characters.');
  const state=await ensureBot(ctx);if(!state)fail('Enter the room first.');
  const other=await ctx.db.query('players').withIndex('by_name',q=>q.eq('nameKey',named.key)).unique();
  if(other&&other._id!==state.playerId)fail('That name is already taken.');
  await ctx.db.patch(state.playerId,{name:named.name,nameKey:named.key,online:true});
  await ctx.db.patch(state._id,{...settings,name:named.name,revision:state.revision+1,lastError:undefined});
  if(!settings.enabled){
    for(const status of ['pending','running'])for(const event of await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status',status)).take(100))await ctx.db.patch(event._id,{status:'done'});
    await ctx.db.patch(state._id,{busyUntil:0,scheduled:false,run:state.run+1});
  }else await wakeBot(ctx,await ctx.db.get(state._id));
}});

export const saveMemory=mutation({args:{token:v.string(),id:v.optional(v.id('botMemories')),text:v.string()},handler:async(ctx,{token,id,text})=>{
  await playerFor(ctx,token,true);const value=memoryText(text);
  const state=await ensureBot(ctx);if(state)await ctx.db.patch(state._id,{revision:state.revision+1});
  if(id){if(!await ctx.db.get(id))fail('That memory was deleted.');await ctx.db.patch(id,{text:value,locked:true,source:'Grant',updatedAt:Date.now()});return id;}
  if((await ctx.db.query('botMemories').take(100)).length>=100)fail('Delete an old memory before adding another.');
  return ctx.db.insert('botMemories',{text:value,locked:true,source:'Grant',updatedAt:Date.now()});
}});
export const forgetMemory=mutation({args:{token:v.string(),id:v.id('botMemories')},handler:async(ctx,{token,id})=>{
  await playerFor(ctx,token,true);if(await ctx.db.get(id))await ctx.db.delete(id);
  const state=await botState(ctx);if(state)await ctx.db.patch(state._id,{revision:state.revision+1});
}});

async function say(ctx,state,text){
  const p=await ctx.db.get(state.playerId);if(!p)return;
  const now=Date.now();
  await ctx.db.insert('messages',{playerId:p._id,name:p.name,color:p.look.top.color,body:text.slice(0,400),mode:'Say',...atTime(p,now),sentAt:now});
  await ctx.db.patch(p._id,{lastChat:now});
  await ctx.db.patch(state._id,{lastReplyAt:now});
}

async function moderate(ctx,state,event,reason){
  if(state.moderation==='off'||event.kind!=='chat')return;
  const player=await ctx.db.get(event.playerId),now=Date.now();
  if(!player||player.role==='admin'||player.kind==='bot'||identityVersion(player)!==event.identityVersion||!isOnline(player)||player.blockedUntil>now)return;
  if(await ctx.db.query('botModeration').withIndex('by_event',q=>q.eq('eventId',event._id)).unique())return;
  const recent=await ctx.db.query('botModeration').withIndex('by_player',q=>q.eq('playerId',player._id).gt('createdAt',now-30*60000)).collect();
  const priorWarning=recent.some(m=>m.decision==='warn'&&m.identityVersion===event.identityVersion&&m.createdAt<event.createdAt);
  const decision=state.moderation==='kick'&&priorWarning?'kick':'warn',expiresAt=now+10*60000;
  const id=await ctx.db.insert('botModeration',{eventId:event._id,playerId:player._id,identityVersion:event.identityVersion,name:player.name,decision,reason,evidence:event.body,createdAt:now,...(decision==='kick'?{expiresAt}:{})});
  if(decision==='warn'){await say(ctx,state,`${player.name}, please keep the room friendly. ${reason}`);return;}
  await ctx.db.patch(player._id,{blockedUntil:expiresAt,online:false,typingUntil:0,action:null});
  for(const session of await ctx.db.query('sessions').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.patch(session._id,{blockedUntil:expiresAt});
  for(const connection of await ctx.db.query('connections').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(connection._id);
  await closeVisits(ctx,player._id,now);
  await ctx.scheduler.runAfter(0,internal.botVoice.remove,{playerId:player._id,moderationId:id,attempt:0});
  await say(ctx,state,`${player.name} has been removed for 10 minutes after a repeated violation. ${reason}`);
}

export const restore=mutation({args:{token:v.string(),playerId:v.id('players')},handler:async(ctx,{token,playerId})=>{
  await playerFor(ctx,token,true);const player=await ctx.db.get(playerId);if(!player)return;
  await ctx.db.patch(playerId,{blockedUntil:undefined});
  for(const session of await ctx.db.query('sessions').withIndex('by_player',q=>q.eq('playerId',playerId)).collect())await ctx.db.patch(session._id,{blockedUntil:undefined});
  await ctx.db.insert('botModeration',{playerId,identityVersion:identityVersion(player),name:player.name,decision:'restore',reason:'Restored by Grant',evidence:'',createdAt:Date.now()});
}});

// A durable lease serializes turns. The minute tick recovers an action that never started/finished.
export const claim=internalMutation({args:{},handler:async ctx=>{
  const state=await botState(ctx),now=Date.now();
  if(!state?.enabled||state.busyUntil>now)return null;
  if(!configured()){await ctx.db.patch(state._id,{scheduled:false,lastError:'Add FIREWORKS_API_KEY to the backend environment.'});return null;}
  for(const old of await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','running')).take(20))await ctx.db.patch(old._id,{status:old.attempts>=3?'failed':'pending'});
  const pending=await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','pending')).take(20),events=[];
  for(const event of pending){
    const p=await ctx.db.get(event.playerId);
    if(!p||identityVersion(p)!==event.identityVersion||!isOnline(p)||event.createdAt<now-120000||p.blockedUntil>now){await ctx.db.patch(event._id,{status:'done'});continue;}
    events.push({...event,name:p.name,role:p.role});
  }
  if(!events.length){await ctx.db.patch(state._id,{scheduled:false,busyUntil:0});return null;}
  const run=state.run+1;
  for(const event of events)await ctx.db.patch(event._id,{status:'running',run,attempts:event.attempts+1});
  await ctx.db.patch(state._id,{run,busyUntil:now+60000,scheduled:false});
  const players=await onlinePlayers(ctx,now),room=await roomFor(ctx),bot=await ctx.db.get(state.playerId);
  room.definitions=await definitionsFor(ctx);
  const memories=(await ctx.db.query('botMemories').withIndex('by_updated').order('desc').take(100)).filter(m=>!m.playerId||players.some(p=>p._id===m.playerId&&identityVersion(p)===m.identityVersion));
  const recent=(await ctx.db.query('messages').withIndex('by_time',q=>q.gt('sentAt',now-120000)).order('desc').take(25)).reverse();
  const at=atTime(bot,now),occupied=playerTiles(players,now,bot._id);
  const tiles=layoutFor(room.options,room.spaces??[]).tiles.filter(([x,z])=>!occupied.has(`${x},${z}`)&&!blocked(room,x,z)).sort((a,b)=>Math.hypot(a[0]-at.x,a[1]-at.z)-Math.hypot(b[0]-at.x,b[1]-at.z)).slice(0,80);
  const seats=room.furniture.filter(i=>i.x!==null).flatMap(i=>{const seat=seatFor(i,room.definitions[i.type]);return seat?seat.cells.map(([x,z])=>({seatId:i.id,x,z})):[];}).slice(0,40);
  return {run,revision:state.revision,state,model:model(),context:{events:events.map(e=>({id:e._id,kind:e.kind,playerId:e.playerId,name:e.name,role:e.role,body:e.body})),recent:recent.map(m=>({name:m.name,body:m.body,bot:m.playerId===state.playerId})),players:players.map(p=>({id:p._id,name:p.name,kind:p.kind??'human',...atTime(p,now)})),memories:memories.map(m=>({id:m._id,text:m.text,playerId:m.playerId??null,locked:m.locked})),position:at,nearbyTiles:tiles,seats}};
}});

export const finish=internalMutation({args:{run:v.number(),revision:v.number(),turn:v.any()},handler:async(ctx,{run,revision,turn})=>{
  const state=await botState(ctx);if(!state||state.run!==run||!state.busyUntil)return;
  const events=(await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','running')).take(20)).filter(e=>e.run===run);
  if(!state.enabled||state.revision!==revision){
    for(const event of events)await ctx.db.patch(event._id,{status:state.enabled?'pending':'done'});
    await ctx.db.patch(state._id,{busyUntil:0});await wakeBot(ctx,{...state,busyUntil:0});return;
  }
  const allowed=new Map();
  for(const event of events){const p=await ctx.db.get(event.playerId);if(p&&identityVersion(p)===event.identityVersion&&isOnline(p)&&!(p.blockedUntil>Date.now()))allowed.set(event._id,{event,player:p});}
  // Re-check speaker identity after the external model call before applying anything.
  if(allowed.size){
    const moderated=new Set();
    for(const violation of turn.violations){const source=allowed.get(violation.eventId);if(source&&!moderated.has(source.player._id)){moderated.add(source.player._id);await moderate(ctx,state,source.event,violation.reason);}}
    for(const change of turn.memories){
      const source=allowed.get(change.sourceEventId);if(!source||source.event.kind!=='chat')continue;
      const admin=source.player.role==='admin';if(change.scope==='room'&&!admin)continue;
      const memories=await ctx.db.query('botMemories').take(100);
      if(change.operation==='forget'){
        const memory=memories.find(m=>m._id===change.memoryId);
        if(memory&&(admin||(!memory.locked&&memory.playerId===source.player._id&&memory.identityVersion===source.event.identityVersion)))await ctx.db.delete(memory._id);
      }else if(change.operation==='remember'){
        const text=memoryText(change.text),owner=change.scope==='visitor'?source.player._id:undefined;
        const existing=memories.find(m=>m._id===change.memoryId),fields={text,source:`${source.player.name}: ${source.event.body}`.slice(0,600),updatedAt:Date.now()};
        if(existing){if(admin||(!existing.locked&&existing.playerId===owner&&existing.identityVersion===source.event.identityVersion))await ctx.db.patch(existing._id,fields);}
        else if(memories.length<100&&!memories.some(m=>m.text===text&&m.playerId===owner))await ctx.db.insert('botMemories',{...fields,locked:false,...(owner?{playerId:owner,identityVersion:source.event.identityVersion}:{})});
      }
    }
    const bot=await ctx.db.get(state.playerId);
    if(turn.move)try{await movePlayer(ctx,bot,turn.move);}catch{/* Occupancy can change while the model is thinking. Keep the current position. */}
    if(turn.wave===true)await ctx.db.patch(bot._id,{action:'wave',actionStarted:Date.now()});
    if(turn.reply.trim()&&Date.now()-state.lastReplyAt>=3000&&!turn.violations.length)await say(ctx,state,turn.reply.trim());
  }
  for(const event of events)await ctx.db.patch(event._id,{status:'done'});
  await ctx.db.patch(state._id,{busyUntil:0,lastError:undefined});
  if(await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','pending')).first())await wakeBot(ctx,{...state,busyUntil:0},3000);
}});

export const failed=internalMutation({args:{run:v.number(),message:v.string(),retry:v.boolean()},handler:async(ctx,{run,message,retry})=>{
  const state=await botState(ctx);if(!state||state.run!==run||!state.busyUntil)return;
  const events=await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','running')).take(20);
  let pending=false;
  for(const event of events)if(event.run===run){const again=retry&&event.attempts<3;pending||=again;await ctx.db.patch(event._id,{status:again?'pending':'failed'});}
  await ctx.db.patch(state._id,{busyUntil:0,lastError:message.slice(0,200)});
  if(pending)await wakeBot(ctx,{...state,busyUntil:0},10000);
}});

export const tick=internalMutation({args:{},handler:async ctx=>{
  const state=await ensureBot(ctx);if(!state)return;
  const now=Date.now();
  // Keep the resident visible while paused or when Fireworks is unavailable.
  const bot=await ctx.db.get(state.playerId);if(bot.online!==true)await ctx.db.patch(bot._id,{online:true});
  if(state.enabled&&state.busyUntil<=now){
    if(state.scheduled)await ctx.db.patch(state._id,{scheduled:false});
    const pending=await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','pending')).first();
    const running=await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status','running')).first();
    if(pending||running)await wakeBot(ctx,{...state,scheduled:false,busyUntil:0},0);
    if(state.roaming&&now-state.lastRoamAt>=60000){
      const players=await onlinePlayers(ctx,now);
      if(players.some(p=>p.kind!=='bot')){
        const room=await roomFor(ctx),tiles=layoutFor(room.options,room.spaces??[]).tiles;
        for(let offset=0;offset<8;offset++){
          const [x,z]=tiles[(Math.floor(now/60000)*17+offset*13)%tiles.length];
          try{await movePlayer(ctx,bot,{x,z});break;}catch{/* Try another free destination. */}
        }
        await ctx.db.patch(state._id,{lastRoamAt:now});
      }
    }
  }
  for(const status of ['done','failed'])for(const event of await ctx.db.query('botEvents').withIndex('by_status',q=>q.eq('status',status).lt('createdAt',now-86400000)).take(100))await ctx.db.delete(event._id);
}});

export const voiceResult=internalMutation({args:{id:v.id('botModeration'),error:v.optional(v.string())},handler:async(ctx,{id,error})=>{if(await ctx.db.get(id))await ctx.db.patch(id,{voiceError:error});}});
export const voiceRemoval=internalQuery({args:{playerId:v.id('players'),moderationId:v.id('botModeration')},handler:async(ctx,{playerId,moderationId})=>{
  const player=await ctx.db.get(playerId),entry=await ctx.db.get(moderationId);
  if(!player||!entry||entry.identityVersion!==identityVersion(player)||!(player.blockedUntil>Date.now()))return null;
  return {revokeBefore:Math.floor(entry.createdAt/1000)+60,identities:(await ctx.db.query('voiceGrants').withIndex('by_player',q=>q.eq('playerId',playerId)).collect()).map(g=>g.identity)};
}});
