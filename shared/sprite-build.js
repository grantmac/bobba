// Turns a picture (or a 2x2 sheet of four rotations) into the sprites and placement
// metadata of a catalogue piece. Shared by the local stdio server and the hosted endpoint.
import {Jimp,ResizeStrategy} from 'jimp';
import {DENSITY,KINDS} from './sprite-conventions.js';
export async function readImage(buffer){
  if(buffer.length>12*1024*1024)throw new Error('Image is over 12 MB.');
  const image=await Jimp.read(buffer);
  if(image.width>4096||image.height>4096)throw new Error('Image is over 4096 px on a side.');
  return image;
}
export function keyOutBackground(image){
  // Without transparency, treat the corner colour as background.
  const data=image.bitmap.data;
  let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]<40)transparent++;
  if(transparent>0)return;
  const corners=[0,(image.width-1)*4,(image.height-1)*image.width*4,((image.height-1)*image.width+image.width-1)*4].map(i=>[data[i],data[i+1],data[i+2]]);
  const [r,g,b]=corners[0];
  for(let i=0;i<data.length;i+=4){
    const d=Math.abs(data[i]-r)+Math.abs(data[i+1]-g)+Math.abs(data[i+2]-b);
    if(d<60)data[i+3]=0;else if(d<110)data[i+3]=Math.round(255*(d-60)/50);
  }
}
export function trim(image){
  let minX=image.width,minY=image.height,maxX=-1,maxY=-1;
  image.scan(0,0,image.width,image.height,(x,y,idx)=>{if(image.bitmap.data[idx+3]>40){if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y;}});
  if(maxX<0)throw new Error('The picture is fully transparent.');
  image.crop({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
}
// A piece's declared width is the length of its front and depth how far it reaches back;
// the room swaps the two for rotations 2 and 6, so the on-screen footprint depends on the view.
const footprintFor=(direction,width,depth)=>direction%4===2?{width:depth,depth:width}:{width,depth};
// Split a 2x2 sheet into the four rotations: top-left faces lower-right (2), top-right
// lower-left (4), bottom-left upper-left (6), bottom-right upper-right (0).
export function splitSheet(sheet){
  keyOutBackground(sheet);
  const w=Math.floor(sheet.width/2),h=Math.floor(sheet.height/2),views={};
  for(const [direction,x,y] of [[2,0,0],[4,w,0],[6,0,h],[0,w,h]]){
    const view=sheet.clone().crop({x,y,w,h});
    try{trim(view);}catch{throw new Error('The sheet must hold four views in a 2 by 2 grid, one per quadrant, on a transparent background.');}
    views[direction]=view;
  }
  return views;
}
// An animated piece is one view drawn as a strip of 2 to 4 equal frames side by side. The frames
// are cut to one shared bounding box so the piece never jumps between them.
export const FRAME_MAX=4;
export function splitStrip(image,frames){
  if(!Number.isInteger(frames)||frames<2||frames>FRAME_MAX)throw new Error(`frames must be 2 to ${FRAME_MAX}.`);
  keyOutBackground(image);
  const w=Math.floor(image.width/frames),h=image.height;
  const cells=Array.from({length:frames},(_,i)=>image.clone().crop({x:i*w,y:0,w,h}));
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(const cell of cells)cell.scan(0,0,w,h,(x,y,idx)=>{if(cell.bitmap.data[idx+3]>40){if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y;}});
  if(maxX<0)throw new Error('The strip is fully transparent.');
  return cells.map(cell=>cell.crop({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}));
}
export function buildSprite(image,{kind,width,depth,display_width,facing,base_inset,direction,prepared=false}){
  if(!prepared){keyOutBackground(image);trim(image);}
  ({width,depth}=footprintFor(direction??(facing==='left'?4:2),width,depth));
  const span=(width+depth)*32;
  let W=display_width??(kind==='rug'?span:kind==='wall'?48:kind==='tabletop'?40:Math.round(span*.85));
  W=Math.max(8,Math.min(200,Math.round(W)));
  let H=Math.max(4,Math.min(200,Math.round(W*image.height/image.width)));
  // A wall piece must fit on the 117 px wall face with room to hang it: cap its height, keeping its shape.
  if(kind==='wall'&&H>96){W=Math.max(8,Math.round(W*96/H));H=96;}
  image.resize({w:W*DENSITY,h:H*DENSITY,mode:ResizeStrategy.BICUBIC});
  const inset=base_inset??(kind==='rug'?0:2);
  // Registration: the sprite's top-left is (-reg.x-32, -reg.y+16) from the tile's top corner,
  // so these centre the art on the footprint and rest its base on the footprint's near edge.
  const reg=kind==='wall'?{x:W/2-32,y:H}:{x:W/2-32-(width-depth)*16,y:H+16-(width+depth)*16+inset};
  const source=direction??(facing==='left'?4:2),other=source===2?4:2;
  const views=direction!==undefined?[{direction,source:direction,mirror:false}]:[{direction:source,source,mirror:false},{direction:other,source,mirror:true}].sort((a,b)=>a.direction-b.direction);
  const category=KINDS[kind];
  return {width:W,height:H,reg,views,category,
    ...(kind==='wall'?{wallWidth:W}:{}),...(kind==='tabletop'?{tableOffsetY:-2}:{}),...(kind==='table'?{surfaceHeight:Math.max(8,Math.min(64,H-(width+depth)*16+inset))}:{})};
}
// Prepare the sprites of a piece: `views` maps direction to a Jimp image, `upload(pngBuffer)`
// stores one and returns its storage id. Gives the createAsset arguments (minus the agent
// token) and a function that turns the mutation's result into the agent's summary.
// The seat settings an agent gives, in the shape the server stores.
export const seatSpec=args=>({x:args.seat_x??0,z:args.seat_z??0,height:args.seat_height??10,...(args.seat_offset_x?{offsetX:args.seat_offset_x}:{}),...(args.seat_offset_y?{offsetY:args.seat_offset_y}:{})});
export async function prepareAsset(args,views,upload){
  const parts=[],viewList=[];let meta=null,icon=null;
  for(const direction of Object.keys(views).map(Number).sort((a,b)=>a-b)){
    const source=views[direction],single=Object.keys(views).length===1,strip=Array.isArray(source)?source:null,image=strip?strip[0]:source;
    const sprite=buildSprite(image,{...args,...(single?{}:{direction}),prepared:!!strip});
    let buffer,cells;
    if(strip){
      // Every frame is scaled like the first and packed side by side; the client plays the cells in turn.
      const W=sprite.width*DENSITY,H=sprite.height*DENSITY,sheet=new Jimp({width:W*strip.length,height:H,color:0x00000000});
      strip.forEach((frame,i)=>{if(i>0)frame.resize({w:W,h:H,mode:ResizeStrategy.BICUBIC});sheet.composite(frame,i*W,0);});
      buffer=await sheet.getBuffer('image/png');cells=strip.map((_,i)=>({x:i*W,y:0,width:W,height:H}));
    }else buffer=await image.getBuffer('image/png');
    const storageId=await upload(buffer);
    parts.push({storageId,direction:single?sprite.views.find(v=>!v.mirror).source:direction,width:sprite.width,height:sprite.height,reg:sprite.reg,...(cells?{frames:cells}:{})});
    viewList.push(...sprite.views);
    if(direction===2||!icon){icon=storageId;meta=sprite;}
  }
  // A seat may name the tile sat on and the seat top's height; anything else must not.
  const seatGiven=['seat_x','seat_z','seat_height','seat_offset_x','seat_offset_y'].some(key=>args[key]!==undefined);
  if(seatGiven&&args.kind!=='seat')throw new Error('seat_x, seat_z, seat_height and seat offsets apply to kind "seat" only.');
  const animated=Object.values(views).some(Array.isArray);
  if(args.switchable&&!animated)throw new Error('Only an animated piece (frames) can be switchable.');
  const spec={name:args.name,category:meta.category,width:args.width,depth:args.depth,spriteDensity:DENSITY,...(seatGiven?{seat:seatSpec(args)}:{}),...(animated?{frameDuration:args.frame_ms??250,...(args.switchable?{switchable:true}:{})}:{}),
    ...(meta.wallWidth!==undefined?{wallWidth:meta.wallWidth}:{}),...(meta.tableOffsetY!==undefined?{tableOffsetY:meta.tableOffsetY}:{}),...(meta.surfaceHeight!==undefined?{surfaceHeight:meta.surfaceHeight}:{}),
    icon,parts,views:viewList.sort((a,b)=>a.direction-b.direction)};
  const summary=result=>({asset_id:result.id,type:result.type,name:args.name,category:meta.category,rotations:viewList.length,...(animated?{frames:Object.values(views).find(Array.isArray).length,frame_ms:spec.frameDuration,switchable:!!spec.switchable}:{}),display_size:`${meta.width}x${meta.height} px`,footprint:`${args.width}x${args.depth}`,next:'Call place with this asset_id and a free tile from room_map, or the player can place it from Furniture (Rotate turns it).'});
  return {spec,summary};
}
