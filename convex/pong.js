import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail,isOnline} from './lib/rules.js';
import {advance,serve,bounce,missed,hits,arrival,controllers,clampPaddle,WIN_SCORE,OVER_DELAY} from '../shared/pong.js';
import {playerFor} from './room.js';

async function getGame(ctx){return await ctx.db.query('pong').withIndex('by_key',q=>q.eq('key','main')).unique();}
async function withOnline(ctx,game,now){
  if(!game)return null;
  const side=async s=>{if(!game[s])return null;const p=await ctx.db.get(game[s].id);return {...game[s],online:isOnline(p,now)};};
  return {...game,a:await side('a'),b:await side('b')};
}
const fresh=now=>({key:'main',status:'playing',a:null,b:null,scores:{a:0,b:0},ball:serve(now,'b'),paddles:{a:{y:36,at:now},b:{y:36,at:now}},winner:null,endsAt:null,updatedAt:now});
function publicGame(game){
  if(!game)return {status:'idle'};
  const {_id,_creationTime,key,...rest}=game;return rest;
}
export const state=query({args:{},handler:async(ctx)=>{
  const now=Date.now(),game=await withOnline(ctx,await getGame(ctx),now);
  if(!game)return {status:'idle'};
  const anyone=(game.a?.online)||(game.b?.online);
  return publicGame(anyone?game:{...game,status:'idle'});
}});
// Join: take the first free paddle, or restart after a finished or abandoned game.
export const join=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const p=await playerFor(ctx,token),now=Date.now();
  let game=await withOnline(ctx,await getGame(ctx),now);
  const seat={id:p._id,name:p.name};
  const stale=!game||game.status==='over'&&now>=(game.endsAt??0)||(!game.a?.online&&!game.b?.online);
  if(stale){
    const next={...fresh(now),a:seat};
    if(game)await ctx.db.replace(game._id,next);else await ctx.db.insert('pong',next);
    return;
  }
  if(game.a?.id===p._id||game.b?.id===p._id)return;
  if(!game.a?.online)await ctx.db.patch(game._id,{a:seat,updatedAt:now});
  else if(!game.b?.online)await ctx.db.patch(game._id,{b:seat,updatedAt:now});
  else fail('Both paddles are taken. Watch this one or wait for the next game.');
}});
export const leave=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const p=await playerFor(ctx,token),now=Date.now(),game=await getGame(ctx);
  if(!game)return;
  const side=game.a?.id===p._id?'a':game.b?.id===p._id?'b':null;
  if(!side)return;
  await ctx.db.patch(game._id,{[side]:null,updatedAt:now});
}});
async function controlling(ctx,token,side,now){
  const p=await playerFor(ctx,token),game=await withOnline(ctx,await getGame(ctx),now);
  if(!game||game.status!=='playing')fail('No game is running.');
  if(controllers(game)[side]!==p._id)fail('That paddle is not yours.');
  return game;
}
export const paddle=mutation({args:{token:v.string(),side:v.union(v.literal('a'),v.literal('b')),y:v.number()},handler:async(ctx,{token,side,y})=>{
  const now=Date.now(),game=await controlling(ctx,token,side,now);
  if(!Number.isFinite(y))fail('Bad paddle position.');
  await ctx.db.patch(game._id,{paddles:{...game.paddles,[side]:{y:clampPaddle(y),at:now}}});
}});
// The controller reports a hit with its paddle position; the server replays the ball to
// check it really reaches that paddle and issues the new trajectory.
export const hit=mutation({args:{token:v.string(),side:v.union(v.literal('a'),v.literal('b')),y:v.number(),serial:v.number()},handler:async(ctx,{token,side,y,serial})=>{
  const now=Date.now(),game=await controlling(ctx,token,side,now);
  if(game.ball.serial!==serial)return;
  const paddleY=clampPaddle(y),when=arrival(game.ball,side);
  if(when===null||Math.abs(when-now)>600||!hits(game.ball,side,paddleY))return;
  await ctx.db.patch(game._id,{ball:bounce(game.ball,side,paddleY,now),paddles:{...game.paddles,[side]:{y:paddleY,at:now}},updatedAt:now});
}});
export const miss=mutation({args:{token:v.string(),side:v.union(v.literal('a'),v.literal('b')),serial:v.number()},handler:async(ctx,{token,side,serial})=>{
  const now=Date.now(),game=await controlling(ctx,token,side,now);
  if(game.ball.serial!==serial||!missed(game.ball,side,now+250))return;
  const scorer=side==='a'?'b':'a',scores={...game.scores,[scorer]:game.scores[scorer]+1};
  if(scores[scorer]>=WIN_SCORE){await ctx.db.patch(game._id,{scores,status:'over',winner:scorer,endsAt:now+OVER_DELAY,updatedAt:now});return;}
  await ctx.db.patch(game._id,{scores,ball:{...serve(now,side),serial:game.ball.serial+1},updatedAt:now});
}});
