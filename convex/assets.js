// Every client subscribes to the built catalogue so new pieces appear without a reload.
import {query} from './_generated/server.js';
import {v} from 'convex/values';
import {assetCatalogueEntry} from './lib/assets.js';
export const list=query({args:{token:v.optional(v.string())},handler:async ctx=>{
  const assets=await ctx.db.query('assets').collect(),entries=[];
  for(const asset of assets)entries.push(await assetCatalogueEntry(ctx,asset));
  return entries;
}});
