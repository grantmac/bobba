"use node";
import {action} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {ConvexError,v} from 'convex/values';
import {AccessToken,TrackSource} from 'livekit-server-sdk';

// Each open tab gets its own LiveKit identity (player id plus a per-page tag), so a second
// tab or a reload never bumps the first off the call as a duplicate; the client folds the
// tag away again to find the player. The token lasts long enough for full reconnects.
export const connect=action({args:{token:v.string(),tab:v.optional(v.string())},handler:async(ctx,{token,tab})=>{
  const playerId=await ctx.runQuery(internal.room.voiceIdentity,{token});
  if(tab!==undefined&&!/^[a-z0-9]{1,12}$/.test(tab))throw new ConvexError('Invalid voice session.');
  const identity=tab?`${playerId}#${tab}`:playerId;
  const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
  if(!url||!key||!secret)throw new ConvexError('Voice chat is not ready yet. Please try again later.');
  await ctx.runMutation(internal.room.registerVoice,{token,identity});
  const access=new AccessToken(key,secret,{identity,ttl:'12h'});
  access.addGrant({room:'habbo-room',roomJoin:true,canSubscribe:true,canPublish:true,
    canPublishSources:[TrackSource.MICROPHONE],canPublishData:false,canUpdateOwnMetadata:false});
  const signed=await access.toJwt();
  // Recheck after signing to close the race with a moderation action.
  await ctx.runQuery(internal.room.voiceIdentity,{token});
  return {url,token:signed};
}});
