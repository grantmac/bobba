// Player-built catalogue pieces live in the database (sprites in file storage) so every
// client sees a new piece the moment it is created. Their placement rules are the same
// shape as the static catalogue's, keyed `asset_<id>`, and carry the builder's player id.
import {furniture} from './catalog.js';
import {isPlaced} from '../../shared/furniture-model.js';
export const ASSET_CATEGORIES=['Decor','Tables','Seating','Rugs','Plants','Lighting','Wall'];
export const ASSET_LIMIT_PER_PLAYER=50,PLACED_LIMIT_PER_PLAYER=40;
export const assetType=asset=>`asset_${asset._id}`;
// Where an avatar sits on a built seat: the builder names one tile (offsets within the footprint
// as placed facing lower-right, rotation 2, where x runs across the depth and z along the width)
// and the seat top's height in pixels. The other rotations follow: 4 is 2 mirrored (x and z swap),
// 6 and 0 are 2 and 4 turned about. The avatar's anchor sits 26 px above a floor-level seat, plus
// the builder's pixel nudge: sideways flips with the mirrored rotations, up and down does not.
export function seatSpots(asset){
  if(!asset.seat)return undefined;
  const {x,z,height,offsetX=0,offsetY=0}=asset.seat,w=asset.width,d=asset.depth;
  const cell={2:[x,z],4:[z,x],6:[d-1-x,w-1-z],0:[w-1-z,d-1-x]},side={2:1,4:-1,6:-1,0:1};
  return Object.fromEntries(asset.views.map(({direction})=>[direction,{cell:cell[direction],direction,height,offset:[offsetX*side[direction]||0,26-height+offsetY]}]));
}
export function assetDefinition(asset){
  return {category:asset.category,width:asset.width,depth:asset.depth,views:asset.views,surfaceHeight:asset.surfaceHeight,
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),...(asset.seat?{seat:seatSpots(asset)}:{}),...(asset.switchable?{switchable:true}:{}),owner:asset.ownerId};
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
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),...(asset.tableOffsetY!==undefined?{tableOffsetY:asset.tableOffsetY}:{}),...(asset.seat?{seat:seatSpots(asset)}:{}),
    ...(asset.frameDuration?{frameDuration:asset.frameDuration,...(asset.switchable?{switchable:true}:{})}:{}),
    icon:files.get(asset.icon),owner:asset.ownerId,ownerName:asset.ownerName,createdAt:asset.createdAt,
    // Frame cells are already cut to one box, so the client must not trim them again.
    parts:asset.parts.map(p=>({file:files.get(p.storageId),layer:'a',direction:p.direction,reg:p.reg,width:p.width,height:p.height,z:0,ink:8,alphaPrepared:true,...(p.frames?{frames:p.frames,trimFrames:false}:{})})),
    views:asset.views};
}
// Non-admins may only add, move or remove pieces they own, built from their own assets,
// up to a cap; anything else in the list must be untouched.
// `where` (from rules.ownSpaceCheck) confines a builder's new or moved pieces to their own space.
export function assertOwnedChanges(previous,next,playerId,definitions,where=null){
  const before=new Map(previous.map(item=>[item.id,item])),after=new Map(next.map(item=>[item.id,item]));
  for(const id of new Set([...before.keys(),...after.keys()])){
    const a=before.get(id),b=after.get(id);
    if(a&&b&&JSON.stringify(a)===JSON.stringify(b))continue;
    if((a&&a.owner!==playerId)||(b&&b.owner!==playerId))throw new Error('You can only change pieces you built.');
    if(b&&!a&&definitions[b.type]?.owner!==playerId)throw new Error('You can only place your own pieces.');
    if(b&&b.on!==undefined&&b.on!==a?.on)throw new Error('Switch a piece on or off by clicking it in the room.');
    if(where&&b&&isPlaced(b)&&!where.within(b))throw new Error(where.hasSpace?'Your pieces can only go in your own space.':'Add a space first: your pieces can only go in your own space.');
  }
  if(next.filter(item=>item.owner===playerId&&item.x!==null).length>PLACED_LIMIT_PER_PLAYER)throw new Error(`You can place up to ${PLACED_LIMIT_PER_PLAYER} pieces.`);
}
