// Player-built catalogue pieces live in the database (sprites in file storage) so every
// client sees a new piece the moment it is created. Their placement rules are the same
// shape as the static catalogue's, keyed `asset_<id>`, and carry the builder's player id.
import {furniture} from './catalog.js';
import {isPlaced} from '../../shared/furniture-model.js';
import {furnitureControls} from '../../shared/furniture-controls.js';
export const ASSET_CATEGORIES=['Decor','Tables','Seating','Rugs','Plants','Lighting','Wall'];
export const assetType=asset=>`asset_${asset._id}`;
// Where an avatar sits on a built seat: the builder names one tile (offsets within the footprint
// as placed facing lower-right, rotation 2, where x runs across the depth and z along the width)
// and the seat top's height in pixels. The other rotations follow: 4 is 2 mirrored (x and z swap),
// 6 and 0 are 2 and 4 turned about. The avatar's anchor sits 26 px above a floor-level seat, plus
// the builder's pixel nudge: sideways flips with the mirrored rotations, up and down does not.
import {seatSpots} from '../../shared/asset-geometry.js';
export {seatSpots} from '../../shared/asset-geometry.js';
export function assetDefinition(asset){
  return {category:asset.category,width:asset.width,depth:asset.depth,views:asset.views,surfaceHeight:asset.surfaceHeight,
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),...(asset.seat?{seat:seatSpots(asset)}:{}),...(asset.switchable||asset.program?{switchable:true}:{}),owner:asset.ownerId};
}
// Static catalogue plus the built pieces a set of items actually uses, for placement checks:
// each `asset_<id>` type is one document read, never a scan of every piece ever built.
export async function definitionsFor(ctx,items=[]){
  const defs={...furniture};
  for(const type of new Set(items.map(item=>item?.type).filter(type=>typeof type==='string'&&type.startsWith('asset_')))){
    const id=ctx.db.normalizeId('assets',type.slice(6)),asset=id?await ctx.db.get(id):null;
    if(asset)defs[type]=assetDefinition(asset);
  }
  return defs;
}
// The client-side catalogue entry, with storage files resolved to URLs.
export async function assetCatalogueEntry(ctx,asset){
  const files=new Map();
  for(const id of [asset.icon,...asset.parts.flatMap(p=>[p.storageId,p.foregroundStorageId].filter(Boolean))])if(!files.has(id))files.set(id,await ctx.storage.getUrl(id));
  return {id:assetType(asset),name:asset.name,category:asset.category,width:asset.width,depth:asset.depth,surfaceHeight:asset.surfaceHeight,spriteDensity:asset.spriteDensity,
    ...(asset.wallWidth!==undefined?{wallWidth:asset.wallWidth}:{}),...(asset.tableOffsetY!==undefined?{tableOffsetY:asset.tableOffsetY}:{}),...(asset.seat?{seat:seatSpots(asset)}:{}),
    ...(asset.frameDuration?{frameDuration:asset.frameDuration}:{}),...(asset.switchable||asset.program?{switchable:true}:{}),...(asset.program?{program:asset.program}:{}),
    controls:furnitureControls(asset),icon:files.get(asset.icon),owner:asset.ownerId,ownerName:asset.ownerName,createdAt:asset.createdAt,
    // Frame cells are already cut to one box, so the client must not trim them again.
    parts:asset.parts.flatMap(p=>[...['base',...(p.foregroundStorageId?['foreground']:[])].map(layer=>({file:files.get(layer==='foreground'?p.foregroundStorageId:p.storageId),layer,direction:p.direction,reg:p.reg,width:p.width,height:p.height,z:0,foreground:layer==='foreground',ink:8,alphaPrepared:true,...(p.frames?{frames:p.frames,trimFrames:false}:{})}))]),
    views:asset.views};
}
// Non-admins may only add, move or remove pieces they own, built from their own assets;
// anything else in the list must be untouched. `previous` and `next` need only carry the pieces
// that changed. `where` (from rules.ownSpaceCheck) confines a builder's pieces to their own space.
// There is no cap on how many pieces a player builds or places: a space's tiles are the limit.
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
}
