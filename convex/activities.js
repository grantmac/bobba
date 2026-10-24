import {mutation,query,internalMutation} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {playerFor} from './room.js';
import {fail,isOnline,isPlaced,atTime,cells,MAIN_ZONE} from './lib/rules.js';
import {definitionsFor} from './lib/assets.js';
import {itemDoc,zoneItems} from './lib/furnitureStore.js';

const question=v.object({prompt:v.string(),options:v.array(v.string()),answer:v.number()});
const target=v.object({itemId:v.string(),clue:v.string()});
const createArgs={spaceId:v.string(),name:v.string(),kind:v.union(v.literal('quiz'),v.literal('hunt')),durationSeconds:v.number(),questions:v.optional(v.array(question)),targets:v.optional(v.array(target))};
const activityId=v.id('activities');
const participant=(ctx,id,playerId)=>ctx.db.query('activityPlayers').withIndex('by_player_activity',q=>q.eq('playerId',playerId).eq('activityId',id)).unique();
const participants=(ctx,id)=>ctx.db.query('activityPlayers').withIndex('by_activity',q=>q.eq('activityId',id)).collect();
async function activity(ctx,id){const game=await ctx.db.get(id);if(!game)fail('That activity no longer exists.');return game;}
function host(player,game){if(game.ownerId!==player._id&&player.role!=='admin')fail('Only the host can manage this activity.');}
async function ownedSpace(ctx,player,id){
  const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();
  const space=room?.spaces?.find(s=>s.id===id);
  if(id===MAIN_ZONE&&player.role==='admin')return;
  if(!space||(space.owner!==player._id&&player.role!=='admin'))fail('Choose your own space for the activity.');
}
function text(value,max){return typeof value==='string'&&value.trim().length>0&&value.length<=max;}
async function createFor(ctx,player,args){
  await ownedSpace(ctx,player,args.spaceId);
  if(!text(args.name,40))fail('Use an activity name of 1–40 characters.');
  if(!Number.isInteger(args.durationSeconds)||args.durationSeconds<15||args.durationSeconds>3600)fail('Rounds last 15–3600 seconds.');
  const questions=args.questions??[],targets=args.targets??[];
  if(args.kind==='quiz'){
    if(!questions.length||questions.length>20||targets.length)fail('A quiz needs 1–20 questions and no treasure targets.');
    for(const q of questions)if(!text(q.prompt,300)||q.options.length<2||q.options.length>6||q.options.some(o=>!text(o,100))||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)fail('Each question needs a prompt, 2–6 options and a valid answer index.');
  }else{
    if(!targets.length||targets.length>20||questions.length||new Set(targets.map(t=>t.itemId)).size!==targets.length)fail('A hunt needs 1–20 distinct treasure targets and no questions.');
    for(const target of targets){const item=await itemDoc(ctx,target.itemId);if(!text(target.clue,300)||!item||!isPlaced(item)||item.zone!==args.spaceId)fail('Each treasure needs a clue and a placed object in this space.');}
  }
  if((await ctx.db.query('activities').withIndex('by_space',q=>q.eq('spaceId',args.spaceId)).take(8)).length>=8)fail('Remove an old activity before adding another (eight per space).');
  const id=await ctx.db.insert('activities',{ownerId:player._id,spaceId:args.spaceId,name:args.name.trim(),kind:args.kind,durationSeconds:args.durationSeconds,questions,targets,status:'waiting',round:0,createdAt:Date.now()});
  return {id};
}
export const create=mutation({args:{agentToken:v.string(),...createArgs},handler:async(ctx,args)=>createFor(ctx,(await agentFor(ctx,args.agentToken)).player,args)});
export const createPlayer=mutation({args:{token:v.string(),...createArgs},handler:async(ctx,args)=>createFor(ctx,await playerFor(ctx,args.token),args)});
export const objects=query({args:{token:v.string(),spaceId:v.string()},handler:async(ctx,{token,spaceId})=>{
  const player=await playerFor(ctx,token);await ownedSpace(ctx,player,spaceId);
  return Promise.all((await zoneItems(ctx,spaceId)).filter(isPlaced).map(async item=>{
    const id=item.type.startsWith('asset_')?ctx.db.normalizeId('assets',item.type.slice(6)):null,asset=id?await ctx.db.get(id):null;
    return {id:item.id,name:asset?.name??item.type,x:item.x,z:item.z};
  }));
}});

async function listFor(ctx,player,spaceId){
  const games=await ctx.db.query('activities').withIndex('by_space',q=>q.eq('spaceId',spaceId)).collect();
  return Promise.all(games.map(async game=>{
    const rows=await participants(ctx,game._id),mine=rows.find(p=>p.playerId===player._id),q=game.questions[(Math.max(1,game.round)-1)%game.questions.length];
    // Correct answers never enter a public query, even for the host.
    return {id:game._id,name:game.name,kind:game.kind,spaceId,status:game.status,round:game.round,endsAt:game.endsAt??null,buzzer:game.buzzer??null,canManage:game.ownerId===player._id||player.role==='admin',question:q?{prompt:q.prompt,options:q.options}:null,targets:game.targets,
      scores:rows.map(p=>({playerId:p.playerId,name:p.name,score:p.score})).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)),
      me:mine?{found:mine.round===game.round?mine.found:[],answered:mine.round===game.round&&mine.answered}:null};
  }));
}
export const list=query({args:{token:v.string(),spaceId:v.string()},handler:async(ctx,{token,spaceId})=>listFor(ctx,await playerFor(ctx,token),spaceId)});
export const listAgent=query({args:{agentToken:v.string(),spaceId:v.string()},handler:async(ctx,{agentToken,spaceId})=>listFor(ctx,(await agentFor(ctx,agentToken)).player,spaceId)});
const controlArgs={activityId,action:v.union(v.literal('start'),v.literal('finish'),v.literal('delete'))};
async function controlFor(ctx,player,{activityId,action}){
  const game=await activity(ctx,activityId);host(player,game);
  if(action==='delete'){for(const row of await participants(ctx,activityId))await ctx.db.delete(row._id);await ctx.db.delete(activityId);return {deleted:true};}
  if(action==='finish'){await ctx.db.patch(activityId,{status:'finished',buzzer:undefined});return {status:'finished'};}
  await ownedSpace(ctx,player,game.spaceId);
  if(game.status==='playing'&&(game.endsAt??0)>Date.now())fail('Finish this round before starting another.');
  const round=game.round+1,endsAt=Date.now()+game.durationSeconds*1000;
  await ctx.db.patch(activityId,{status:'playing',round,endsAt,buzzer:undefined});
  await ctx.scheduler.runAt(endsAt,internal.activities.expire,{activityId,round});
  return {round,endsAt};
}
export const control=mutation({args:{token:v.string(),...controlArgs},handler:async(ctx,args)=>controlFor(ctx,await playerFor(ctx,args.token),args)});
export const controlAgent=mutation({args:{agentToken:v.string(),...controlArgs},handler:async(ctx,args)=>controlFor(ctx,(await agentFor(ctx,args.agentToken)).player,args)});
export const expire=internalMutation({args:{activityId,round:v.number()},handler:async(ctx,{activityId,round})=>{const game=await ctx.db.get(activityId);if(game?.round===round&&game.status==='playing'&&game.endsAt<=Date.now())await ctx.db.patch(activityId,{status:'finished',buzzer:undefined});}});

const playArgs={activityId,action:v.union(v.literal('join'),v.literal('buzz'),v.literal('answer'),v.literal('collect')),round:v.optional(v.number()),choice:v.optional(v.number()),itemId:v.optional(v.string())};
async function playFor(ctx,player,args){
  const game=await activity(ctx,args.activityId),now=Date.now();
  if(!isOnline(player,now)||(player.zone??MAIN_ZONE)!==game.spaceId)fail('Enter this space to play.');
  let row=await participant(ctx,game._id,player._id);
  if(args.action==='join'){
    if(!row){if((await participants(ctx,game._id)).length>=64)fail('This activity is full.');await ctx.db.insert('activityPlayers',{activityId:game._id,playerId:player._id,name:player.name,score:0,round:game.round,found:[],answered:false});}
    return {joined:true};
  }
  if(!row)fail('Join this activity first.');
  if(args.round!==game.round)fail('The round changed. Open the activity again.');
  if(game.status!=='playing'||game.endsAt<=now)fail('This round has ended.');
  if(row.round!==game.round)row={...row,round:game.round,found:[],answered:false};
  if(args.action==='buzz'){
    if(game.kind!=='quiz')fail('Only quizzes have buzzers.');
    if(row.answered)fail('You already answered this round.');
    if(game.buzzer)fail('Another player has the buzzer.');
    await ctx.db.patch(game._id,{buzzer:player._id});return {buzzer:player._id};
  }
  if(args.action==='answer'){
    if(game.kind!=='quiz'||game.buzzer!==player._id||row.answered)fail('Buzz in before answering.');
    const q=game.questions[(game.round-1)%game.questions.length];
    if(!Number.isInteger(args.choice)||args.choice<0||args.choice>=q.options.length)fail('Choose one of the answers.');
    const correct=args.choice===q.answer;
    await ctx.db.patch(row._id,{round:game.round,found:[],answered:true,score:row.score+(correct?1:0)});
    await ctx.db.patch(game._id,{buzzer:undefined,...(correct?{status:'finished'}:{})});return {correct};
  }
  if(game.kind!=='hunt'||!game.targets.some(t=>t.itemId===args.itemId))fail('That object is not part of this hunt.');
  if(row.found.includes(args.itemId))fail('You already found this object.');
  const item=await itemDoc(ctx,args.itemId),position=atTime(player,now);
  if(!item||!isPlaced(item)||item.zone!==game.spaceId)fail('That treasure is no longer in this space.');
  const footprint=cells(item,await definitionsFor(ctx,[item]));
  if(!footprint.some(([x,z])=>Math.hypot(position.x-(x+.5),position.z-(z+.5))<=2))fail('Walk closer to the object to collect it.');
  await ctx.db.patch(row._id,{round:game.round,found:[...row.found,args.itemId],answered:false,score:row.score+1});
  return {collected:args.itemId,score:row.score+1};
}
export const play=mutation({args:{token:v.string(),...playArgs},handler:async(ctx,args)=>playFor(ctx,await playerFor(ctx,args.token),args)});
export const playAgent=mutation({args:{agentToken:v.string(),...playArgs},handler:async(ctx,args)=>playFor(ctx,(await agentFor(ctx,args.agentToken)).player,args)});
