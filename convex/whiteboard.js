import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail} from './lib/rules.js';
import {playerFor} from './room.js';
import {COLORS,BOARD_WIDTH,BOARD_HEIGHT,MAX_POINTS,MAX_STROKES} from '../shared/whiteboard.js';

async function board(ctx){
  let doc=await ctx.db.query('whiteboard').withIndex('by_key',q=>q.eq('key','main')).unique();
  if(!doc){const id=await ctx.db.insert('whiteboard',{key:'main',counter:0,clearedSerial:0});doc=await ctx.db.get(id);}
  return doc;
}
const publicStroke=({id,color,size,points,serial,done})=>({id,color,size,points,serial,done});
// Everything on the board, for a client that has just arrived.
export const all=query({args:{},handler:async(ctx)=>{
  const doc=await ctx.db.query('whiteboard').withIndex('by_key',q=>q.eq('key','main')).unique();
  const strokes=await ctx.db.query('strokes').withIndex('by_serial').order('desc').take(MAX_STROKES);
  return {serial:doc?.counter??0,clearedSerial:doc?.clearedSerial??0,strokes:strokes.reverse().map(publicStroke)};
}});
// Only what changed since a serial, so a live subscription carries deltas rather than the whole board.
export const updates=query({args:{after:v.number()},handler:async(ctx,{after})=>{
  const doc=await ctx.db.query('whiteboard').withIndex('by_key',q=>q.eq('key','main')).unique();
  const strokes=await ctx.db.query('strokes').withIndex('by_serial',q=>q.gt('serial',after)).order('asc').take(60);
  return {serial:doc?.counter??0,clearedSerial:doc?.clearedSerial??0,strokes:strokes.map(publicStroke)};
}});
// Start or extend a stroke. Points are flat [x,y,x,y,...] in board space.
export const draw=mutation({args:{token:v.string(),id:v.string(),color:v.string(),size:v.number(),points:v.array(v.number()),done:v.boolean()},handler:async(ctx,{token,id,color,size,points,done})=>{
  const p=await playerFor(ctx,token);
  if(!/^[a-z0-9-]{4,40}$/.test(id)||!COLORS.includes(color)||![2,4,8].includes(size))fail('Bad stroke.');
  if(points.length%2||points.length>MAX_POINTS*2||points.some(n=>!Number.isFinite(n)))fail('Bad stroke.');
  const clean=points.map((n,i)=>Math.max(0,Math.min(i%2?BOARD_HEIGHT:BOARD_WIDTH,Math.round(n*2)/2)));
  const doc=await board(ctx),serial=doc.counter+1;
  const existing=await ctx.db.query('strokes').withIndex('by_stroke',q=>q.eq('id',id)).unique();
  if(existing){
    if(existing.playerId!==p._id)fail('That stroke is not yours.');
    if(existing.done)return;
    await ctx.db.patch(existing._id,{points:[...existing.points,...clean].slice(-MAX_POINTS*2),serial,done});
  }else{
    if(!clean.length)return;
    await ctx.db.insert('strokes',{id,playerId:p._id,color,size,points:clean,serial,done});
    const count=(await ctx.db.query('strokes').withIndex('by_serial').order('asc').take(MAX_STROKES+1));
    if(count.length>MAX_STROKES)await ctx.db.delete(count[0]._id);
  }
  await ctx.db.patch(doc._id,{counter:serial});
}});
export const clear=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  await playerFor(ctx,token);
  const doc=await board(ctx),serial=doc.counter+1;
  for(const s of await ctx.db.query('strokes').withIndex('by_serial').take(MAX_STROKES+50))await ctx.db.delete(s._id);
  await ctx.db.patch(doc._id,{counter:serial,clearedSerial:serial});
}});
