// Agents build into the room on a player's behalf through the hosted MCP endpoint
// (api/mcp.js). The player makes a long-lived agent key in the room; only its hash is kept.
import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail,layoutFor,validateFurniture,isPlaced,cells} from './lib/rules.js';
import {ASSET_CATEGORIES,ASSET_LIMIT_PER_PLAYER,assetType,assetCatalogueEntry,definitionsFor,assertOwnedChanges} from './lib/assets.js';
import {playerFor} from './room.js';
import {isWallItem} from '../shared/furniture-model.js';

async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const hex=bytes=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function agentFor(ctx,agentToken){
  if(!/^[a-f0-9]{64}$/.test(agentToken))fail('This agent is not attached. Attach it with a pairing code from the room.');
  const digest=await hash(agentToken);
  const link=await ctx.db.query('agentLinks').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!link)fail('This agent is not attached. Attach it with a pairing code from the room.');
  const player=await ctx.db.get(link.playerId);
  if(!player)fail('The player this agent belonged to has left. Attach it again.');
  return {player,link};
}
async function getRoom(ctx){const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();room.definitions=await definitionsFor(ctx);return room;}

// Player side: make keys, see attached agents, cut them all off.
export const attached=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  const links=await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  return links.filter(l=>l.tokenHash).map(l=>({id:l._id,label:l.label??'Agent',attachedAt:l.createdAt}));
}});
// A key for the hosted endpoint: a long-lived agent token handed to the player directly
// (shown once) to paste into their agent's key prompt.
export const createKey=mutation({args:{token:v.string(),label:v.optional(v.string())},handler:async(ctx,{token,label})=>{
  const player=await playerFor(ctx,token),now=Date.now(),agentToken=hex(32);
  await ctx.db.insert('agentLinks',{playerId:player._id,createdAt:now,tokenHash:await hash(agentToken),label:(label??'Plugin').slice(0,40)});
  return {agentToken};
}});
export const revoke=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  for(const link of await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect())await ctx.db.delete(link._id);
}});

// Agent side.
export const status=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  const {player}=await agentFor(ctx,agentToken);
  const assets=await ctx.db.query('assets').withIndex('by_owner',q=>q.eq('ownerId',player._id)).collect();
  const room=await getRoom(ctx);
  return {playerName:player.name,playerId:player._id,assets:assets.map(a=>({id:a._id,type:assetType(a),name:a.name,category:a.category,width:a.width,depth:a.depth,createdAt:a.createdAt})),
    placed:room.furniture.filter(i=>i.owner===player._id).map(({id,type,x,z,rotation})=>({id,type,x,z,rotation})),categories:ASSET_CATEGORIES};
}});
export const uploadUrl=mutation({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  await agentFor(ctx,agentToken);return await ctx.storage.generateUploadUrl();
}});
// The hosted endpoint reads an agent's upload back through its URL, then discards the raw file.
async function uploadFor(ctx,storageId){
  let file=null;
  try{file=await ctx.db.system.get(storageId);}catch{}
  if(!file)fail('No upload with that storage id.');
  return storageId;
}
export const uploadedFile=query({args:{agentToken:v.string(),storageId:v.string()},handler:async(ctx,{agentToken,storageId})=>{
  await agentFor(ctx,agentToken);return await ctx.storage.getUrl(await uploadFor(ctx,storageId));
}});
export const discardUpload=mutation({args:{agentToken:v.string(),storageId:v.string()},handler:async(ctx,{agentToken,storageId})=>{
  const {player}=await agentFor(ctx,agentToken),id=await uploadFor(ctx,storageId);
  const owned=await ctx.db.query('assets').withIndex('by_owner',q=>q.eq('ownerId',player._id)).collect();
  if(owned.some(a=>a.icon===id||a.parts.some(p=>p.storageId===id)))fail('That file belongs to a piece.');
  await ctx.storage.delete(id);
}});
const part=v.object({storageId:v.id('_storage'),direction:v.number(),width:v.number(),height:v.number(),reg:v.object({x:v.number(),y:v.number()})});
const view=v.object({direction:v.number(),source:v.number(),mirror:v.boolean()});
export const createAsset=mutation({args:{agentToken:v.string(),name:v.string(),category:v.string(),width:v.number(),depth:v.number(),surfaceHeight:v.optional(v.number()),spriteDensity:v.number(),
  wallWidth:v.optional(v.number()),tableOffsetY:v.optional(v.number()),icon:v.id('_storage'),parts:v.array(part),views:v.array(view)},handler:async(ctx,{agentToken,...spec})=>{
  const {player}=await agentFor(ctx,agentToken);
  const name=spec.name.normalize('NFKC').trim();
  if(name.length<1||name.length>40)fail('Give the piece a name of up to 40 characters.');
  if(!ASSET_CATEGORIES.includes(spec.category))fail(`Category must be one of ${ASSET_CATEGORIES.join(', ')}.`);
  const whole=n=>Number.isInteger(n);
  if(!whole(spec.width)||!whole(spec.depth)||spec.width<1||spec.depth<1||spec.width>4||spec.depth>4)fail('Footprint must be 1 to 4 tiles each way.');
  if(![1,2,3].includes(spec.spriteDensity))fail('Sprite density must be 1, 2 or 3.');
  if(spec.parts.length<1||spec.parts.length>4)fail('A piece needs one to four sprites.');
  for(const p of spec.parts){
    if(![0,2,4,6].includes(p.direction)||!whole(p.width)||!whole(p.height)||p.width<4||p.height<4||p.width>200||p.height>200||!Number.isFinite(p.reg.x)||!Number.isFinite(p.reg.y))fail('Sprite sizes must be 4 to 200 room pixels.');
    if(!await ctx.db.system.get(p.storageId))fail('A sprite upload is missing.');
  }
  if(!await ctx.db.system.get(spec.icon))fail('The icon upload is missing.');
  if(!spec.views.length||spec.views.some(vw=>![0,2,4,6].includes(vw.direction)||!spec.parts.some(p=>p.direction===vw.source)))fail('Each view must draw from an uploaded sprite direction.');
  if(new Set(spec.views.map(vw=>vw.direction)).size!==spec.views.length)fail('Views must have distinct directions.');
  if(spec.category==='Wall'&&(!whole(spec.wallWidth)||spec.wallWidth<8||spec.wallWidth>96))fail('Wall pieces need a wallWidth of 8 to 96 pixels.');
  const surfaceHeight=spec.category==='Tables'?Math.max(8,Math.min(64,spec.surfaceHeight??24)):0;
  const owned=await ctx.db.query('assets').withIndex('by_owner',q=>q.eq('ownerId',player._id)).collect();
  if(owned.length>=ASSET_LIMIT_PER_PLAYER)fail(`You can build up to ${ASSET_LIMIT_PER_PLAYER} pieces.`);
  const id=await ctx.db.insert('assets',{ownerId:player._id,ownerName:player.name,name,category:spec.category,width:spec.width,depth:spec.depth,surfaceHeight,spriteDensity:spec.spriteDensity,
    ...(spec.category==='Wall'?{wallWidth:spec.wallWidth}:{}),...(spec.tableOffsetY!==undefined?{tableOffsetY:Math.max(-32,Math.min(32,spec.tableOffsetY))}:{}),
    icon:spec.icon,parts:spec.parts,views:spec.views,createdAt:Date.now()});
  return {id,type:`asset_${id}`};
}});
export const deleteAsset=mutation({args:{agentToken:v.string(),id:v.id('assets')},handler:async(ctx,{agentToken,id})=>{
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(id);
  if(!asset||asset.ownerId!==player._id)fail('That piece is not yours.');
  const room=await getRoom(ctx),type=assetType(asset);
  if(room.furniture.some(item=>item.type===type)){
    const items=room.furniture.filter(item=>item.type!==type);
    await ctx.db.patch(room._id,{furniture:items,revision:room.revision+1});
  }
  for(const storageId of new Set([asset.icon,...asset.parts.map(p=>p.storageId)]))await ctx.storage.delete(storageId);
  await ctx.db.delete(id);
}});
// The floor as the agent sees it: which tiles exist, which are taken, and where walls are.
export const map=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  await agentFor(ctx,agentToken);
  const room=await getRoom(ctx),layout=layoutFor(room.options);
  const taken=new Set(room.furniture.filter(i=>isPlaced(i)&&!isWallItem(room.definitions[i.type])&&room.definitions[i.type].category!=='Rugs').flatMap(i=>cells(i,room.definitions).map(c=>c.join(','))));
  const areas={main:layout.mainTiles,dance:layout.danceTiles,poolDeck:layout.poolDeckTiles,parking:layout.parkingTiles,lounge:layout.loungeTiles.filter(([x,z])=>!layout.pitTiles.some(([px,pz])=>px===x&&pz===z))};
  return {areas:Object.fromEntries(Object.entries(areas).map(([name,tiles])=>[name,{tiles:tiles.map(([x,z])=>({x,z,free:!taken.has(`${x},${z}`)}))}])),
    walls:[...layout.mainTiles,...layout.danceTiles].flatMap(([x,z])=>{const all=new Set(layout.tiles.map(t=>t.join(',')));return [...(all.has(`${x-1},${z}`)?[]:[{x,z,side:'left',rotation:2}]),...(all.has(`${x},${z-1}`)?[]:[{x,z,side:'right',rotation:4}])];}),
    furniture:room.furniture.filter(isPlaced).map(({id,type,x,z,rotation,owner})=>({id,type,x,z,rotation,mine:false,owner:owner??null}))};
}});
export const place=mutation({args:{agentToken:v.string(),assetId:v.id('assets'),x:v.number(),z:v.number(),rotation:v.optional(v.number()),u:v.optional(v.number()),height:v.optional(v.number())},handler:async(ctx,{agentToken,assetId,x,z,rotation,u,height})=>{
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(assetId);
  if(!asset||asset.ownerId!==player._id)fail('That piece is not yours.');
  const room=await getRoom(ctx),type=assetType(asset),def=room.definitions[type];
  const item={id:crypto.randomUUID(),type,rotation:rotation??def.views[0].direction,x,z,owner:player._id,...(isWallItem(def)?{u:u??.5,height:height??60}:{})};
  if(!def.views.some(vw=>vw.direction===item.rotation))fail(`Rotation must be one of ${def.views.map(vw=>vw.direction).join(', ')}.`);
  const items=[...room.furniture,item];
  try{assertOwnedChanges(room.furniture,items,player._id,room.definitions);}catch(error){fail(error.message);}
  validateFurniture(items,room.options,room.definitions);
  await ctx.db.patch(room._id,{furniture:items,revision:room.revision+1});
  return {itemId:item.id};
}});
export const remove=mutation({args:{agentToken:v.string(),itemId:v.string()},handler:async(ctx,{agentToken,itemId})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx);
  const item=room.furniture.find(i=>i.id===itemId);
  if(!item||item.owner!==player._id)fail('That piece is not yours.');
  await ctx.db.patch(room._id,{furniture:room.furniture.filter(i=>i.id!==itemId),revision:room.revision+1});
}});
