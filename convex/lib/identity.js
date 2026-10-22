import {fail} from './rules.js';

export const GUEST_SESSION_AGE=30*24*60*60*1000;
export const ADMIN_SESSION_AGE=12*60*60*1000;
export const randomSecret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');

// Origins are deployment configuration, never inferred from an untrusted request.
export function relyingParty(origin){
  const allowed=(process.env.ROOM_AUTH_ORIGINS||'https://chat.grantm.ac,https://habbo-room.vercel.app,http://localhost:5173,http://127.0.0.1:5173').split(',').map(s=>s.trim());
  if(!allowed.includes(origin))fail('Open the room at its usual address to use your room key.');
  const url=new URL(origin);
  if(url.origin!==origin||(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname)))fail('This room address cannot use passkeys.');
  return {origin,rpId:url.hostname};
}
export function activeIdentity(player){
  if(!player||player.kind==='bot'||player.nameKey.startsWith('retired:'))fail('This character is no longer available. Please enter with a new name.');
  if((player.blockedUntil??0)>Date.now())fail('You have been removed from the room for 10 minutes. Please return later.');
  return player;
}
export async function savedCharacter(ctx,player){
  if(!player)return false;
  if(player.savedAt)return true;
  const links=await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  return links.some(link=>link.tokenHash&&link.connectedAt!==undefined);
}
// Fixed windows bound challenge storage and backup-code attempts.
export async function rateLimit(ctx,key,maximum,windowMs){
  const now=Date.now(),row=await ctx.db.query('identityLimits').withIndex('by_key',q=>q.eq('key',key)).unique();
  if(row&&row.expiresAt>now){
    if(row.count>=maximum)fail('Please wait a little before trying again.');
    await ctx.db.patch(row._id,{count:row.count+1});
  }else if(row)await ctx.db.patch(row._id,{count:1,expiresAt:now+windowMs});
  else await ctx.db.insert('identityLimits',{key,count:1,expiresAt:now+windowMs});
}
export async function newSession(ctx,player){
  activeIdentity(player);
  const token=randomSecret();
  await ctx.db.insert('sessions',{tokenHash:await hash(token),playerId:player._id,role:player.role,expiresAt:Date.now()+(player.role==='admin'?ADMIN_SESSION_AGE:GUEST_SESSION_AGE)});
  return token;
}
