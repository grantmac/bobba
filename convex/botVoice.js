"use node";
import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {v} from 'convex/values';
import {RoomServiceClient} from 'livekit-server-sdk';

export const remove=internalAction({args:{playerId:v.id('players'),moderationId:v.id('botModeration'),attempt:v.number()},handler:async(ctx,args)=>{
  const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
  if(!url||!key||!secret)return;
  try{
    const grant=await ctx.runQuery(internal.bot.voiceRemoval,{playerId:args.playerId,moderationId:args.moderationId});if(!grant)return;
    const service=new RoomServiceClient(url.replace(/^ws/,'http'),key,secret);
    const participants=await service.listParticipants('habbo-room');
    const identities=new Set([args.playerId,...grant.identities,...participants.filter(p=>p.identity===args.playerId||p.identity.startsWith(`${args.playerId}#`)).map(p=>p.identity)]);
    for(const identity of identities)try{await service.removeParticipant('habbo-room',identity,{revokeTokenTs:BigInt(grant.revokeBefore)});}catch(error){if(error?.status!==404&&error?.code!=='not_found')throw error;}
    await ctx.runMutation(internal.bot.voiceResult,{id:args.moderationId});
  }catch{
    await ctx.runMutation(internal.bot.voiceResult,{id:args.moderationId,error:'Voice removal failed. Room access is blocked; check LiveKit.'});
    if(args.attempt<2)await ctx.scheduler.runAfter(2000*(args.attempt+1),internal.botVoice.remove,{...args,attempt:args.attempt+1});
  }
}});
