import {internalAction} from './_generated/server.js';
import {internal} from './_generated/api.js';
import {TURN_TOOL,systemPrompt,parseTurn} from './lib/bot_policy.js';

export const respond=internalAction({args:{},handler:async ctx=>{
  const job=await ctx.runMutation(internal.bot.claim,{});if(!job)return;
  let retry=true;
  try{
    const response=await fetch('https://api.fireworks.ai/inference/v1/chat/completions',{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${process.env.FIREWORKS_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:job.model,messages:[{role:'system',content:systemPrompt(job.state)},{role:'user',content:JSON.stringify(job.context)}],tools:[TURN_TOOL],tool_choice:{type:'function',function:{name:'room_turn'}},reasoning_effort:'low',temperature:0.35,max_tokens:2000}),
      signal:AbortSignal.timeout(25000)
    });
    if(!response.ok){retry=response.status===429||response.status>=500;throw new Error(`Fireworks request failed (${response.status}). Check the backend key and model.`);}
    const data=await response.json(),turn=parseTurn(data.choices?.[0]?.message);
    await ctx.runMutation(internal.bot.finish,{run:job.run,revision:job.revision,turn});
  }catch(error){
    // Never store raw provider errors: they can echo prompts, headers or other private data.
    const message=error?.message?.startsWith('Fireworks request failed (')?error.message:error?.name==='TimeoutError'?'Fireworks timed out. Retrying.':'The bot could not complete this turn.';
    await ctx.runMutation(internal.bot.failed,{run:job.run,message,retry});
  }
}});
