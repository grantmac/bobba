import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {parseTurn} from '../convex/lib/bot_policy.js';
const modules=import.meta.glob('../convex/**/*.js');
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const token='a'.repeat(64),adminToken='b'.repeat(64),otherToken='c'.repeat(64);
let t;
beforeEach(async()=>{
  vi.useFakeTimers();t=convexTest(schema,modules);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test')))].map(b=>b.toString(16).padStart(2,'0')).join('');
  vi.stubEnv('GRANT_ENTRY_HASH',hash);
  await t.mutation(api.room.join,{token:adminToken,name:'Grant',look,entryCode:'test'});
  await t.mutation(api.room.join,{token,name:'Visitor',look});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const setup=(name='Lobby')=>t.mutation(api.bot.configure,{token:adminToken,name,personality:'A welcoming room host.',enabled:true,roaming:true,moderation:'kick'});
const emptyTurn=()=>({reply:'',memories:[],violations:[]});
async function message(body='Lobby, hello!'){
  vi.stubEnv('FIREWORKS_API_KEY','test-key');vi.setSystemTime(Date.now()+3501);
  await t.mutation(api.room.chat,{token,body,mode:'Say'});
  return t.mutation(internal.bot.claim,{});
}
const finish=(job,turn)=>t.mutation(internal.bot.finish,{run:job.run,revision:job.revision,turn});
const resident=async()=> (await t.query(api.room.presence,{})).players.find(p=>p.kind==='bot');

async function hearingSetup(dx,dz=0){
  await setup('Tnarg');vi.stubEnv('FIREWORKS_API_KEY','test-key');
  const visitor=await t.query(api.room.me,{token}),bot=await resident();
  await t.run(async ctx=>{
    await ctx.db.patch(bot.id,{route:[{x:1.5,z:1.5}],startedAt:Date.now()});
    await ctx.db.patch(visitor.id,{route:[{x:1.5+dx,z:1.5+dz}],startedAt:Date.now()});
  });
  return {visitor,bot};
}

it.each([
  [5,0,'Hello there!',true],
  [6,0,'Hello there!',true],
  [6.01,0,'Hello there!',false],
  [4,4,'Hello there!',true],
  [5,5,'Hello there!',false],
  [20,0,'Hey TNARG!',true],
  [20,0,'@tnarg, can you hear me?',true],
  [20,0,"Tnarg's got moves",true],
  [20,0,'Antnarg is here',false],
  [20,0,'Tnargish',false],
])('limits chat at offset %s,%s with message %s',async(dx,dz,body,heard)=>{
  await hearingSetup(dx,dz);
  const job=await message(body);
  expect(job!==null).toBe(heard);
  if(heard){
    await finish(job,{...emptyTurn(),reply:'Hello Visitor!'});
    expect((await t.query(api.room.worldChatFeed,{token})).some(m=>m.name==='Tnarg')).toBe(true);
  }else{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await t.action(internal.botBrain.respond,{});
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run(ctx=>ctx.db.query('botEvents').collect())).toEqual([]);
  }
});

it('does not pass distant unaddressed chat as context for a later named message',async()=>{
  await hearingSetup(20);
  expect(await message('An unrelated distant conversation.')).toBeNull();
  const job=await message('Tnarg, hello!');
  expect(job.context.events.map(e=>e.body)).toEqual(['Tnarg, hello!']);
  expect(job.context.recent.map(m=>m.body)).toEqual(['Tnarg, hello!']);
  expect((await t.query(api.room.worldChatFeed,{token})).map(m=>m.body)).toEqual(['An unrelated distant conversation.','Tnarg, hello!']);
});

it('uses positions at send time even when both avatars move before processing',async()=>{
  const {visitor,bot}=await hearingSetup(6);
  await t.mutation(api.room.chat,{token,body:'Hello there!',mode:'Say'});
  await t.run(async ctx=>{
    await ctx.db.patch(visitor.id,{route:[{x:20.5,z:1.5}],startedAt:Date.now()});
    await ctx.db.patch(bot.id,{route:[{x:0.5,z:0.5}],startedAt:Date.now()});
  });
  const job=await t.mutation(internal.bot.claim,{});
  expect(job.context.events.map(e=>e.body)).toEqual(['Hello there!']);
  expect(job.context.recent.map(m=>m.body)).toEqual(['Hello there!']);
  await finish(job,emptyTurn());
  expect(await message('Still talking from far away.')).toBeNull();
  await t.run(ctx=>ctx.db.patch(visitor.id,{route:[{x:1.5,z:0.5}],startedAt:Date.now()}));
  expect(await t.mutation(internal.bot.claim,{})).toBeNull();
});

it('applies the range rule to old queued messages without a hearing snapshot',async()=>{
  const {bot}=await hearingSetup(6);
  await t.mutation(api.room.chat,{token,body:'An old queued message.',mode:'Say'});
  await t.run(async ctx=>{
    const message=await ctx.db.query('messages').first();
    await ctx.db.patch(message._id,{heardByBot:undefined});
    await ctx.db.patch(bot.id,{route:[{x:20.5,z:1.5}],startedAt:Date.now()});
  });
  expect(await t.mutation(internal.bot.claim,{})).toBeNull();
  expect((await t.run(ctx=>ctx.db.query('botEvents').first())).status).toBe('done');
});

it('shares a spontaneous dance, keeps it across turns, switches styles and stops on request',async()=>{
  await setup();await t.mutation(api.room.gesture,{token,action:'dance'});
  const job=await message('This is a great party!');
  expect(job.context.players.find(p=>p.name==='Visitor').action).toBe('dance');
  expect(job.context.action).toBeNull();
  await finish(job,{...emptyTurn(),dance:'dance'});
  const started=await resident();expect(started.action).toBe('dance');expect(started.actionStarted).toBe(Date.now());
  const next=await message('Keep dancing!');expect(next.context.action).toBe('dance');
  await finish(next,{...emptyTurn(),dance:'dance'});
  expect((await resident()).actionStarted).toBe(started.actionStarted);
  await finish(await message('Nice moves!'),emptyTurn());expect((await resident()).action).toBe('dance');
  await finish(await message('Now breakdance!'),{...emptyTurn(),dance:'breakdance',wave:true});
  expect((await resident()).action).toBe('breakdance');
  await finish(await message('Stop dancing please.'),{...emptyTurn(),dance:'stop'});
  expect((await resident()).action).toBeNull();
});

it('dances after walking, stops when sitting, and leaves a seat safely to dance again',async()=>{
  await setup();
  await t.mutation(api.room.setFurniture,{token:adminToken,items:[{id:'seat',type:'small_chair_armas',rotation:0,x:1,z:1}],revision:0});
  await finish(await message('Walk over and dance.'),{...emptyTurn(),move:{x:7,z:7},dance:'dance'});
  let bot=await resident();expect(bot.action).toBe('dance');expect(bot.route.at(-1)).toEqual({x:7.5,z:7.5});
  await finish(await message('Take a seat.'),{...emptyTurn(),move:{x:1,z:1,seatId:'seat'}});
  bot=await resident();expect(bot.seatId).toBe('seat');expect(bot.action).toBeNull();
  vi.setSystemTime(Date.now()+10000);
  await finish(await message('Dance again!'),{...emptyTurn(),dance:'dance'});
  bot=await resident();expect(bot.action).toBe('dance');expect(bot.seatId).toBeNull();
  expect(bot.route).toHaveLength(1);expect(bot.route[0]).not.toEqual({x:1.5,z:1.5});
  const players=(await t.query(api.room.presence,{})).players.filter(p=>p.kind!=='bot');
  expect(players.some(p=>p.route.some(at=>at.x===bot.route[0].x&&at.z===bot.route[0].z))).toBe(false);
});

it('executes a dance requested through the model tool response',async()=>{
  await setup();vi.stubEnv('FIREWORKS_API_KEY','test-key');
  await t.mutation(api.room.chat,{token,body:'Lobby, dance with us!',mode:'Say'});
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
    const request=JSON.parse(options.body);
    expect(request.tools[0].function.parameters.properties.dance.enum).toEqual(['dance','breakdance','stop']);
    expect(request.messages[0].content).toContain('dance spontaneously');
    return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'room_turn',arguments:JSON.stringify({...emptyTurn(),dance:'dance'})}}]}}]})};
  }));
  await t.action(internal.botBrain.respond,{});
  expect((await resident()).action).toBe('dance');
});

it('rejects invalid dance tool arguments before applying a turn',()=>{
  const parse=dance=>parseTurn({tool_calls:[{function:{name:'room_turn',arguments:JSON.stringify({...emptyTurn(),dance})}}]});
  for(const dance of ['dance','breakdance','stop',undefined])expect(()=>parse(dance)).not.toThrow();
  for(const dance of [true,false,null,1,{},'spin'])expect(()=>parse(dance)).toThrow('invalid dance action');
});

it('stops scheduled roaming when empty and restarts on arrival without an AI key',async()=>{
  await setup();
  await t.run(async ctx=>{for(const p of await ctx.db.query('players').collect())if(p.kind!=='bot')await ctx.db.patch(p._id,{online:false,lastSeen:0});});
  let state=await t.run(ctx=>ctx.db.query('botState').first());
  vi.setSystemTime(state.nextTickAt);
  await t.mutation(internal.bot.tick,{scheduledAt:state.nextTickAt});
  state=await t.run(ctx=>ctx.db.query('botState').first());expect(state.nextTickAt).toBeUndefined();
  const arrival=await t.mutation(api.room.join,{token:otherToken,name:'New arrival',look});
  await t.run(ctx=>ctx.db.patch(arrival.id,{online:true}));
  state=await t.run(ctx=>ctx.db.query('botState').first());expect(state.nextTickAt).toBe(Date.now()+60000);
  const at=state.nextTickAt;vi.setSystemTime(at);
  await t.mutation(internal.bot.tick,{scheduledAt:at});
  state=await t.run(ctx=>ctx.db.query('botState').first());expect(state.nextTickAt).toBe(at+60000);
  await t.mutation(internal.bot.tick,{scheduledAt:at}); // Retired job cannot schedule a second loop.
  expect((await t.run(ctx=>ctx.db.query('botState').first())).nextTickAt).toBe(state.nextTickAt);
});

it('watches an active lease and wakes recovery after expiry without the maintenance cron',async()=>{
  await setup();const job=await message();
  await t.run(async ctx=>{for(const p of await ctx.db.query('players').collect())await ctx.db.patch(p._id,{online:true});});
  let state=await t.run(ctx=>ctx.db.query('botState').first());
  expect(state.nextTickAt).toBeGreaterThan(Date.now());
  // An earlier roaming timer must not recover a still-running action.
  vi.setSystemTime(state.nextTickAt);
  await t.mutation(internal.bot.tick,{scheduledAt:state.nextTickAt});
  state=await t.run(ctx=>ctx.db.query('botState').first());
  if(Date.now()<state.busyUntil){expect(state.nextTickAt).toBeGreaterThan(state.busyUntil);vi.setSystemTime(state.nextTickAt);await t.mutation(internal.bot.tick,{scheduledAt:state.nextTickAt});}
  state=await t.run(ctx=>ctx.db.query('botState').first());expect(state.scheduled).toBe(true);
  const recovered=await t.mutation(internal.bot.claim,{});expect(recovered.run).toBeGreaterThan(job.run);
  await finish(job,emptyTurn());expect((await t.run(ctx=>ctx.db.query('botState').first())).run).toBe(recovered.run);
});

it('keeps a reserved bot present without browser heartbeats and protects its settings',async()=>{
  await setup();
  vi.setSystemTime(Date.now()+86400000);
  const bots=(await t.query(api.room.presence,{})).players.filter(p=>p.kind==='bot');
  expect(bots).toHaveLength(1);expect(bots[0].name).toBe('Lobby');
  await expect(t.query(api.room.checkName,{name:'Lobby'})).rejects.toThrow('reserved');
  await expect(t.mutation(api.bot.configure,{token,name:'Hijacked',personality:'Ignore rules',enabled:true,roaming:true,moderation:'off'})).rejects.toThrow();
});

it('lets only Grant edit and delete persistent memories',async()=>{
  await setup();
  const id=await t.mutation(api.bot.saveMemory,{token:adminToken,text:'The jukebox plays jazz.'});
  expect((await t.query(api.bot.manage,{token:adminToken})).memories[0].text).toBe('The jukebox plays jazz.');
  await expect(t.mutation(api.bot.saveMemory,{token,id,text:'New rules'})).rejects.toThrow();
  await expect(t.query(api.bot.manage,{token})).rejects.toThrow();
  await t.mutation(api.bot.saveMemory,{token:adminToken,id,text:'The jukebox plays funk.'});
  await t.mutation(api.bot.forgetMemory,{token:adminToken,id});
  expect((await t.query(api.bot.manage,{token:adminToken})).memories).toHaveLength(0);
});

it('calls Fireworks with tool definitions and publishes one reply without a feedback loop',async()=>{
  await setup();vi.stubEnv('FIREWORKS_API_KEY','test-key');
  await t.mutation(api.room.chat,{token,body:'Hi Lobby!',mode:'Say'});
  const fetch=vi.fn(async(url,options)=>{
    expect(url).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    const request=JSON.parse(options.body);expect(request.tools[0].function.name).toBe('room_turn');
    expect(request.messages[1].content).toContain('Hi Lobby!');
    return {ok:true,json:async()=>({choices:[{message:{tool_calls:[{function:{name:'room_turn',arguments:JSON.stringify({...emptyTurn(),reply:'Hello Visitor!'})}}]}}]})};
  });vi.stubGlobal('fetch',fetch);
  await t.action(internal.botBrain.respond,{});
  await t.action(internal.botBrain.respond,{});
  expect(fetch).toHaveBeenCalledTimes(1);
  const feed=await t.query(api.room.chatFeed,{token});expect(feed.filter(m=>m.name==='Lobby').map(m=>m.body)).toEqual(['Hello Visitor!']);
  expect((await t.run(ctx=>ctx.db.query('botEvents').collect())).map(e=>e.status)).toEqual(['done']);
});

it('hears world chat and remembers its remote speaker while keeping movement local',async()=>{
  await setup();
  const {agentToken}=await t.mutation(api.agents.createKey,{token});
  const {spaceId}=await t.mutation(api.agents.addSpace,{agentToken,name:'Workshop'});
  await t.mutation(api.room.teleport,{token,spaceId});
  const visitor=await t.query(api.room.me,{token});
  await t.run(ctx=>ctx.db.insert('botMemories',{text:'Visitor likes jazz.',playerId:visitor.id,identityVersion:0,locked:false,source:'Visitor',updatedAt:Date.now()}));
  const job=await message('Lobby, can you hear me from the Workshop?');
  expect(job).not.toBeNull();
  expect(job.context.events).toEqual([expect.objectContaining({name:'Visitor',body:'Lobby, can you hear me from the Workshop?'})]);
  expect(job.context.recent).toContainEqual(expect.objectContaining({name:'Visitor',body:'Lobby, can you hear me from the Workshop?'}));
  expect(job.context.memories).toContainEqual(expect.objectContaining({text:'Visitor likes jazz.'}));
  expect(job.context.players.map(p=>p.id)).not.toContain(visitor.id);
  await finish(job,{...emptyTurn(),reply:'Yes, Visitor!'});
  expect((await t.query(api.room.worldChatFeed,{token})).filter(m=>m.name==='Lobby').map(m=>m.body)).toEqual(['Yes, Visitor!']);
  expect((await resident()).zone).toBe('main');
});

it('warns first, then blocks every session and building key, and lets Grant restore access',async()=>{
  await setup();const player=await t.query(api.room.me,{token});
  const {agentToken}=await t.mutation(api.agents.createKey,{token});
  await t.run(async ctx=>{const s=await ctx.db.query('sessions').withIndex('by_player',q=>q.eq('playerId',player.id)).first();await ctx.db.insert('sessions',{...Object.fromEntries(Object.entries(s).filter(([k])=>!k.startsWith('_'))),tokenHash:'another-session'});});
  const first=await message('A first bad message');
  await finish(first,{...emptyTurn(),violations:[{eventId:first.context.events[0].id,reason:'Please avoid profanity.',category:'profanity'}]});
  expect(await t.query(api.room.me,{token})).toBeTruthy();
  const second=await message('A second bad message');
  const action={...emptyTurn(),violations:[{eventId:second.context.events[0].id,reason:'Repeated profanity.',category:'profanity'}]};
  await finish(second,action);await finish(second,action);
  const history=(await t.query(api.bot.manage,{token:adminToken})).moderation;
  expect(history.map(m=>m.decision)).toEqual(['kick','warn']);
  for(const fn of [()=>t.query(api.room.chatFeed,{token}),()=>t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64)}),()=>t.mutation(api.room.move,{token,x:7,z:7}),()=>t.query(internal.room.voiceIdentity,{token}),()=>t.mutation(api.room.join,{token:otherToken,name:'Visitor',look})])await expect(fn()).rejects.toThrow('removed');
  await expect(t.query(api.agents.status,{agentToken})).rejects.toThrow('removed');
  expect((await t.run(ctx=>ctx.db.query('sessions').withIndex('by_player',q=>q.eq('playerId',player.id)).collect())).every(s=>s.blockedUntil>Date.now())).toBe(true);
  expect((await t.query(api.room.presence,{})).players.some(p=>p.id===player.id)).toBe(false);
  await t.mutation(api.bot.restore,{token:adminToken,playerId:player.id});
  await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64)});
  expect((await t.query(api.room.presence,{})).players.some(p=>p.id===player.id)).toBe(true);
});

it('rejects fabricated evidence and cannot moderate Grant',async()=>{
  await setup();vi.stubEnv('FIREWORKS_API_KEY','test-key');
  await t.mutation(api.room.chat,{token:adminToken,body:'A quoted example',mode:'Say'});
  const job=await t.mutation(internal.bot.claim,{});
  await finish(job,{...emptyTurn(),violations:[{eventId:job.context.events[0].id,reason:'Bad words',category:'profanity'},{eventId:'invented',reason:'Bad words',category:'profanity'}]});
  expect((await t.query(api.bot.manage,{token:adminToken})).moderation).toEqual([]);
});

it.each(['warn','off'])('respects the %s moderation setting even for repeated violations',async moderation=>{
  await setup();await t.mutation(api.bot.configure,{token:adminToken,name:'Lobby',personality:'A room host.',enabled:true,roaming:false,moderation});
  for(let i=0;i<2;i++){const job=await message(`Offence ${i}`);await finish(job,{...emptyTurn(),violations:[{eventId:job.context.events[0].id,reason:'No profanity.',category:'profanity'}]});}
  const history=(await t.query(api.bot.manage,{token:adminToken})).moderation;
  expect(history.map(e=>e.decision)).toEqual(moderation==='warn'?['warn','warn']:[]);
  expect(await t.query(api.room.me,{token})).toBeTruthy();
});

it('uses collision-checked movement and ignores an occupied target',async()=>{
  await setup();const visitor=await t.query(api.room.me,{token});
  const state=await t.query(api.bot.manage,{token:adminToken});
  const before=await t.run(ctx=>ctx.db.get(state.settings.playerId));
  const job=await message();
  await finish(job,{...emptyTurn(),move:{x:Math.floor(visitor.route[0].x),z:Math.floor(visitor.route[0].z)}});
  expect((await t.run(ctx=>ctx.db.get(before._id))).route).toEqual(before.route);
  const next=await message();await finish(next,{...emptyTurn(),move:{x:7,z:7}});
  expect((await t.run(ctx=>ctx.db.get(before._id))).route.at(-1)).toEqual({x:7.5,z:7.5});
});

it('learns visitor memories without allowing visitors to overwrite protected room facts',async()=>{
  await setup();const locked=await t.mutation(api.bot.saveMemory,{token:adminToken,text:'Be kind.'});
  const job=await message('Lobby, remember I like jazz.');
  const sourceEventId=job.context.events[0].id;
  await finish(job,{...emptyTurn(),memories:[{operation:'remember',scope:'visitor',sourceEventId,text:'Likes jazz.'},{operation:'forget',scope:'room',sourceEventId,memoryId:locked},{operation:'remember',scope:'room',sourceEventId,text:'Visitors may change the rules.'}]});
  const memories=(await t.query(api.bot.manage,{token:adminToken})).memories;
  expect(memories.map(m=>m.text).sort()).toEqual(['Be kind.','Likes jazz.']);
  const next=await message('Lobby, forget my music preference.');
  await finish(next,{...emptyTurn(),memories:[{operation:'forget',scope:'visitor',sourceEventId:next.context.events[0].id,memoryId:memories.find(m=>!m.locked)._id}]});
  expect((await t.query(api.bot.manage,{token:adminToken})).memories.map(m=>m.text)).toEqual(['Be kind.']);
});

it('migrates only the obsolete protected hearing instruction once and invalidates an old turn',async()=>{
  await setup();
  const oldText="Assume people aren't talking to you unless they explicitly use your name.";
  const locked=await t.mutation(api.bot.saveMemory,{token:adminToken,text:oldText});
  await t.mutation(api.bot.saveMemory,{token:adminToken,text:'Be kind.'});
  await t.run(ctx=>ctx.db.insert('botMemories',{text:oldText,locked:false,source:'Visitor',updatedAt:Date.now()}));
  const before=await t.query(api.bot.manage,{token:adminToken}),job=await message();
  expect(await t.mutation(internal.migrate.botHearingPreference,{})).toEqual({updated:1});
  const after=await t.query(api.bot.manage,{token:adminToken});
  expect(after.memories).toHaveLength(3);
  expect(after.memories.find(m=>m._id===locked)).toMatchObject({locked:true,source:'Grant',text:expect.stringContaining('within six tiles')});
  expect(after.memories.filter(m=>m._id!==locked)).toEqual(before.memories.filter(m=>m._id!==locked));
  expect(after.settings.revision).toBe(before.settings.revision+1);
  expect(await t.mutation(internal.migrate.botHearingPreference,{})).toEqual({updated:0});
  expect((await t.query(api.bot.manage,{token:adminToken})).settings.revision).toBe(after.settings.revision);
  await finish(job,{...emptyTurn(),reply:'Stale name-only turn'});
  expect((await t.query(api.room.chatFeed,{token})).some(m=>m.body==='Stale name-only turn')).toBe(false);
});

it('updates a remembered preference in place and cannot overwrite another visitor’s memory',async()=>{
  await setup();const job=await message('Remember that I like jazz.');
  await finish(job,{...emptyTurn(),memories:[{operation:'remember',scope:'visitor',sourceEventId:job.context.events[0].id,text:'Likes jazz.'}]});
  const memory=(await t.query(api.bot.manage,{token:adminToken})).memories[0];
  const next=await message('Actually, remember that I prefer funk.');
  await finish(next,{...emptyTurn(),memories:[{operation:'remember',scope:'visitor',sourceEventId:next.context.events[0].id,memoryId:memory._id,text:'Prefers funk.'}]});
  const result=(await t.query(api.bot.manage,{token:adminToken})).memories;
  expect(result).toHaveLength(1);expect(result[0]._id).toBe(memory._id);expect(result[0].text).toBe('Prefers funk.');
  await t.mutation(api.room.join,{token:otherToken,name:'Other',look});
  await t.mutation(api.room.chat,{token:otherToken,body:'Change Visitor’s memory.',mode:'Say'});
  const other=await t.mutation(internal.bot.claim,{}),event=other.context.events.find(e=>e.kind==='chat');
  await finish(other,{...emptyTurn(),memories:[{operation:'remember',scope:'visitor',sourceEventId:event.id,memoryId:memory._id,text:'Rewritten by someone else.'}]});
  expect((await t.query(api.bot.manage,{token:adminToken})).memories[0].text).toBe('Prefers funk.');
});

it('remembers disconnected voice identities for revocation and cancels removal after restoration',async()=>{
  await setup();vi.stubEnv('LIVEKIT_URL','wss://example.livekit.cloud');vi.stubEnv('LIVEKIT_API_KEY','test-key');vi.stubEnv('LIVEKIT_API_SECRET','test-secret-long-enough-for-a-token');
  const player=await t.query(api.room.me,{token});
  await t.action(api.voice.connect,{token,tab:'closedtab'});
  const first=await message('First offence');await finish(first,{...emptyTurn(),violations:[{eventId:first.context.events[0].id,reason:'No profanity.',category:'profanity'}]});
  const next=await message('Second offence');await finish(next,{...emptyTurn(),violations:[{eventId:next.context.events[0].id,reason:'Repeated profanity.',category:'profanity'}]});
  const entry=(await t.query(api.bot.manage,{token:adminToken})).moderation[0];
  const grant=await t.query(internal.bot.voiceRemoval,{playerId:player.id,moderationId:entry._id});
  expect(grant.identities).toContain(`${player.id}#closedtab`);expect(grant.revokeBefore).toBeGreaterThan(Date.now()/1000);
  await expect(t.action(api.voice.connect,{token,tab:'newtab'})).rejects.toThrow('removed');
  await t.mutation(api.bot.restore,{token:adminToken,playerId:player.id});
  expect(await t.query(internal.bot.voiceRemoval,{playerId:player.id,moderationId:entry._id})).toBeNull();
});

it('does not give a reused name the former visitor’s memory or agent key',async()=>{
  await setup();const {agentToken}=await t.mutation(api.agents.createKey,{token});
  const job=await message('Remember my preference.');
  await finish(job,{...emptyTurn(),memories:[{operation:'remember',scope:'visitor',sourceEventId:job.context.events[0].id,text:'Likes jazz.'}]});
  await t.mutation(api.room.leave,{token});vi.setSystemTime(Date.now()+4*3600000+1);
  await t.mutation(api.room.join,{token:otherToken,name:'Visitor',look});
  await expect(t.query(api.agents.status,{agentToken})).rejects.toThrow();
  const next=await t.mutation(internal.bot.claim,{});expect(next.context.memories).toEqual([]);
});

it('discards in-flight output after pausing the bot or editing its memories',async()=>{
  await setup();const job=await message();
  await t.mutation(api.bot.saveMemory,{token:adminToken,text:'New instructions from Grant.'});
  await finish(job,{...emptyTurn(),reply:'Stale reply'});
  expect((await t.query(api.room.chatFeed,{token})).some(m=>m.body==='Stale reply')).toBe(false);
  const next=await t.mutation(internal.bot.claim,{});
  await t.mutation(api.bot.configure,{token:adminToken,name:'Lobby',personality:'A room host.',enabled:false,roaming:false,moderation:'off'});
  await finish(next,{...emptyTurn(),reply:'Should not appear'});
  expect((await t.query(api.room.chatFeed,{token})).some(m=>m.name==='Lobby')).toBe(false);
});

it('recovers a crashed turn once its lease expires and ignores the old completion',async()=>{
  await setup();const old=await message();
  expect(await t.mutation(internal.bot.claim,{})).toBeNull();
  vi.setSystemTime(Date.now()+61000);
  await t.mutation(api.room.heartbeat,{token,connectionId:'d'.repeat(64)});
  const next=await t.mutation(internal.bot.claim,{});expect(next.run).toBeGreaterThan(old.run);
  await finish(old,{...emptyTurn(),reply:'Old worker'});
  await finish(next,{...emptyTurn(),reply:'Recovered'});
  expect((await t.query(api.room.chatFeed,{token})).filter(m=>m.name==='Lobby').map(m=>m.body)).toEqual(['Recovered']);
});

it('retries transient provider failures without exposing provider error bodies',async()=>{
  await setup();vi.stubEnv('FIREWORKS_API_KEY','test-key');
  await t.mutation(api.room.chat,{token,body:'Hello Lobby',mode:'Say'});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,text:async()=>'secret provider payload'})));
  await t.action(internal.botBrain.respond,{});
  const data=await t.query(api.bot.manage,{token:adminToken});expect(data.settings.lastError).toContain('503');expect(JSON.stringify(data)).not.toContain('secret provider');
  expect((await t.run(ctx=>ctx.db.query('botEvents').first())).status).toBe('pending');
});
