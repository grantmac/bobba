"use node";
import {action} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {ConvexError,v} from 'convex/values';
import {AccessToken,TrackSource} from 'livekit-server-sdk';

// Each zone is its own call: the lobby keeps the original room name, every space gets its own,
// so a player hears the people around them and a packed world never shares one mix.
export const voiceRoom=zone=>zone==='main'?'habbo-room':`habbo-room:${zone}`;
// Each open tab gets its own LiveKit identity (player id plus a per-page tag), so a second
// tab or a reload never bumps the first off the call as a duplicate; the client folds the
// tag away again to find the player. The token lasts long enough for full reconnects.
export const connect=action({args:{token:v.string(),tab:v.optional(v.string())},handler:async(ctx,{token,tab})=>{
  const {playerId,zone}=await ctx.runQuery(internal.room.voiceIdentity,{token});
  if(tab!==undefined&&!/^[a-z0-9]{1,12}$/.test(tab))throw new ConvexError('Invalid voice session.');
  const identity=tab?`${playerId}#${tab}`:playerId;
  const url=process.env.LIVEKIT_URL,key=process.env.LIVEKIT_API_KEY,secret=process.env.LIVEKIT_API_SECRET;
  if(!url||!key||!secret)throw new ConvexError('Voice chat is not ready yet. Please try again later.');
  const access=new AccessToken(key,secret,{identity,ttl:'12h'});
  access.addGrant({room:voiceRoom(zone),roomJoin:true,canSubscribe:true,canPublish:true,
    canPublishSources:[TrackSource.MICROPHONE],canPublishData:false,canUpdateOwnMetadata:false});
  return {url,token:await access.toJwt(),zone};
}});
