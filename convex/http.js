import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
const http=httpRouter();
http.route({path:'/disconnect',method:'POST',handler:httpAction(async(ctx,request)=>{
  const body=await request.text();
  if(body.length>512)return new Response(null,{status:400});
  try{
    const data=JSON.parse(body);
    if(typeof data.token!=='string'||typeof data.connectionId!=='string')throw new Error('Invalid request');
    await ctx.runMutation(internal.room.disconnect,{token:data.token,connectionId:data.connectionId});
    return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*'}});
  }catch{return new Response(null,{status:400});}
})});
export default http;
