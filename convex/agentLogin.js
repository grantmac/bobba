import {mutation} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {publicPlayer} from './room.js';
import {fail} from './lib/rules.js';
import {activeIdentity,hash,newSession,randomSecret,rateLimit,relyingParty} from './lib/identity.js';

const AGE=2*60*1000;
const INVALID='This room link has expired or was already used. Ask your agent to open the room again.';
// The agent key never reaches the browser. Only a hash of this temporary ticket is stored.
export const issue=mutation({args:{agentToken:v.string(),origin:v.string()},handler:async(ctx,{agentToken,origin})=>{
  relyingParty(origin);
  const {player,link}=await agentFor(ctx,agentToken);activeIdentity(player);
  await rateLimit(ctx,`agent-entry:${link._id}`,10,60000);
  const now=Date.now(),code=randomSecret(),expiresAt=now+AGE;
  await ctx.db.insert('agentEntries',{codeHash:await hash(code),linkId:link._id,playerId:player._id,origin,expiresAt});
  if(link.connectedAt===undefined)await ctx.db.patch(link._id,{connectedAt:now});
  if(!player.savedAt)await ctx.db.patch(player._id,{savedAt:now});
  return {url:`${origin}/#enter=${code}`,playerName:player.name,expiresAt};
}});
export const consume=mutation({args:{code:v.string(),origin:v.string()},handler:async(ctx,{code,origin})=>{
  relyingParty(origin);
  if(!/^[a-f0-9]{64}$/.test(code))fail(INVALID);
  const hashValue=await hash(code);
  const ticket=await ctx.db.query('agentEntries').withIndex('by_code',q=>q.eq('codeHash',hashValue)).unique();
  if(!ticket||ticket.expiresAt<=Date.now()||ticket.origin!==origin)fail(INVALID);
  // Re-check the connection at redemption: disconnecting an agent invalidates outstanding links.
  const link=await ctx.db.get(ticket.linkId);
  if(!link?.tokenHash||link.connectedAt===undefined||link.playerId!==ticket.playerId)fail(INVALID);
  const player=activeIdentity(await ctx.db.get(ticket.playerId));
  await ctx.db.delete(ticket._id);
  return {token:await newSession(ctx,player),player:publicPlayer(player)};
}});
