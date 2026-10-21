// The room's MCP endpoint for agents building pieces: Streamable HTTP, stateless, plain JSON
// replies. Each request carries the player's agent key as a Bearer token, made in the room
// under Catalogue → Build with your agent. Sprites are cut here (shared/sprite-build.js).
import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';
import {sheetPrompt} from '../shared/agent-prompts.js';
import {KINDS,CONVENTIONS} from '../shared/sprite-conventions.js';
import {readImage,splitSheet,prepareAsset} from '../shared/sprite-build.js';

export const maxDuration=60;
const api=anyApi,SERVER={name:'habbo-room',version:'0.2.0'},PROTOCOLS=['2024-11-05','2025-03-26','2025-06-18'];
const INSTRUCTIONS=`Builds furniture into the shared Habbo-style room for the player whose agent key you hold. For any picture that is not already a game sprite: design_asset (prompt + reference image URLs) → draw the 2 by 2 sprite sheet with your image tool → upload_url → POST the PNG to it → submit_asset with the storage id. Then place it from room_map when the player says where. ${CONVENTIONS}`;
const NO_KEY='No agent key. Send the player\'s key as "Authorization: Bearer <key>": they make one in the room under Catalogue → Build with your agent and paste it into the plugin\'s key prompt.';
const message=error=>typeof error?.data==='string'?error.data:(error?.message||String(error)).replace(/\[(CONVEX|Request ID)[^\]]*\]\s*/g,'').replace(/^Server Error\s*/,'').replace(/^Uncaught (\w*Error): /,'').split('\n')[0];
function convexUrl(){const url=process.env.CONVEX_URL||process.env.VITE_CONVEX_URL;if(!url)throw new Error('The room server is not configured (CONVEX_URL).');return url;}
async function call(kind,fn,args){try{return await new ConvexHttpClient(convexUrl())[kind](fn,args);}catch(error){throw new Error(message(error));}}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

// Tool definitions.
const KIND={type:'string',enum:Object.keys(KINDS),default:'floor',description:'floor, tabletop, table, seat, plant, lamp, rug or wall'};
const size={width:{type:'integer',minimum:1,maximum:4,default:1,description:'Length of the piece\'s front in tiles'},depth:{type:'integer',minimum:1,maximum:4,default:1,description:'How far back the piece reaches, in tiles'},kind:KIND};
const spriteOptions={display_width:{type:'number',minimum:8,maximum:200,description:'On-screen width of the front view in room pixels; defaults from kind and footprint'},base_inset:{type:'number',minimum:-16,maximum:16,description:'Pixels to lift the base above the near edge of its footprint (default 2)'}};
const source={storage_id:{type:'string',description:'The storageId returned when the PNG was POSTed to an upload_url'},image_url:{type:'string',description:'Public http(s) URL of the PNG instead of an upload'}};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const TOOLS=[
  {name:'status',description:'Who this agent builds for, the pieces they have built and placed, and the sprite conventions.',inputSchema:object({})},
  {name:'design_asset',description:'START HERE for any picture that is not already a finished game sprite (a photo, a logo, concept art, a real object). Returns the exact prompt for YOUR image-generation tool to redraw the piece in the room\'s isometric pixel-art style as a 2 by 2 sprite sheet of its four rotations, plus the reference images to attach (the player\'s picture, the room, an existing sprite). Generate it, save the PNG, upload it with upload_url, then call submit_asset. Never upload the player\'s picture with add_asset: it would appear in the room as-is.',
    inputSchema:object({name:{type:'string',maxLength:40,description:'Short name for the catalogue'},description:{type:'string',description:'What the piece is, in a sentence'},...size,reference_image_path:{type:'string',description:'Path of the player\'s picture on your machine, if there is one; it is only echoed back in the list of images to attach'},details:{type:'string',description:'Materials, colours, parts and accessories to keep or add'}},['name','description'])},
  {name:'upload_url',description:'Get a one-hour URL to upload a PNG to. POST the raw file to it with Content-Type image/png (for example with curl --data-binary); the JSON reply has the storageId to pass to submit_asset or add_asset.',inputSchema:object({})},
  {name:'submit_asset',description:'Register an uploaded sprite sheet (from design_asset) as a new catalogue piece with four rotations, visible to everyone at once. The sheet is a 2 by 2 grid: top-left facing lower-right, top-right lower-left, bottom-left upper-left, bottom-right upper-right. Flat backgrounds are keyed out and each view is trimmed and scaled.',
    inputSchema:object({name:{type:'string',maxLength:40},...source,...size,...spriteOptions},['name'])},
  {name:'add_asset',description:`ONLY for art that is already a finished game sprite: pixel-art, isometric, transparent background, drawn in the room's style (for example a sprite the player made themselves). It is uploaded as-is with a mirrored second view. For photos, logos, concept art or anything else, do NOT use this: call design_asset, generate the four-view sheet with your image tool, then submit_asset. ${CONVENTIONS}`,
    inputSchema:object({name:{type:'string',maxLength:40,description:'Short name shown in the catalogue'},...source,image_base64:{type:'string',description:'Base64 or data URL of a small picture'},kind:KIND,width:{type:'integer',minimum:1,maximum:4,default:1,description:'Footprint width in tiles (left-to-right along the right wall)'},depth:{type:'integer',minimum:1,maximum:4,default:1,description:'Footprint depth in tiles'},facing:{type:'string',enum:['right','left'],default:'right',description:'Which way the pictured front faces: lower-right or lower-left'},...spriteOptions},['name'])},
  {name:'my_assets',description:'List the pieces this player has built.',inputSchema:object({})},
  {name:'delete_asset',description:'Delete a piece the player built, removing any placed copies.',inputSchema:object({asset_id:{type:'string'}},['asset_id'])},
  {name:'room_map',description:'The room floor: areas with their tiles (and whether each is free), wall segments for wall pieces (x, z, side, rotation), and placed furniture.',inputSchema:object({})},
  {name:'place',description:'Place one of the player\'s pieces on a free tile (x, z from room_map). Wall pieces take the wall tile plus rotation 2 (left wall) or 4 (right wall), with u (0.25-0.75 along the tile) and height (26-88 px up the wall).',
    inputSchema:object({asset_id:{type:'string'},x:{type:'integer'},z:{type:'integer'},rotation:{type:'integer',description:'0, 2, 4 or 6; defaults to the piece\'s first view'},u:{type:'number'},height:{type:'number'}},['asset_id','x','z'])},
  {name:'remove',description:'Pick a placed piece of the player\'s out of the room (item id from status or room_map).',inputSchema:object({item_id:{type:'string'}},['item_id'])},
];

const defaults=args=>({width:1,depth:1,kind:'floor',...args});
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
async function register(token,args,views){
  const upload=async buffer=>{
    const url=await call('mutation',api.agents.uploadUrl,{agentToken:token});
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'image/png'},body:buffer});
    if(!response.ok)throw new Error('Upload failed.');
    return (await response.json()).storageId;
  };
  const {spec,summary}=await prepareAsset(args,views,upload);
  const result=await call('mutation',api.agents.createAsset,{agentToken:token,...spec});
  if(args.storage_id)await call('mutation',api.agents.discardUpload,{agentToken:token,storageId:args.storage_id}).catch(()=>{});
  return summary(result);
}
const HANDLERS={
  async status(_,{token}){return {...await call('query',api.agents.status,{agentToken:token}),conventions:CONVENTIONS};},
  async design_asset(args,{origin}){
    args=defaults(args);
    const reference=name=>`${origin}/agent-reference/${name}`;
    const attach=[...(args.reference_image_path?[args.reference_image_path]:[]),reference('room-style.png'),reference(args.kind==='wall'?'sprite-wall-speaker.png':'sprite-sofa.png')];
    return {prompt:sheetPrompt({...args,hasReference:!!args.reference_image_path}),attach,attach_order:args.reference_image_path?'reference image 1 is the player\'s picture, then the room, then the sprite sample (download the URLs first)':'the room first, then the sprite sample (download the URLs first)',
      output:'One square PNG (1024x1024 or larger) with a transparent background: a 2 by 2 grid of the four views.',
      then:`Save the generated PNG, call upload_url and POST the file to it (curl -s -X POST "<upload_url>" -H "Content-Type: image/png" --data-binary @sheet.png), then call submit_asset with the returned storageId as storage_id, name "${args.name}", kind "${args.kind}", width ${args.width}, depth ${args.depth}.`};
  },
  async upload_url(_,{token}){
    const url=await call('mutation',api.agents.uploadUrl,{agentToken:token});
    return {upload_url:url,valid_for:'about an hour',post_with:`curl -s -X POST "${url}" -H "Content-Type: image/png" --data-binary @sheet.png`,then:'The JSON reply has a storageId: pass it to submit_asset (a 2 by 2 sheet) or add_asset (a finished sprite) as storage_id.'};
  },
  async submit_asset(args,{token}){args=defaults(args);return register(token,args,splitSheet(await loadSource(token,args)));},
  async add_asset(args,{token}){args=defaults({facing:'right',...args});return register(token,args,{[args.facing==='left'?4:2]:await loadSource(token,args)});},
  async my_assets(_,{token}){return (await call('query',api.agents.status,{agentToken:token})).assets;},
  async delete_asset({asset_id},{token}){await call('mutation',api.agents.deleteAsset,{agentToken:token,id:asset_id});return 'Deleted.';},
  async room_map(_,{token}){return call('query',api.agents.map,{agentToken:token});},
  async place({asset_id,...rest},{token}){return call('mutation',api.agents.place,{agentToken:token,assetId:asset_id,...rest});},
  async remove({item_id},{token}){await call('mutation',api.agents.remove,{agentToken:token,itemId:item_id});return 'Removed.';},
};

// JSON-RPC over one POST: a single message or a batch; notifications get no reply.
const reply=(id,result)=>({jsonrpc:'2.0',id,result});
const rpcError=(id,code,text)=>({jsonrpc:'2.0',id,error:{code,message:text}});
async function handle(m,context){
  if(!m||typeof m!=='object'||m.jsonrpc!=='2.0'||typeof m.method!=='string')return rpcError(m?.id??null,-32600,'Invalid request');
  if(!('id' in m)||m.id===null)return null;
  const {id,method,params={}}=m;
  switch(method){
    case 'initialize':return reply(id,{protocolVersion:PROTOCOLS.includes(params.protocolVersion)?params.protocolVersion:PROTOCOLS.at(-1),capabilities:{tools:{}},serverInfo:SERVER,instructions:INSTRUCTIONS});
    case 'ping':return reply(id,{});
    case 'tools/list':return reply(id,{tools:TOOLS});
    case 'tools/call':{
      const tool=HANDLERS[params.name];
      if(!tool)return rpcError(id,-32602,`Unknown tool: ${params.name}`);
      try{
        if(!context.token)throw new Error(NO_KEY);
        const value=await tool(params.arguments??{},context);
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
