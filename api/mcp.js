// The room's MCP endpoint for agents building pieces: Streamable HTTP, stateless, plain JSON
// replies. Each request carries the player's agent key as a Bearer token, made in the room
// under Furniture → Build with your agent. Sprites are cut here (shared/sprite-build.js).
import {ConvexHttpClient} from 'convex/browser';
import {wearableTools,wearableHandlers} from '../server/wearables-mcp.js';
import {activityTools,activityHandlers} from '../server/activities-mcp.js';
import {anyApi} from 'convex/server';
import {sheetPrompt,surfacePrompt,stripPrompt} from '../shared/agent-prompts.js';
import {prepareSurface,surfaceSize,SURFACE_COLORS} from '../shared/surface-build.js';
import {KINDS,CONVENTIONS} from '../shared/sprite-conventions.js';
import {programReference} from '../shared/program-examples.js';
import {readImage,splitSheet,splitStrip,singleSprite,prepareAsset,seatSpec,FRAME_MAX} from '../shared/sprite-build.js';
import {designBrief} from '../shared/asset-geometry.js';
import {SEAT_BUILD_GUIDANCE} from '../shared/seat-build-guidance.js';
import {assetBlueprint} from '../shared/asset-blueprint.js';
import {assetCatalogueEntry} from '../convex/lib/assets.js';
import {SPACES_PER_PLAYER,SPACE_SIZE,SPACE_MIN_WIDTH,SPACE_MAX_WIDTH,SPACE_NAME_MAX,SPACE_FLOORS,SPACE_WALLS,SPACE_FITS} from '../shared/spaces.js';

export const maxDuration=120;
const api=anyApi,SERVER={name:'habbo-room',version:'0.12.0'},PROTOCOLS=['2024-11-05','2025-03-26','2025-06-18'];
const INSTRUCTIONS=`Build furniture, avatar clothing and activities for the player whose agent key you hold. Furniture: design_asset (prompt + reference image URLs) → draw the 2 by 2 sprite sheet with your image tool → upload_url → POST the PNG → preview_asset → submit_asset. Then place it from room_map when the player says where. Clothing: design_wearable returns an exact avatar alignment guide covering all eight angles and jacket animations. Generate transparent clothing, upload_url → preview_wearable → submit_wearable. Inspect every pose before saving; never treat a single clothing picture as a complete sheet. Clothing belongs to the avatar, works offline, and appears in the normal Hats/Jackets editor without room placement. equip_wearable changes only the authenticated player's outfit. Activities: create_activity makes quizzes or treasure hunts in the player's space; list_activities, manage_activity and play_activity expose host controls and play. add_space creates a space on the chosen tier (upper, middle, lower); style_space restyles its floor and walls, with pictures starting at design_surface. Use room_overview for routine text room checks and room_map for placement. Mutation replies confirm changes; do not automatically take a picture after each change. Use preview_asset or preview_wearable to inspect individual creations before publishing. ${CONVENTIONS}`;
const NO_KEY='No agent key. Send the player\'s key as "Authorization: Bearer <key>": in the room, open Furniture → Build with your agent → Copy agent prompt, then paste the prompt into your agent.';
const message=error=>typeof error?.data==='string'?error.data:(error?.message||String(error)).replace(/\[(CONVEX|Request ID)[^\]]*\]\s*/g,'').replace(/^Server Error\s*/,'').replace(/^Uncaught (\w*Error): /,'').split('\n')[0];
function convexUrl(){const url=process.env.CONVEX_URL||process.env.VITE_CONVEX_URL;if(!url)throw new Error('The room server is not configured (CONVEX_URL).');return url;}
async function call(kind,fn,args){try{return await new ConvexHttpClient(convexUrl())[kind](fn,args);}catch(error){throw new Error(message(error));}}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

// Tool definitions.
const KIND={type:'string',enum:Object.keys(KINDS),default:'floor',description:'floor, tabletop, table, seat, plant, lamp, rug or wall'};
const size={width:{type:'integer',minimum:1,maximum:4,default:1,description:'Length of the piece\'s front in tiles'},depth:{type:'integer',minimum:1,maximum:4,default:1,description:'How far back the piece reaches, in tiles'},kind:KIND};
const seatOptions={seat_x:{type:'integer',minimum:0,maximum:3,description:'Seats only: the tile the avatar sits on, as an offset within the footprint when the piece is placed facing lower-right (rotation 2): x runs across the depth, 0 to depth-1'},seat_z:{type:'integer',minimum:0,maximum:3,description:'Seats only: the other offset of that tile, along the width, 0 to width-1'},seat_height:{type:'integer',minimum:0,maximum:40,description:'Seats only: pixels from the floor to the seat top, so the avatar sits on it: about 10 for a chair, 20 for a bar stool, 0 for a floor cushion'},seat_offset_x:{type:'integer',minimum:-24,maximum:24,description:'Seats only: nudge the seated figure sideways in screen pixels (positive = right when the piece faces lower-right; mirrored rotations flip it) for art drawn off the tile centre'},seat_offset_y:{type:'integer',minimum:-24,maximum:24,description:'Seats only: nudge the seated figure down (positive) or up in screen pixels, on top of seat_height'}};
const animationOptions={frames:{type:'integer',minimum:2,maximum:FRAME_MAX,description:`Animated piece: the picture is a horizontal strip of this many equal frames of the one view, played in turn (2 to ${FRAME_MAX})`},frame_ms:{type:'integer',minimum:80,maximum:2000,default:250,description:'How long each frame shows'},switchable:{type:'boolean',description:'Animated pieces only: expose a power button that freezes it on its first frame or resumes playback; customize or hide it with set_controls'}};
const spriteOptions={display_width:{type:'number',minimum:8,maximum:200,description:'On-screen width of the front view in room pixels; defaults from kind and footprint, reduced proportionally if the sprite hits the height limit'},base_inset:{type:'number',minimum:-16,maximum:16,description:'Pixels to lift the base above the near edge of its footprint (default 2)'},foreground_mask_storage_id:{type:'string',description:'Seats only: PNG mask with exactly the same dimensions/layout as the sprite sheet or strip. Opaque on parts that should cover the sitter (near arm, front rim, rear-facing backrest), transparent elsewhere. Mask RGB is ignored. Enclosed seats usually need this; preview a sitter in every rotation before publishing.'}};
const source={storage_id:{type:'string',description:'The storageId returned when the source image was POSTed to an upload_url'},image_url:{type:'string',description:'Public http(s) URL of the source image instead of an upload'}};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
seatOptions.seat_offsets={type:'array',maxItems:4,description:'Seats only: per-rotation screen-pixel nudges, replacing the shared x/y offsets for these views (not added or mirrored). Positive x is right, positive y is down; y still combines with seat_height. Include the full seat settings when calling set_seat: it replaces them. Omitted rotations use the shared offsets.',items:object({rotation:{type:'integer',enum:[0,2,4,6]},x:{type:'integer',minimum:-24,maximum:24},y:{type:'integer',minimum:-24,maximum:24}},['rotation','x','y'])};
const TOOLS=[
  ...wearableTools,
  ...activityTools,
  {name:'status',description:'Who this agent builds for, the pieces they have built and placed, and the sprite conventions.',inputSchema:object({})},
  {name:'design_asset',description:'START HERE for any picture that is not already a finished game sprite (a photo, a logo, concept art, a real object). Returns the exact prompt for YOUR image-generation tool to redraw the piece in the room\'s isometric pixel-art style as a 2 by 2 sprite sheet of its four rotations, plus the reference images to attach (the player\'s picture, the room, an existing sprite). Generate it, save the PNG, upload it with upload_url, then call submit_asset. Never upload the player\'s picture with add_asset: it would appear in the room as-is.',
    inputSchema:object({name:{type:'string',maxLength:40,description:'Short name for the catalogue'},description:{type:'string',description:'What the piece is, in a sentence'},...size,frames:{type:'integer',minimum:2,maximum:FRAME_MAX,description:'For an animated piece: ask for a strip of this many frames of one view instead of the four-view sheet, then add_asset with frames'},reference_image_path:{type:'string',description:'Path of the player\'s picture on your machine, if there is one; it is only echoed back in the list of images to attach'},details:{type:'string',description:'Materials, colours, parts and accessories to keep or add'}},['name','description'])},
  {name:'upload_url',description:'Get a one-hour URL to upload a PNG or WebP source image to. POST the raw file with its matching Content-Type (image/png or image/webp); the JSON reply has the storageId to pass to submit_asset, add_asset or style_space. Published images are converted to lossless WebP automatically.',inputSchema:object({})},
  {name:'preview_asset',description:'Render a piece WITHOUT publishing or placing it. Pass asset_id to inspect a saved piece (including after set_seat), or the uploaded source with name and build settings to preview before submission. Returns supported rotations, labelled footprint tiles, a scale avatar and a seated test avatar, plus validation warnings and seat coordinates. Uses the game renderer.',inputSchema:object({asset_id:{type:'string'},name:{type:'string'},...source,...size,...spriteOptions,...seatOptions,...animationOptions,format:{type:'string',enum:['sheet','sprite','strip'],default:'sheet'},facing:{type:'string',enum:['right','left'],default:'right'}})},
  {name:'submit_asset',description:'Register an uploaded sprite sheet (from design_asset) as a new catalogue piece with four rotations, visible to everyone at once. The sheet is a 2 by 2 grid: top-left facing lower-right, top-right lower-left, bottom-left upper-left, bottom-right upper-right. Flat backgrounds are keyed out and each view is trimmed and scaled.',
    inputSchema:object({name:{type:'string',maxLength:40},...source,...size,...spriteOptions,...seatOptions},['name'])},
  {name:'add_asset',description:`With frames, the picture is a horizontal strip of 2 to ${FRAME_MAX} equal frames of one view and the piece animates (optionally switchable with a card button); design_asset with frames writes the prompt for such a strip. Otherwise ONLY for art that is already a finished game sprite: pixel-art, isometric, transparent background, drawn in the room's style (for example a sprite the player made themselves). It is uploaded as-is with a mirrored second view. For photos, logos, concept art or anything else, do NOT use this: call design_asset, generate the four-view sheet with your image tool, then submit_asset. ${CONVENTIONS}`,
    inputSchema:object({name:{type:'string',maxLength:40,description:'Short name shown in the catalogue'},...source,image_base64:{type:'string',description:'Base64 or data URL of a small picture'},kind:KIND,width:{type:'integer',minimum:1,maximum:4,default:1,description:'Footprint width in tiles (left-to-right along the right wall)'},depth:{type:'integer',minimum:1,maximum:4,default:1,description:'Footprint depth in tiles'},facing:{type:'string',enum:['right','left'],default:'right',description:'Which way the pictured front faces: lower-right or lower-left'},...spriteOptions,...seatOptions,...animationOptions},['name'])},
  {name:'my_assets',description:'List the pieces this player has built.',inputSchema:object({})},
  {name:'set_controls',description:'Set the buttons on a built furniture selection card, live for every player. Always choose meaningful labels matching the implemented behaviour. use names the program interaction (for example Drive); power names the actions that set power on and off (for example Start engine and Stop engine). Pass null to hide either control. Programs do not automatically add buttons. This replaces both control settings without resetting program state. Only the builder or Grant can edit.',inputSchema:object({asset_id:{type:'string'},use:{type:['string','null'],minLength:1,maxLength:24,description:'Button label for the program interact event, or null to hide'},power:{anyOf:[object({onLabel:{type:'string',minLength:1,maxLength:24},offLabel:{type:'string',minLength:1,maxLength:24}},['onLabel','offLabel']),{type:'null'}],description:'Labels for switching on and off, or null to hide'}},['asset_id','use','power'])},
  {name:'get_connections',description:'Read the outgoing named signal connections of a placed programmed item. Use room_map to find placed item IDs.',inputSchema:object({item_id:{type:'string'}},['item_id'])},
  {name:'set_connections',description:'Replace a placed item’s outgoing signal connections. Both ends must be programmed pieces you own (or you must be Grant) in the same space. Up to eight incoming and eight outgoing connections per piece. An empty array disconnects all outputs. Read get_connections first to preserve existing links.',inputSchema:object({item_id:{type:'string'},connections:{type:'array',maxItems:8,items:object({name:{type:'string',pattern:'^[-a-zA-Z0-9_]{1,32}$'},target_item_id:{type:'string'}},['name','target_item_id'])}},['item_id','connections'])},
  {name:'program_api',description:'Read the furniture JavaScript API, proximity events, connected-item signals, lifecycle, limits and working examples before writing an asset program.',inputSchema:object({})},
  {name:'get_program',description:'Read a built asset’s saved JavaScript source, defaults and revision before editing it.',inputSchema:object({asset_id:{type:'string'}},['asset_id'])},
  {name:'set_program',description:'Attach or replace a self-contained JavaScript ES module on a built asset. Read program_api first. Every placed copy loads it live without a room reload; new versions reset instance state to initial_state. Use source:null to remove it. Only the builder or Grant can edit.',inputSchema:object({asset_id:{type:'string'},source:{type:['string','null'],maxLength:65536},initial_state:{description:'JSON state defaults for each placed copy; defaults to {}'},expected_revision:{type:'integer',minimum:0,description:'Revision from get_program; rejects stale edits'}},['asset_id','source'])},
  {name:'set_seat',description:'Fix where an avatar sits on one of the player\'s built seats (kind seat) and how high, without rebuilding it: the tile within the footprint and the seat top\'s height in pixels, so a figure sits on a stool top rather than beside or inside it. clear: true returns the piece to seating on every tile at chair height. Open rooms pick it up at once.',
    inputSchema:object({asset_id:{type:'string',description:'From my_assets or submit_asset'},...seatOptions,clear:{type:'boolean'}},['asset_id'])},
  {name:'delete_asset',description:'Delete a piece the player built, removing any placed copies.',inputSchema:object({asset_id:{type:'string'}},['asset_id'])},
  {name:'room_map',description:'The room floor: the lobby areas with their tiles (and whether each is free), every space by name and position, and, for the lobby and the player\'s own spaces (the only places the agent can build), their tiles, wall segments for wall pieces (x, z, side, rotation) and placed furniture.',inputSchema:object({})},
  {name:'room_overview',description:'Default way to check the room: text-only current players, spaces and placed furniture, without downloading images or starting a browser. Compare snapshots for changes. Use room_map when you need free placement tiles.',inputSchema:object({focus:{type:'string',enum:['mine','space','room'],default:'room'},space_id:{type:'string',description:'Required with focus space'}})},
  {name:'place',description:'Place one of the player\'s pieces on a free tile (x, z from room_map), or on a table with support_id from room_map.tables. Wall pieces take the wall tile plus rotation 2 (left wall) or 4 (right wall), with u (0.25-0.75 along the tile) and height (26-88 px up the wall).',
    inputSchema:object({asset_id:{type:'string'},x:{type:'integer'},z:{type:'integer'},support_id:{type:'string',description:'Table item id from room_map.tables. x,z must be free tiles on that table and the whole piece must fit.'},rotation:{type:'integer',description:'Supported direction from the asset views; walls support 2 or 4 only'},u:{type:'number'},height:{type:'number'}},['asset_id','x','z'])},
  {name:'remove',description:'Pick a placed piece of the player\'s out of the room (item id from status or room_map).',inputSchema:object({item_id:{type:'string'}},['item_id'])},
  {name:'add_space',description:`Add a block of floor to the room for this player. By default, new rooms fill the tier with the least total room width. Only specify level 1 (upper), 0 (middle), or -1 (lower) when the player requests a particular level. The room stays on its chosen tier, with stairs between staggered walkways; the lobby stays at its current level. Every space is ${SPACE_SIZE} by ${SPACE_SIZE} tiles. Each player can add ${SPACES_PER_PLAYER} space, with no room-wide space limit. The reply and room_map list its tiles, which the player's pieces can then be placed on.`,
    inputSchema:object({name:{type:'string',maxLength:SPACE_NAME_MAX,description:'What to call the space, up to 24 characters'},level:{type:'integer',enum:[-1,0,1],description:'Optional override. Omit to automatically fill the shortest tier.'},floor:{type:'string',enum:SPACE_FLOORS,default:'carpet',description:'Floor finish'},floor_color:{type:'string',description:'A colour from the room\'s floor palette (status lists them); defaults to the first'}},['name'])},
  {name:'design_surface',description:'START HERE for any picture that will go on a space\'s floor or wall. Returns the exact prompt for YOUR image-generation tool to draw it in the room\'s pixel-art style at the game\'s own pixel scale, with the room reference to attach, then the upload and style_space steps. Floors are drawn as a top view and walls flat on: the game projects and skews them itself.',
    inputSchema:object({surface:{type:'string',enum:['floor','wall']},fit:{type:'string',enum:SPACE_FITS,default:'tile',description:'tile: a seamless texture repeated on every tile or wall segment; cover: one picture over the whole floor or wall'},description:{type:'string',description:'What the picture shows, in a sentence or two'},details:{type:'string',description:'Colours, motifs, anything the player specified'}},['surface','description'])},
  {name:'style_space',description:`Restyle the player's space (Grant may restyle any, by space_id). Only the fields given change. Floor: a finish (${SPACE_FLOORS.join(', ')}) and any hex colour, and optionally a picture laid over it. Back wall: a wallpaper (${SPACE_WALLS.join(', ')}) and any hex colour, both defaulting to the room's own, and optionally a picture. Pictures come from design_surface: generate it, POST the PNG to an upload_url and pass its storageId (or give a public image URL). Every picture is remade at the game's pixel scale with at most ${SURFACE_COLORS} colours and hard edges, so it always matches the room's pixel art; the reply says the size it was kept at. Fit 'tile' repeats the picture on every floor tile or wall segment (textures), 'cover' stretches one copy across the whole floor or wall (a mural, a rug design, a big logo); transparent areas show the finish beneath. Pass null for a picture, wall or wall_color to clear it. The name can change too.`,
    inputSchema:object({space_id:{type:'string',description:'From status or room_map; optional when the player has just one space'},name:{type:'string',maxLength:SPACE_NAME_MAX},floor:{type:'string',enum:SPACE_FLOORS},floor_color:{type:'string',description:'Hex colour like #b59232'},floor_image_storage_id:{type:['string','null'],description:'storageId of the uploaded floor picture, or null to clear the picture'},floor_image_url:{type:'string',description:'Public http(s) URL of the floor picture instead of an upload'},floor_fit:{type:'string',enum:SPACE_FITS},wall:{type:['string','null'],description:`Wallpaper: ${SPACE_WALLS.join(', ')}, or null for the room's`},wall_color:{type:['string','null'],description:'Hex colour like #787e9c, or null for the room\'s'},wall_image_storage_id:{type:['string','null'],description:'storageId of the uploaded wall picture, or null to clear the picture'},wall_image_url:{type:'string',description:'Public http(s) URL of the wall picture instead of an upload'},wall_fit:{type:'string',enum:SPACE_FITS}})},
  {name:'resize_space',description:`Make the player's space wider or narrower along the back wall: ${SPACE_MIN_WIDTH} to ${SPACE_MAX_WIDTH} tiles (it starts at ${SPACE_SIZE}; depth stays ${SPACE_SIZE}). Widening adds columns on its right; narrowing removes them, so they must be empty of furniture and players first. The spaces after it on the same tier, with their furniture and the players on them, slide along to stay joined. Grant may resize any space by space_id.`,
    inputSchema:object({space_id:{type:'string',description:'Optional when the player has just one space'},width:{type:'integer',minimum:SPACE_MIN_WIDTH,maximum:SPACE_MAX_WIDTH}},['width'])},
  {name:'remove_space',description:'Remove the latest added space on a tier (its id from room_map). Only the newest space on that tier can go, so earlier ones never float; it must be the player\'s own (or the player must be Grant) and have no furniture or players on it.',inputSchema:object({space_id:{type:'string'}},['space_id'])},
];

const defaults=args=>({width:1,depth:1,kind:'floor',...args});
const renderOrigin=()=>process.env.ROOM_RENDER_ORIGIN||(process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:'https://chat.grantm.ac');
async function render(origin,payload){const {renderInBrowser}=await import('../server/render.js');return renderInBrowser(renderOrigin(origin),payload);}
async function sourceViews(token,args,format){
  const image=await loadSource(token,args),mask=args.foreground_mask_storage_id?await loadSource(token,{storage_id:args.foreground_mask_storage_id}):null;
  if(format==='sheet')return splitSheet(image,mask);
  if(format==='strip'&&!args.frames)throw new Error(`An animation strip needs frames (2 to ${FRAME_MAX}).`);
  return {[args.facing==='left'?4:2]:format==='strip'?splitStrip(image,args.frames,mask):singleSprite(image,mask)};
}
async function loadSource(token,{storage_id,image_url,image_base64}){
  let buffer;
  if(storage_id){
    const url=await call('query',api.agents.uploadedFile,{agentToken:token,storageId:storage_id});
    const response=await fetch(url);if(!response.ok)throw new Error('Could not read the upload.');
    buffer=Buffer.from(await response.arrayBuffer());
  }else if(image_url){
    const response=await fetch(image_url);if(!response.ok)throw new Error(`Could not fetch ${image_url}`);
    buffer=Buffer.from(await response.arrayBuffer());
  }else if(image_base64)buffer=Buffer.from(image_base64.replace(/^data:[^,]*,/,''),'base64');
  else throw new Error('Give storage_id (from upload_url) or image_url.');
  return readImage(buffer);
}
const uploader=token=>async buffer=>{
  const url=await call('mutation',api.agents.uploadUrl,{agentToken:token});
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'image/webp'},body:buffer});
  if(!response.ok)throw new Error('Upload failed.');
  return (await response.json()).storageId;
};
async function register(token,args,views){
  const upload=uploader(token);
  const {spec,summary}=await prepareAsset(args,views,upload);
  const result=await call('mutation',api.agents.createAsset,{agentToken:token,...spec});
  if(args.storage_id)await call('mutation',api.agents.discardUpload,{agentToken:token,storageId:args.storage_id}).catch(()=>{});
  return summary(result);
}
const HANDLERS={
  ...wearableHandlers({call,api,render,loadSource,uploader}),
  ...activityHandlers({call,api}),
  async get_connections({item_id},{token}){
    const result=await call('query',api.programs.getConnections,{agentToken:token,itemId:item_id});
    return {item_id:result.itemId,connections:result.connections.map(({name,targetId})=>({name,target_item_id:targetId}))};
  },
  async set_connections({item_id,connections},{token}){
    const result=await call('mutation',api.programs.setConnections,{agentToken:token,itemId:item_id,connections:connections.map(({name,target_item_id})=>({name,targetId:target_item_id}))});
    return {item_id:result.itemId,connections:result.connections.map(({name,targetId})=>({name,target_item_id:targetId}))};
  },
  async set_controls({asset_id,use,power},{token}){
    return call('mutation',api.assetControls.set,{agentToken:token,assetId:asset_id,controls:{use,power}});
  },
  async program_api(){return programReference;},
  async get_program({asset_id},{token}){return call('query',api.programs.get,{agentToken:token,assetId:asset_id});},
  async set_program({asset_id,source,initial_state,expected_revision},{token}){
    return call('mutation',api.programs.set,{agentToken:token,assetId:asset_id,source,...(initial_state!==undefined?{initialState:initial_state}:{}),...(expected_revision!==undefined?{expectedRevision:expected_revision}:{})});
  },
  async status(_,{token}){await call('mutation',api.agents.connected,{agentToken:token});return {...await call('query',api.agents.status,{agentToken:token}),conventions:CONVENTIONS};},
  async design_asset(args,{origin}){
    args=defaults(args);
    const result=value=>({content:[{type:'text',text:JSON.stringify({...value,...(args.kind==='seat'?{seat_review:SEAT_BUILD_GUIDANCE}:{})})},{type:'image',mimeType:'image/webp',data:blueprint}]});
    const blueprint=await assetBlueprint(args);
    const reference=name=>`${origin}/agent-reference/${name}`;
    if(args.frames)return result({brief:designBrief(args),prompt:stripPrompt(args),attach:[reference('room-style.png'),reference(args.kind==='wall'?'sprite-wall-speaker.png':'sprite-sofa.png')],attach_order:'the room first, then the sprite sample (download the URLs first)',
      output:`One wide PNG with a transparent background: a single row of ${args.frames} equal frames of the piece facing lower-right.`,
      then:`Save the PNG, call upload_url and POST the file to it. Call preview_asset with format strip and the same build settings, then add_asset with the returned storageId as storage_id, name "${args.name}", kind "${args.kind}", width ${args.width}, depth ${args.depth}, frames ${args.frames}, frame_ms for the speed (250 is a steady blink), and switchable true if players should be able to switch it off and on. Call set_controls to choose meaningful button labels.`});
    const attach=[...(args.reference_image_path?[args.reference_image_path]:[]),reference('room-style.png'),reference(args.kind==='wall'?'sprite-wall-speaker.png':'sprite-sofa.png')];
    return result({brief:designBrief(args),prompt:sheetPrompt({...args,hasReference:!!args.reference_image_path}),attach,attach_order:args.reference_image_path?'reference image 1 is the player\'s picture, then the room, then the sprite sample (download the URLs first)':'the room first, then the sprite sample (download the URLs first)',
      output:'One square PNG (1024x1024 or larger) with a transparent background: a 2 by 2 grid of the four views.',
      then:`Save the generated PNG, call upload_url and POST the file to it (curl -s -X POST "<upload_url>" -H "Content-Type: image/png" --data-binary @sheet.png). Call preview_asset with format sheet and the same settings, inspect it, then call submit_asset with the returned storageId as storage_id, name "${args.name}", kind "${args.kind}", width ${args.width}, depth ${args.depth}.`});
  },
  async upload_url(_,{token}){
    const url=await call('mutation',api.agents.uploadUrl,{agentToken:token});
    return {upload_url:url,valid_for:'about an hour',post_with:`curl -s -X POST "${url}" -H "Content-Type: image/png" --data-binary @sheet.png`,then:'The JSON reply has a storageId: pass it to submit_asset (a 2 by 2 sheet) or add_asset (a finished sprite) as storage_id.'};
  },
  async preview_asset(args,{token,origin}){
    if(args.asset_id){
      const {asset,positions}=await call('query',api.agents.previewAsset,{agentToken:token,assetId:args.asset_id});
      return {content:[{type:'image',mimeType:'image/webp',data:await render(origin,{mode:'asset',asset})},{type:'text',text:JSON.stringify({asset_id:args.asset_id,views:asset.views,positions,note:'Saved piece; no changes made. Custom programs are not executed.'})}]};
    }
    if(!args.name)throw new Error('Give asset_id for a saved piece, or name and an uploaded source for a new piece.');
    args=defaults(args);await call('query',api.agents.status,{agentToken:token});
    const {spec,summary}=await prepareAsset(args,await sourceViews(token,args,args.format??'sheet'),async buffer=>`data:image/webp;base64,${buffer.toString('base64')}`);
    const asset=await assetCatalogueEntry({storage:{getUrl:async id=>id}},{...spec,_id:'preview',ownerId:'preview',ownerName:'Preview',createdAt:0});
    return {content:[{type:'image',mimeType:'image/webp',data:await render(origin,{mode:'asset',asset})},{type:'text',text:JSON.stringify({...summary({}),published:false,note:'No catalogue entry or room item was created. Check the rendered base, seat and foreground in every rotation.'})}]};
  },
  async submit_asset(args,{token}){args=defaults(args);return register(token,args,await sourceViews(token,args,'sheet'));},
  // With `frames`, the picture is a strip of equal frames of one view: it becomes an animated piece.
  async add_asset(args,{token}){
    args=defaults({facing:'right',...args});return register(token,args,await sourceViews(token,args,args.frames?'strip':'sprite'));
  },
  async set_seat({asset_id,clear,...rest},{token}){
    const seat=clear?null:seatSpec(rest);
    return {...await call('mutation',api.agents.setSeat,{agentToken:token,assetId:asset_id,seat}),then:'Call preview_asset with this asset_id to check the test sitter in every rotation without asking the player to sit.'};
  },
  async my_assets(_,{token}){return (await call('query',api.agents.status,{agentToken:token})).assets;},
  async delete_asset({asset_id},{token}){await call('mutation',api.agents.deleteAsset,{agentToken:token,id:asset_id});return 'Deleted.';},
  async room_overview({focus='room',space_id},{token}){return call('query',api.agents.overview,{agentToken:token,focus,...(space_id?{spaceId:space_id}:{})});},
  async room_map(_,{token}){return call('query',api.agents.map,{agentToken:token});},
  async place({asset_id,support_id,...rest},{token}){return {...await call('mutation',api.agents.place,{agentToken:token,assetId:asset_id,...rest,...(support_id?{supportId:support_id}:{})}),then:'Placed successfully. Use room_overview if you need a text check.'};},
  async remove({item_id},{token}){await call('mutation',api.agents.remove,{agentToken:token,itemId:item_id});return 'Removed.';},
  async add_space({floor_color,...rest},{token}){
    const space=await call('mutation',api.agents.addSpace,{agentToken:token,...rest,...(floor_color?{floorColor:floor_color}:{})});
    return {...space,then:'The space is in the room for everyone now. Its tiles are free: place the player\'s pieces on them with place when they say where. Use room_overview for a text check.'};
  },
  async design_surface({surface,fit='tile',description,details=''},{origin}){
    const {w,h}=surfaceSize(surface,fit),id=surface==='floor'?'floor_image_storage_id':'wall_image_storage_id',fitKey=surface==='floor'?'floor_fit':'wall_fit';
    return {prompt:surfacePrompt({surface,fit,description,details,width:w,height:h}),attach:[`${origin}/agent-reference/room-style.png`],attach_order:'the room reference (download the URL first)',
      output:`One PNG, ${w} by ${h} pixels or an exact multiple of it (for example ${w*8} by ${h*8}); the game keeps it at ${w} by ${h} with at most ${SURFACE_COLORS} colours.`,
      then:`Save the generated PNG, call upload_url and POST the file to it (curl -s -X POST "<upload_url>" -H "Content-Type: image/png" --data-binary @picture.png), then call style_space with ${id} set to the returned storageId and ${fitKey} "${fit}".`};
  },
  // Every picture is remade at game scale (shared/surface-build.js) before it reaches the room, so
  // the space keeps the room's pixel-art look however the picture was made.
  async style_space({space_id,floor_color,floor_image_storage_id,floor_image_url,floor_fit,wall_color,wall_image_storage_id,wall_image_url,wall_fit,...rest},{token}){
    const args={agentToken:token,...rest},upload=uploader(token),kept={};
    for(const [value,key] of [[space_id,'spaceId'],[floor_color,'floorColor'],[floor_image_storage_id,'floorImage'],[floor_fit,'floorFit'],[wall_color,'wallColor'],[wall_image_storage_id,'wallImage'],[wall_fit,'wallFit']])if(value!==undefined)args[key]=value;
    for(const [surface,storage_id,image_url,key,fit] of [['floor',floor_image_storage_id,floor_image_url,'floorImage',floor_fit??'tile'],['wall',wall_image_storage_id,wall_image_url,'wallImage',wall_fit??'tile']]){
      if(!storage_id&&!image_url)continue;
      const {buffer,width,height}=await prepareSurface(await loadSource(token,{storage_id,image_url}),{surface,fit});
      args[key]=await upload(buffer);kept[`${surface}_picture`]=`${width} by ${height} pixels, ${fit}`;
      if(storage_id)await call('mutation',api.agents.discardUpload,{agentToken:token,storageId:storage_id}).catch(()=>{});
    }
    const space=await call('mutation',api.agents.styleSpace,args);
    return {...space,...kept,then:'Everyone in the room sees the new look now. Use room_overview for a text check.'};
  },
  async resize_space({space_id,width},{token}){
    const space=await call('mutation',api.agents.resizeSpace,{agentToken:token,...(space_id?{spaceId:space_id}:{}),width});
    return {...space,then:`${space.moved?`The ${space.moved} space${space.moved===1?'':'s'} after it moved along with everything on them. `:''}room_map has the new tiles; Use room_overview for a text check.`};
  },
  async remove_space({space_id},{token}){await call('mutation',api.agents.removeSpace,{agentToken:token,spaceId:space_id});return 'Removed.';},
};

// JSON-RPC over one POST: a single message or a batch; notifications get no reply.
const reply=(id,result)=>({jsonrpc:'2.0',id,result});
const rpcError=(id,code,text)=>({jsonrpc:'2.0',id,error:{code,message:text}});
async function handle(m,context){
  if(!m||typeof m!=='object'||m.jsonrpc!=='2.0'||typeof m.method!=='string')return rpcError(m?.id??null,-32600,'Invalid request');
  if(!('id' in m)||m.id===null)return null;
  const {id,method,params={}}=m;
  switch(method){
    case 'initialize':
      if(context.token){try{await call('mutation',api.agents.connected,{agentToken:context.token});}catch(error){return rpcError(id,-32603,message(error));}}
      return reply(id,{protocolVersion:PROTOCOLS.includes(params.protocolVersion)?params.protocolVersion:PROTOCOLS.at(-1),capabilities:{tools:{}},serverInfo:SERVER,instructions:INSTRUCTIONS});
    case 'ping':return reply(id,{});
    case 'tools/list':return reply(id,{tools:TOOLS});
    case 'tools/call':{
      const tool=HANDLERS[params.name];
      if(!tool)return rpcError(id,-32602,params.name==='room_picture'?'Room pictures have been removed. Use room_overview for text-only room checks.':`Unknown tool: ${params.name}`);
      try{
        if(!context.token)throw new Error(NO_KEY);
        const value=await tool(params.arguments??{},context);
        if(Array.isArray(value?.content))return reply(id,{content:value.content});
        return reply(id,{content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value,null,2)}]});
      }catch(error){return reply(id,{content:[{type:'text',text:`Error: ${message(error)}`}],isError:true});}
    }
    default:return rpcError(id,-32601,`Method not found: ${method}`);
  }
}
function tokenFrom(request){
  const header=request.headers.get('authorization')??'';
  const bearer=/^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const key=bearer||new URL(request.url).searchParams.get('key')||'';
  return /^[a-f0-9]{64}$/.test(key)?key:'';
}
export async function POST(request){
  let body;
  try{body=await request.json();}catch{return json(rpcError(null,-32700,'Parse error'),400);}
  const context={token:tokenFrom(request),origin:new URL(request.url).origin,request};
  const messages=Array.isArray(body)?body:[body];
  if(!messages.length)return json(rpcError(null,-32600,'Invalid request'),400);
  const replies=(await Promise.all(messages.map(m=>handle(m,context)))).filter(Boolean);
  if(!replies.length)return new Response(null,{status:202});
  return json(Array.isArray(body)?replies:replies[0]);
}
const notAllowed=()=>json({error:'This is the room\'s MCP endpoint: POST JSON-RPC here with your agent key as a Bearer token.'},405);
export const GET=notAllowed,PUT=notAllowed,PATCH=notAllowed;
export async function DELETE(){return new Response(null,{status:204});}
