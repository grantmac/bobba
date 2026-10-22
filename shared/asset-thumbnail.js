import {ResizeStrategy} from 'jimp';
import {encodePng} from './png.js';

// Catalogue icons are 36 CSS pixels. Keep a 2x version, never a whole animation strip.
export async function assetThumbnail(image,{frame,foreground}={}){
  const icon=image.clone();
  const crop=frame?{x:frame.x,y:frame.y,w:frame.width,h:frame.height}:null;
  if(crop)icon.crop(crop);
  if(foreground){const front=foreground.clone();if(crop)front.crop(crop);icon.composite(front,0,0);}
  const scale=Math.min(1,72/Math.max(icon.width,icon.height));
  if(scale<1)icon.resize({w:Math.max(1,Math.round(icon.width*scale)),h:Math.max(1,Math.round(icon.height*scale)),mode:ResizeStrategy.NEAREST_NEIGHBOR});
  return encodePng(icon);
}
