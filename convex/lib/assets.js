// Player-built catalogue pieces live in the database (sprites in file storage) so every
// client sees a new piece the moment it is created. Their placement rules are the same
// shape as the static catalogue's, keyed `asset_<id>`, and carry the builder's player id.
import {furniture} from './catalog.js';
export const ASSET_CATEGORIES=['Decor','Tables','Seating','Rugs','Plants','Lighting','Wall'];
export const ASSET_LIMIT_PER_PLAYER=50,PLACED_LIMIT_PER_PLAYER=40;
export const assetType=asset=>`asset_${asset._id}`;
export function assetDefinition(asset){
  return {category:asset.category,width:asset.width,depth:asset.depth,views:asset.views,surfaceHeight:asset.surfaceHeight,
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),owner:asset.ownerId};
}
// Static catalogue plus every built piece, for placement checks.
export async function definitionsFor(ctx){
  const assets=await ctx.db.query('assets').collect();
  return {...furniture,...Object.fromEntries(assets.map(asset=>[assetType(asset),assetDefinition(asset)]))};
}
// The client-side catalogue entry, with storage files resolved to URLs.
export async function assetCatalogueEntry(ctx,asset){
  const files=new Map();
  for(const id of [asset.icon,...asset.parts.map(p=>p.storageId)])if(!files.has(id))files.set(id,await ctx.storage.getUrl(id));
  return {id:assetType(asset),name:asset.name,category:asset.category,width:asset.width,depth:asset.depth,surfaceHeight:asset.surfaceHeight,spriteDensity:asset.spriteDensity,
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),...(asset.tableOffsetY!==undefined?{tableOffsetY:asset.tableOffsetY}:{}),
    icon:files.get(asset.icon),owner:asset.ownerId,ownerName:asset.ownerName,createdAt:asset.createdAt,
    parts:asset.parts.map(p=>({file:files.get(p.storageId),layer:'a',direction:p.direction,reg:p.reg,width:p.width,height:p.height,z:0,ink:8,alphaPrepared:true})),
    views:asset.views};
}
// Non-admins may only add, move or remove pieces they own, built from their own assets,
// up to a cap; anything else in the list must be untouched.
export function assertOwnedChanges(previous,next,playerId,definitions){
  const before=new Map(previous.map(item=>[item.id,item])),after=new Map(next.map(item=>[item.id,item]));
  for(const id of new Set([...before.keys(),...after.keys()])){
    const a=before.get(id),b=after.get(id);
    if(a&&b&&JSON.stringify(a)===JSON.stringify(b))continue;
    if((a&&a.owner!==playerId)||(b&&b.owner!==playerId))throw new Error('You can only change pieces you built.');
    if(b&&!a&&definitions[b.type]?.owner!==playerId)throw new Error('You can only place your own pieces.');
    if(b&&b.on!==undefined)throw new Error('You can only change pieces you built.');
  }
  if(next.filter(item=>item.owner===playerId&&item.x!==null).length>PLACED_LIMIT_PER_PLAYER)throw new Error(`You can place up to ${PLACED_LIMIT_PER_PLAYER} pieces.`);
}
