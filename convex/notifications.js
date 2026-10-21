import {internalAction} from './_generated/server.js';
import {v} from 'convex/values';

// Keep the private ntfy topic and delivery entirely on the server.
export const roomJoin=internalAction({args:{name:v.string()},handler:async(_ctx,{name})=>{
  const topic=process.env.NTFY_TOPIC;
  if(!topic)return;
  try{
    const response=await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`,{
      method:'POST',
      headers:{Title:'Someone joined your room',Click:'https://chat.grantm.ac',Tags:'wave','Content-Type':'text/plain; charset=utf-8'},
      body:`${name} joined your room.`,
      signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)console.warn(`Room join notification failed (${response.status}).`);
  }catch{
    // A phone notification failure must never prevent someone entering the room.
    console.warn('Room join notification could not be delivered.');
  }
}});
