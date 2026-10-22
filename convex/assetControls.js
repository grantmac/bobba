import {mutation} from './_generated/server.js';
import {v} from 'convex/values';
import {agentFor} from './agents.js';
import {fail} from './lib/rules.js';
import {controlsArg,validateControls} from './lib/assetControls.js';

// Presentation only: changing buttons leaves sprite data and program state intact.
export const set=mutation({args:{agentToken:v.string(),assetId:v.id('assets'),controls:controlsArg},handler:async(ctx,{agentToken,assetId,controls})=>{
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(assetId);
  if(!asset||(asset.ownerId!==player._id&&player.role!=='admin'))fail('That piece is not yours.');
  let checked;
  try{checked=validateControls(controls,asset);}catch(error){fail(error.message);}
  await ctx.db.patch(assetId,{controls:checked});
  return {assetId,controls:checked};
}});
