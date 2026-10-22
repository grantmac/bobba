// Agents build into the room on a player's behalf through the hosted MCP endpoint
// (api/mcp.js). The player makes a long-lived agent key in the room; only its hash is kept.
import {mutation,query} from './_generated/server.js';
import {v} from 'convex/values';
import {fail,layoutFor,validateFurniture,validateSpace,validateSpaceStyle,ownSpaceCheck,healOrphans,isPlaced,cells,blocked,atTime,playerTiles,onlinePlayers} from './lib/rules.js';
import {backWallTiles} from '../shared/room-layout.js';
import {ASSET_CATEGORIES,assetType,assetCatalogueEntry,definitionsFor,assertOwnedChanges} from './lib/assets.js';
import {floorColors} from './lib/catalog.js';
import {playerFor} from './room.js';
import {discardRemovedPrograms} from './lib/programs.js';
import {isWallItem,pickupWithContents} from '../shared/furniture-model.js';
import {SPACE_LIMIT,SPACES_PER_PLAYER,SPACE_SIZE,SPACE_MIN_WIDTH,SPACE_MAX_WIDTH,SPACE_FLOORS,SPACE_WALLS,SPACE_FITS,SPACE_IMAGE_MAX} from '../shared/spaces.js';
// A space's styling as agents see it: pictures as yes/no, the storage ids stay private.
const spaceStyle=s=>({floor:s.floor,floorColor:s.floorColor,floorFit:s.floorFit??null,floorImage:!!s.floorImage,wall:s.wall??null,wallColor:s.wallColor??null,wallFit:s.wallFit??null,wallImage:!!s.wallImage});

async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const hex=bytes=>[...crypto.getRandomValues(new Uint8Array(bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function agentFor(ctx,agentToken){
  if(!/^[a-f0-9]{64}$/.test(agentToken))fail('This agent is not attached. Attach it with a pairing code from the room.');
  const digest=await hash(agentToken);
  const link=await ctx.db.query('agentLinks').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique();
  if(!link)fail('This agent is not attached. Attach it with a pairing code from the room.');
  if(link.connectedAt===undefined&&link.expiresAt!==undefined&&link.expiresAt<=Date.now())fail('This agent connection expired. Open a new connection from Codex.');
  const player=await ctx.db.get(link.playerId);
  if(!player)fail('The player this agent belonged to has left. Attach it again.');
  if((player.blockedUntil??0)>Date.now())fail('This player is temporarily removed from the room.');
  return {player,link};
}
async function getRoom(ctx){const room=await ctx.db.query('rooms').withIndex('by_key',q=>q.eq('key','main')).unique();room.definitions=await definitionsFor(ctx);return room;}

// Player side: make keys, see attached agents, cut them all off.
export const attached=query({args:{token:v.string()},handler:async(ctx,{token})=>{
  const player=await playerFor(ctx,token);
  const links=await ctx.db.query('agentLinks').withIndex('by_player',q=>q.eq('playerId',player._id)).collect();
  return links.filter(l=>l.tokenHash).map(l=>({id:l._id,label:l.label??'Agent',attachedAt:l.createdAt,connectedAt:l.connectedAt??null}));
}});
// A key for the hosted endpoint: a long-lived agent token handed to the player directly
// (shown once) to paste into their agent's key prompt.
export const createKey=mutation({args:{token:v.string(),label:v.optional(v.string())},handler:async(ctx,{token,label})=>{
  const player=await playerFor(ctx,token),now=Date.now(),agentToken=hex(32);
  await ctx.db.insert('agentLinks',{playerId:player._id,createdAt:now,tokenHash:await hash(agentToken),label:(label??'Plugin').slice(0,40)});
  return {agentToken};
}});
// A copied key is not a connection: record the first authenticated MCP contact.
export const connected=mutation({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  const {link}=await agentFor(ctx,agentToken);
  if(link.connectedAt===undefined)await ctx.db.patch(link._id,{connectedAt:Date.now()});
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
  return {playerName:player.name,playerId:player._id,assets:assets.map(a=>({id:a._id,type:assetType(a),name:a.name,category:a.category,width:a.width,depth:a.depth,...(a.category==='Seating'?{seat:a.seat??null}:{}),...(a.frameDuration?{animated:true,frameMs:a.frameDuration,switchable:!!a.switchable}:{}),programRevision:a.programRevision??0,programmable:!!a.program,createdAt:a.createdAt})),
    placed:room.furniture.filter(i=>i.owner===player._id).map(({id,type,x,z,rotation})=>({id,type,x,z,rotation})),categories:ASSET_CATEGORIES,
    spaces:(room.spaces??[]).filter(s=>s.owner===player._id).map(s=>({id:s.id,name:s.name,width:s.width,depth:s.depth,...spaceStyle(s)})),
    spaceOptions:{perPlayer:SPACES_PER_PLAYER,limit:SPACE_LIMIT,size:`${SPACE_SIZE} by ${SPACE_SIZE} tiles to start; resize_space makes it ${SPACE_MIN_WIDTH} to ${SPACE_MAX_WIDTH} tiles wide`,floors:SPACE_FLOORS,walls:SPACE_WALLS,colors:'any hex colour like #b59232 (floorColors are the room palette)',floorColors,pictures:`PNG, JPEG, WebP or GIF up to ${SPACE_IMAGE_MAX/1024/1024} MB, uploaded through upload_url; fit 'tile' repeats it on every tile or wall segment, 'cover' stretches one copy over the whole floor or wall`}};
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
// An animated part carries its frame cells (2 to 4, in the stored sheet's pixels); the piece then
// has a frameDuration, and may be switchable: players click it to freeze it on its first frame.
const cell=v.object({x:v.number(),y:v.number(),width:v.number(),height:v.number()});
const part=v.object({storageId:v.id('_storage'),direction:v.number(),width:v.number(),height:v.number(),reg:v.object({x:v.number(),y:v.number()}),frames:v.optional(v.array(cell))});
const view=v.object({direction:v.number(),source:v.number(),mirror:v.boolean()});
const seatArg=v.object({x:v.number(),z:v.number(),height:v.number(),offsetX:v.optional(v.number()),offsetY:v.optional(v.number())});
// A seat's sitting spot: one footprint tile (as placed facing lower-right: x across the depth, z
// along the width) and the seat top's height above the floor, 0 (a cushion) to 40 px.
function validSeat(seat,{category,width,depth}){
  if(category!=='Seating')fail('Only seats have a sitting spot.');
  const whole=Number.isInteger;
  if(!whole(seat.x)||!whole(seat.z)||seat.x<0||seat.x>=depth||seat.z<0||seat.z>=width)fail(`The seat tile must be within the footprint as placed facing lower-right: x 0 to ${depth-1}, z 0 to ${width-1}.`);
  if(!whole(seat.height)||seat.height<0||seat.height>40)fail('Seat height is 0 to 40 pixels above the floor.');
  const nudge=n=>{if(n!==undefined&&(!whole(n)||n<-24||n>24))fail('Seat offsets are -24 to 24 pixels.');return n;};
  return {x:seat.x,z:seat.z,height:seat.height,...(nudge(seat.offsetX)?{offsetX:seat.offsetX}:{}),...(nudge(seat.offsetY)?{offsetY:seat.offsetY}:{})};
}
// Set where an avatar sits on a built seat and how high, or clear it with null so the whole piece
// seats at chair height again. The builder's own pieces, or any for Grant; open clients pick it up live.
export const setSeat=mutation({args:{agentToken:v.string(),assetId:v.id('assets'),seat:v.union(seatArg,v.null())},handler:async(ctx,{agentToken,assetId,seat})=>{
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(assetId);
  if(!asset||(asset.ownerId!==player._id&&player.role!=='admin'))fail('That piece is not yours.');
  await ctx.db.patch(assetId,{seat:seat?validSeat(seat,asset):undefined});
  return {assetId,seat:seat?validSeat(seat,asset):null};
}});
export const createAsset=mutation({args:{agentToken:v.string(),name:v.string(),category:v.string(),width:v.number(),depth:v.number(),surfaceHeight:v.optional(v.number()),spriteDensity:v.number(),
  wallWidth:v.optional(v.number()),tableOffsetY:v.optional(v.number()),seat:v.optional(seatArg),frameDuration:v.optional(v.number()),switchable:v.optional(v.boolean()),icon:v.id('_storage'),parts:v.array(part),views:v.array(view)},handler:async(ctx,{agentToken,...spec})=>{
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
    if(p.frames!==undefined&&(p.frames.length<2||p.frames.length>4||p.frames.some(c=>!whole(c.x)||!whole(c.y)||!whole(c.width)||!whole(c.height)||c.width<1||c.height<1)))fail('An animated sprite has 2 to 4 frame cells.');
  }
  const animated=spec.parts.some(p=>p.frames);
  if(spec.frameDuration!==undefined&&(!animated||!whole(spec.frameDuration)||spec.frameDuration<80||spec.frameDuration>2000))fail('frameDuration is 80 to 2000 ms, for an animated piece.');
  if(animated&&spec.frameDuration===undefined)fail('An animated piece needs a frameDuration.');
  if(spec.switchable&&!animated)fail('Only an animated piece can be switchable.');
  if(!await ctx.db.system.get(spec.icon))fail('The icon upload is missing.');
  if(!spec.views.length||spec.views.some(vw=>![0,2,4,6].includes(vw.direction)||!spec.parts.some(p=>p.direction===vw.source)))fail('Each view must draw from an uploaded sprite direction.');
  if(new Set(spec.views.map(vw=>vw.direction)).size!==spec.views.length)fail('Views must have distinct directions.');
  if(spec.category==='Wall'&&(!whole(spec.wallWidth)||spec.wallWidth<8||spec.wallWidth>96))fail('Wall pieces need a wallWidth of 8 to 96 pixels.');
  const surfaceHeight=spec.category==='Tables'?Math.max(8,Math.min(64,spec.surfaceHeight??24)):0;
  const id=await ctx.db.insert('assets',{ownerId:player._id,ownerName:player.name,name,category:spec.category,width:spec.width,depth:spec.depth,surfaceHeight,spriteDensity:spec.spriteDensity,
    ...(spec.category==='Wall'?{wallWidth:spec.wallWidth}:{}),...(spec.tableOffsetY!==undefined?{tableOffsetY:Math.max(-32,Math.min(32,spec.tableOffsetY))}:{}),...(spec.seat?{seat:validSeat(spec.seat,spec)}:{}),...(animated?{frameDuration:spec.frameDuration,...(spec.switchable?{switchable:true}:{})}:{}),
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
  for(const row of await ctx.db.query('programInstances').withIndex('by_asset',q=>q.eq('assetId',id)).collect())await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}});
// The floor as the agent sees it: which tiles exist, which are taken, and where walls are.
export const map=query({args:{agentToken:v.string()},handler:async(ctx,{agentToken})=>{
  await agentFor(ctx,agentToken);
  const room=await getRoom(ctx),spaces=room.spaces??[],layout=layoutFor(room.options,spaces);
  const taken=new Set(room.furniture.filter(i=>isPlaced(i)&&!isWallItem(room.definitions[i.type])&&room.definitions[i.type].category!=='Rugs').flatMap(i=>cells(i,room.definitions).map(c=>c.join(','))));
  const areas={main:layout.mainTiles,dance:layout.danceTiles,poolDeck:layout.poolDeckTiles,parking:layout.parkingTiles,lounge:layout.loungeTiles.filter(([x,z])=>!layout.pitTiles.some(([px,pz])=>px===x&&pz===z))};
  const {player}=await agentFor(ctx,agentToken);
  return {areas:Object.fromEntries(Object.entries(areas).map(([name,tiles])=>[name,{tiles:tiles.map(([x,z])=>({x,z,free:!taken.has(`${x},${z}`)}))}])),
    spaces:layout.spaces.map((space,i)=>({id:space.id,name:space.name,owner:space.owner,ownerName:space.ownerName,mine:space.owner===player._id,latest:i===layout.spaces.length-1,x:space.x,z:space.z,width:space.width,depth:space.depth,...spaceStyle(space),tiles:space.tiles.map(([x,z])=>({x,z,free:!taken.has(`${x},${z}`)}))})),
    walkway:{tiles:layout.walkwayTiles.map(([x,z])=>({x,z})),note:'A walk-only strip along the front of the lounge and the spaces: players walk here, furniture never goes here.'},
    walls:[...layout.mainTiles,...layout.danceTiles,...backWallTiles(layout)].flatMap(([x,z])=>{const all=new Set(layout.tiles.map(t=>t.join(',')));return [...(all.has(`${x-1},${z}`)?[]:[{x,z,side:'left',rotation:2}]),...(all.has(`${x},${z-1}`)?[]:[{x,z,side:'right',rotation:4}])];}),
    furniture:room.furniture.filter(isPlaced).map(({id,type,x,z,rotation,owner})=>({id,type,x,z,rotation,mine:false,owner:owner??null}))};
}});
export const place=mutation({args:{agentToken:v.string(),assetId:v.id('assets'),x:v.number(),z:v.number(),rotation:v.optional(v.number()),u:v.optional(v.number()),height:v.optional(v.number())},handler:async(ctx,{agentToken,assetId,x,z,rotation,u,height})=>{
  const {player}=await agentFor(ctx,agentToken),asset=await ctx.db.get(assetId);
  if(!asset||asset.ownerId!==player._id)fail('That piece is not yours.');
  const room=await getRoom(ctx),type=assetType(asset),def=room.definitions[type];
  const item={id:crypto.randomUUID(),type,rotation:rotation??def.views[0].direction,x,z,owner:player._id,...(isWallItem(def)?{u:u??.5,height:height??60}:{})};
  if(!def.views.some(vw=>vw.direction===item.rotation))fail(`Rotation must be one of ${def.views.map(vw=>vw.direction).join(', ')}.`);
  const previous=healOrphans(room.furniture),items=[...previous,item];
  try{assertOwnedChanges(previous,items,player._id,room.definitions,player.role==='admin'?null:ownSpaceCheck(room.options,room.spaces??[],player._id,room.definitions));}catch(error){fail(error.message);}
  validateFurniture(items,room.options,room.definitions,room.spaces??[]);
  await ctx.db.patch(room._id,{furniture:items,revision:room.revision+1});
  return {itemId:item.id};
}});
export const remove=mutation({args:{agentToken:v.string(),itemId:v.string()},handler:async(ctx,{agentToken,itemId})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx);
  const item=room.furniture.find(i=>i.id===itemId);
  if(!item||item.owner!==player._id)fail('That piece is not yours.');
  // Whatever sits on it comes off too: the player's own pieces go back to their inventory, and
  // someone else's piece keeps the table in the room until they pick it up.
  const stranded=room.furniture.find(i=>i.supportId===itemId&&i.owner!==player._id);
  if(stranded)fail('Someone else\'s piece is on it; they need to pick it up first.');
  const furniture=pickupWithContents(healOrphans(room.furniture),itemId,true);
  await discardRemovedPrograms(ctx,room.furniture,furniture);
  await ctx.db.patch(room._id,{furniture,revision:room.revision+1});
}});
// Adding floor: a new space always joins the right-hand end of the back wall, after the latest one.

export const addSpace=mutation({args:{agentToken:v.string(),name:v.string(),floor:v.optional(v.string()),floorColor:v.optional(v.string())},handler:async(ctx,{agentToken,...args})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx),spaces=room.spaces??[];
  const valid=validateSpace(args,spaces,player._id,player.role==='admin');
  const space={id:crypto.randomUUID(),owner:player._id,ownerName:player.name,...valid,createdAt:Date.now()};
  const next=[...spaces,space];
  await ctx.db.patch(room._id,{spaces:next,revision:room.revision+1});
  const placed=layoutFor(room.options,next).spaces.at(-1);
  return {spaceId:space.id,name:space.name,x:placed.x,z:placed.z,width:placed.width,depth:placed.depth,tiles:placed.tiles.map(([x,z])=>({x,z}))};
}});
// Restyle a space: its name, floor finish and colour, wallpaper and colour, or an uploaded picture on
// the floor or the back wall. Only the fields given change; null clears a wall choice or a picture.
// Grant can restyle any space; everyone else their own.
export const styleSpace=mutation({args:{agentToken:v.string(),spaceId:v.optional(v.string()),name:v.optional(v.string()),floor:v.optional(v.string()),floorColor:v.optional(v.string()),
  wall:v.optional(v.union(v.string(),v.null())),wallColor:v.optional(v.union(v.string(),v.null())),floorImage:v.optional(v.union(v.string(),v.null())),floorFit:v.optional(v.string()),wallImage:v.optional(v.union(v.string(),v.null())),wallFit:v.optional(v.string())},handler:async(ctx,{agentToken,spaceId,...patch})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx),spaces=room.spaces??[],mine=spaces.filter(s=>s.owner===player._id);
  const index=spaceId?spaces.findIndex(s=>s.id===spaceId):mine.length===1?spaces.indexOf(mine[0]):-1;
  if(index<0)fail(spaceId?'No space with that id.':mine.length?'Say which space: give its id from room_map.':'Add a space first.');
  if(spaces[index].owner!==player._id&&player.role!=='admin')fail('That space is not yours.');
  for(const key of ['floorImage','wallImage'])if(typeof patch[key]==='string')patch[key]=await pictureFor(ctx,patch[key]);
  const next=validateSpaceStyle(patch,spaces[index]);
  await ctx.db.patch(room._id,{spaces:spaces.map((s,i)=>i===index?next:s),revision:room.revision+1});
  return {spaceId:next.id,name:next.name,...spaceStyle(next)};
}});
// Make a space wider or narrower along the back wall. Narrowing drops its right-hand columns, which
// must be empty of furniture and players; everything after it (later spaces, their furniture and
// the players on them) slides along so the chain stays joined. The owner's own, or any for Grant.
export const resizeSpace=mutation({args:{agentToken:v.string(),spaceId:v.optional(v.string()),width:v.number()},handler:async(ctx,{agentToken,spaceId,width})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx),spaces=room.spaces??[],mine=spaces.filter(s=>s.owner===player._id);
  const index=spaceId?spaces.findIndex(s=>s.id===spaceId):mine.length===1?spaces.indexOf(mine[0]):-1;
  if(index<0)fail(spaceId?'No space with that id.':mine.length?'Say which space: give its id from room_map.':'Add a space first.');
  if(spaces[index].owner!==player._id&&player.role!=='admin')fail('That space is not yours.');
  if(!Number.isInteger(width)||width<SPACE_MIN_WIDTH||width>SPACE_MAX_WIDTH)fail(`A space is ${SPACE_MIN_WIDTH} to ${SPACE_MAX_WIDTH} tiles wide.`);
  const before=layoutFor(room.options,spaces).spaces[index],delta=width-before.width,end=before.x+before.width,now=Date.now(),online=await onlinePlayers(ctx,now);
  if(!delta)return {spaceId:before.id,name:before.name,x:before.x,z:before.z,width,depth:before.depth,moved:0};
  if(delta<0){
    const gone=(x,z)=>x>=before.x+width&&x<end&&z>=before.z&&z<before.z+before.depth;
    if(room.furniture.some(i=>isPlaced(i)&&cells(i,room.definitions).some(([x,z])=>gone(x,z))))fail('Clear the furniture off the columns being removed first.');
    if((room.stickies??[]).some(s=>gone(s.x,s.z)))fail('Take the notes and posters off the wall of the columns being removed first.');
    for(const p of online){const at=atTime(p,now);if(gone(Math.floor(at.x),Math.floor(at.z))||[...playerTiles([p],now)].some(key=>gone(...key.split(',').map(Number))))fail(`${p.name} is standing on the part being removed.`);}
  }
  // Furniture, wall pieces, notes and posters from the end of this space onwards all slide along.
  const furniture=room.furniture.map(i=>isPlaced(i)&&i.x>=end?{...i,x:i.x+delta}:i),stickies=(room.stickies??[]).map(s=>s.x>=end?{...s,x:s.x+delta}:s);
  for(const p of online)if(p.route.some(pt=>pt.x>=end))await ctx.db.patch(p._id,{route:p.route.map(pt=>pt.x>=end?{...pt,x:pt.x+delta}:pt)});
  const next=spaces.map((s,i)=>i===index?{...s,width}:s);
  await ctx.db.patch(room._id,{spaces:next,furniture,stickies,revision:room.revision+1});
  const placed=layoutFor(room.options,next).spaces[index];
  return {spaceId:placed.id,name:placed.name,x:placed.x,z:placed.z,width:placed.width,depth:placed.depth,moved:spaces.length-1-index};
}});
// An uploaded picture for a floor or wall, by its storage id: an image file of modest size.
async function pictureFor(ctx,storageId){
  let file=null;
  try{file=await ctx.db.system.get(storageId);}catch{}
  if(!file)fail('No upload with that storage id.');
  // Convex records the upload's Content-Type when the client sent one; an untyped upload is trusted.
  if(file.contentType&&!/^image\/(png|jpeg|webp|gif)$/.test(file.contentType))fail('Pictures must be PNG, JPEG, WebP or GIF uploads.');
  if(file.size>SPACE_IMAGE_MAX)fail(`Pictures must be under ${SPACE_IMAGE_MAX/1024/1024} MB.`);
  return file._id;
}
// Only the latest space can go, so the chain never gets a hole; it must be empty of furniture and players.
export const removeSpace=mutation({args:{agentToken:v.string(),spaceId:v.string()},handler:async(ctx,{agentToken,spaceId})=>{
  const {player}=await agentFor(ctx,agentToken),room=await getRoom(ctx),spaces=room.spaces??[];
  const index=spaces.findIndex(s=>s.id===spaceId);
  if(index<0)fail('No space with that id.');
  if(spaces[index].owner!==player._id&&player.role!=='admin')fail('That space is not yours.');
  if(index!==spaces.length-1)fail('Only the latest space can be removed; the ones after it would be left floating.');
  const placed=layoutFor(room.options,spaces).spaces[index],inside=(x,z)=>x>=placed.x&&x<placed.x+placed.width&&z>=placed.z&&z<placed.z+placed.depth;
  if(placed.tiles.some(([x,z])=>blocked(room,x,z))||room.furniture.some(i=>isPlaced(i)&&inside(i.x,i.z)))fail('Clear the furniture off the space first.');
  // Anyone standing on it, or walking to it, keeps it: their remaining route counts as theirs.
  const now=Date.now();
  for(const p of await onlinePlayers(ctx,now)){const at=atTime(p,now);if(inside(Math.floor(at.x),Math.floor(at.z))||[...playerTiles([p],now)].some(key=>inside(...key.split(',').map(Number))))fail(`${p.name} is standing on it.`);}
  await ctx.db.patch(room._id,{spaces:spaces.slice(0,index),revision:room.revision+1});
}});
