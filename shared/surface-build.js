// Turns an uploaded picture into a floor or wall texture at the room's own pixel scale, so every
// space keeps the game's look whatever was uploaded: a photo or a smooth render comes out as
// flat-coloured pixel art with a small palette and hard edges, like the sprites. Shared by the
// hosted endpoint and the prompts that tell agents what to draw.
import {Jimp,ResizeStrategy} from 'jimp';
import {encodePng} from './png.js';
import {SPACE_SIZE} from './spaces.js';
// Texels per floor tile (a 64 by 32 diamond on screen, seen from above) and per wall segment
// (32 px wide, 117 px tall on screen), and the most colours a picture keeps.
export const FLOOR_TEXELS=64,WALL_SEGMENT={w:32,h:117},SURFACE_COLORS=32;
export function surfaceSize(surface,fit){
  const across=fit==='cover'?SPACE_SIZE:1;
  return surface==='wall'?{w:WALL_SEGMENT.w*across,h:WALL_SEGMENT.h}:{w:FLOOR_TEXELS*across,h:FLOOR_TEXELS*across};
}
export async function prepareSurface(image,{surface,fit}){
  const {w,h}=surfaceSize(surface,fit),out=image.clone();
  // Art already at game scale is only snapped (nearest, so its pixels stay whole); anything bigger
  // is averaged down to size. Then a small palette and hard alpha, so it reads as pixel art.
  if(out.width!==w||out.height!==h)out.resize(out.width<=w&&out.height<=h?{w,h,mode:ResizeStrategy.NEAREST_NEIGHBOR}:{w,h});
  out.quantize({colors:SURFACE_COLORS});
  const data=out.bitmap.data;for(let i=3;i<data.length;i+=4)data[i]=data[i]<128?0:255;
  return {buffer:await encodePng(out),width:w,height:h};
}
