import sharp from 'sharp';
import {Jimp} from 'jimp';

// Exact also preserves RGB underneath fully transparent pixels. Keep sprite
// dimensions, frame rectangles and alpha untouched when changing the format.
export async function encodeWebp(image){
  const {data,width,height}=image.bitmap;
  return sharp(data,{raw:{width,height,channels:4}})
    .webp({lossless:true,quality:75,effort:4,exact:true}).toBuffer();
}

export async function decodeImage(buffer){
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP')return Jimp.read(buffer);
  const {data,info}=await sharp(buffer,{limitInputPixels:4096*4096}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return new Jimp({data,width:info.width,height:info.height});
}
