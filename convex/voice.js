"use node";
import {action} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {ConvexError,v} from 'convex/values';
import {AccessToken,TrackSource} from 'livekit-server-sdk';

export const connect=action({args:{token:v.string()},handler:async(ctx,{token})=>{
  const identity=await ctx.runQuery(internal.room.voiceIdentity,{token});
  const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
  if(!url||!key||!secret)throw new ConvexError('Voice chat is not ready yet. Please try again later.');
  const access=new AccessToken(key,secret,{identity,ttl:'5m'});
  access.addGrant({room:'habbo-room',roomJoin:true,canSubscribe:true,canPublish:true,
    canPublishSources:[TrackSource.MICROPHONE],canPublishData:false,canUpdateOwnMetadata:false});
  return {url,token:await access.toJwt()};
}});
