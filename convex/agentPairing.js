// The browser receives only a temporary approval code. The agent keeps its own
// secret; approving the code never gives the browser that secret (or vice versa).
import {mutation,query,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';
import {playerFor} from './room.js';
import {agentFor} from './agents.js';
import {fail} from './lib/rules.js';

const AGE=10*60*1000;
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function lookup(ctx,index,field,value){
  if(!/^[a-f0-9]{64}$/.test(value))return null;
  const digest=await hash(value);
  return ctx.db.query('agentPairings').withIndex(index,q=>q.eq(field,digest)).unique();
}
async function state(ctx,pair){
  if(!pair||pair.expiresAt<=Date.now())return 'expired';
  if(pair.cancelled)return 'cancelled';
  if(!pair.linkId)return 'pending';
  const link=await ctx.db.get(pair.linkId),player=await ctx.db.get(pair.playerId);
  if(!link||!player||(player.blockedUntil??0)>Date.now())return 'revoked';
  return link.connectedAt!==undefined?'connected':'approved';
}
export const start=mutation({args:{agentToken:v.optional(v.string()),client:v.optional(v.union(v.literal('ChatGPT'),v.literal('Claude'),v.literal('Agent')))},handler:async(ctx,args)=>{
  const now=Date.now();
  // A global bound also covers callers bypassing the HTTP front door.
  const recent=await ctx.db.query('agentPairings').withIndex('by_created',q=>q.gt('createdAt',now-60000)).take(60);
  if(recent.length>=60)fail('The room is receiving too many connection requests. Try again in a minute.');
  const existing=args.agentToken?await agentFor(ctx,args.agentToken):null;
  const agentToken=args.agentToken??secret(),code=secret(),verification=secret().slice(0,8).toUpperCase(),expiresAt=now+AGE;
  await ctx.db.insert('agentPairings',{agentHash:await hash(agentToken),codeHash:await hash(code),client:args.client??'Agent',verification,createdAt:now,expiresAt,...(existing?{playerId:existing.player._id,linkId:existing.link._id}:{})});
  return {agentToken,code,verification,expiresAt};
}});
export const status=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  if(!/^[a-f0-9]{64}$/.test(agentToken))return {state:'expired'};
  const digest=await hash(agentToken);
  const pair=await ctx.db.query('agentPairings').withIndex('by_agent',q=>q.eq('agentHash',digest)).order('desc').first();
  return {state:await state(ctx,pair)};
}});
export const inspect=query({args:{token:v.string(),code:v.string()},handler:async(ctx,{token,code})=>{
  const player=await playerFor(ctx,token),pair=await lookup(ctx,'by_code','codeHash',code);
  if(pair?.playerId&&pair.playerId!==player._id)return {state:'unavailable'};
  return {state:await state(ctx,pair),...(pair?{client:pair.client,verification:pair.verification,expiresAt:pair.expiresAt}:{})};
}});
export const decide=mutation({args:{token:v.string(),code:v.string(),approve:v.boolean()},handler:async(ctx,{token,code,approve})=>{
  const player=await playerFor(ctx,token);
  if((player.blockedUntil??0)>Date.now())fail('This player is temporarily removed from the room.');
  const pair=await lookup(ctx,'by_code','codeHash',code),current=await state(ctx,pair);
  if(!pair||['expired','cancelled','revoked'].includes(current))fail('This connection request has ended. Ask Codex to open a new one.');
  if(pair.playerId&&pair.playerId!==player._id)fail('This connection request belongs to another player.');
  if(!approve){
    if(pair.linkId)await ctx.db.delete(pair.linkId);
    await ctx.db.patch(pair._id,{cancelled:true,playerId:player._id});
    return;
  }
  if(pair.linkId)return; // Safe to retry after a lost response, never issue twice.
  const links=await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  if(links.length>=20)fail('Disconnect unused agents from the catalogue before connecting another.');
  const linkId=await ctx.db.insert('agentLinks',{playerId:player._id,tokenHash:pair.agentHash,label:pair.client,createdAt:Date.now(),expiresAt:pair.expiresAt});
  await ctx.db.patch(pair._id,{linkId,playerId:player._id});
}});
export const cleanup=internalMutation({args:{},handler:async ctx=>{
  const expired=await ctx.db.query('agentPairings').withIndex('by_expiry',q=>q.lte('expiresAt',Date.now())).take(1000);
  for(const pair of expired){
    const link=pair.linkId?await ctx.db.get(pair.linkId):null;
    if(link&&link.connectedAt===undefined)await ctx.db.delete(link._id);
    await ctx.db.delete(pair._id);
  }
}});
