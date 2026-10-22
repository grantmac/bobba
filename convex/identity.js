import {query,mutation,internalQuery,internalMutation} from './_generated/server.js';
import {v} from 'convex/values';
import {playerFor,sessionFor,publicPlayer} from './room.js';
import {fail} from './lib/rules.js';
import {hash,randomSecret,relyingParty,activeIdentity,rateLimit,newSession,GUEST_SESSION_AGE} from './lib/identity.js';

export const status=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  const keys=await ctx.db.query('passkeys').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  const backup=await ctx.db.query('recoveryKeys').withIndex('by_player',q=>q.eq('playerId',player._id)).unique();
  return {saved:!!player.savedAt,name:player.name,passkeys:keys.length,hasBackup:!!backup,backupAvailable:player.role!=='admin'};
}});
// Active visitors keep their browser session. Admin sessions retain their fixed lifetime.
export const resume=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const session=await sessionFor(ctx,token),player=activeIdentity(await ctx.db.get(session.playerId));
  if(player.role!=='admin'&&session.expiresAt<Date.now()+7*24*60*60*1000)await ctx.db.patch(session._id,{expiresAt:Date.now()+GUEST_SESSION_AGE});
  return publicPlayer(player,true);
}});

export const registrationContext=internalQuery({args:{token:v.string(),origin:v.string()},handler:async(ctx,{token,origin})=>{
  const player=activeIdentity(await playerFor(ctx,token)),rp=relyingParty(origin);
  const keys=await ctx.db.query('passkeys').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  if(keys.length>=5)fail('This character already has five room keys.');
  return {playerId:player._id,name:player.name,keys:keys.filter(k=>k.rpId===rp.rpId),...rp};
}});
export const storeChallenge=internalMutation({args:{purpose:v.union(v.literal('register'),v.literal('authenticate')),challenge:v.string(),origin:v.string(),token:v.optional(v.string())},handler:async(ctx,args)=>{
  const rp=relyingParty(args.origin);
  const player=args.purpose==='register'?activeIdentity(await playerFor(ctx,args.token??'')):null;
  await rateLimit(ctx,'passkeys',120,60000);
  if(player)await rateLimit(ctx,`register:${player._id}`,10,60000);
  return ctx.db.insert('identityChallenges',{purpose:args.purpose,challenge:args.challenge,...rp,...(player?{playerId:player._id,sessionHash:await hash(args.token)}:{}),expiresAt:Date.now()+5*60000});
}});
// Claim once before cryptographic verification. A failed attempt also consumes its challenge.
export const takeChallenge=internalMutation({args:{id:v.id('identityChallenges'),purpose:v.union(v.literal('register'),v.literal('authenticate')),token:v.optional(v.string())},handler:async(ctx,args)=>{
  const challenge=await ctx.db.get(args.id);
  if(!challenge||challenge.purpose!==args.purpose||challenge.expiresAt<=Date.now())fail('That room-key request has expired. Please try again.');
  if(challenge.purpose==='register'){
    const player=await playerFor(ctx,args.token??'');
    if(player._id!==challenge.playerId||await hash(args.token)!==challenge.sessionHash)fail('Please save your character from the browser where you entered.');
  }
  await ctx.db.delete(challenge._id);
  return challenge;
}});
export const credential=internalQuery({args:{credentialId:v.string()},handler:(ctx,{credentialId})=>ctx.db.query('passkeys').withIndex('by_credential',q=>q.eq('credentialId',credentialId)).unique()});
export const savePasskey=internalMutation({args:{token:v.string(),playerId:v.id('players'),credentialId:v.string(),publicKey:v.string(),counter:v.number(),transports:v.array(v.string()),rpId:v.string()},handler:async(ctx,args)=>{
  const player=activeIdentity(await playerFor(ctx,args.token));
  if(player._id!==args.playerId)fail('Your character changed. Please try again.');
  if(await ctx.db.query('passkeys').withIndex('by_credential',q=>q.eq('credentialId',args.credentialId)).unique())fail('That room key is already saved.');
  const keys=await ctx.db.query('passkeys').withIndex('by_player',q=>q.eq('playerId',player._id)).take(5);
  if(keys.length>=5)fail('This character already has five room keys.');
  const {token, ...credential}=args;
  await ctx.db.insert('passkeys',{...credential,createdAt:Date.now()});
  await ctx.db.patch(player._id,{savedAt:player.savedAt??Date.now()});
  return {saved:true};
}});
export const signIn=internalMutation({args:{credentialId:v.string(),previousCounter:v.number(),counter:v.number()},handler:async(ctx,args)=>{
  const credential=await ctx.db.query('passkeys').withIndex('by_credential',q=>q.eq('credentialId',args.credentialId)).unique();
  if(!credential||credential.counter!==args.previousCounter)fail('Your room key changed. Please try again.');
  const player=activeIdentity(await ctx.db.get(credential.playerId));
  await ctx.db.patch(credential._id,{counter:args.counter});
  return {token:await newSession(ctx,player),player:publicPlayer(player,true)};
}});

export const makeBackup=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=activeIdentity(await playerFor(ctx,token));
  if(player.role==='admin')fail('Keep your private entry link as the backup for the room owner.');
  await rateLimit(ctx,`backup:${player._id}`,3,60000);
  const secret=randomSecret(),tokenHash=await hash(secret);
  const old=await ctx.db.query('recoveryKeys').withIndex('by_player',q=>q.eq('playerId',player._id)).unique();
  if(old)await ctx.db.patch(old._id,{tokenHash,createdAt:Date.now()});
  else await ctx.db.insert('recoveryKeys',{playerId:player._id,tokenHash,createdAt:Date.now()});
  await ctx.db.patch(player._id,{savedAt:player.savedAt??Date.now()});
  return {code:secret.match(/.{8}/g).join('-')};
}});
export const useBackup=mutation({args:{code:v.string()},handler:async(ctx,{code})=>{
  await rateLimit(ctx,'backup:attempts',120,60000);
  const invalid={error:'That backup code is not valid or has already been used.'};
  // Return an error value rather than throwing so failed attempts retain their rate limit.
  if(code.length>100)return invalid;
  const secret=code.replace(/[-\s]/g,'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(secret))return invalid;
  const digest=await hash(secret);
  const key=await ctx.db.query('recoveryKeys').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!key)return invalid;
  const player=activeIdentity(await ctx.db.get(key.playerId));
  if(player.role==='admin')return invalid;
  await ctx.db.delete(key._id);
  return {token:await newSession(ctx,player),player:publicPlayer(player,true)};
}});
export const cleanup=internalMutation({args:{},handler:async ctx=>{
  for(const table of ['identityChallenges','identityLimits']){
    const expired=await ctx.db.query(table).withIndex('by_expiry',q=>q.lt('expiresAt',Date.now())).take(1000);
    for(const row of expired)await ctx.db.delete(row._id);
  }
}});
