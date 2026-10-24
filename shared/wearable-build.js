import {encodeWebp} from './image-codec.js';
import {wearableSize} from './wearables.js';
export async function prepareWearable(image,slot){
  if(!['headwear','jacket'].includes(slot))throw new Error('Choose headwear or jacket.');
  const {width,height}=wearableSize(slot),scale=image.bitmap.width/width;
  if(!Number.isInteger(scale)||scale<1||image.bitmap.height!==height*scale)throw new Error(`The ${slot} sheet must be ${width} × ${height} pixels, or an exact integer multiple. Keep every cell aligned.`);
  const {ResizeStrategy}=await import('jimp');
  const output=image.clone().resize({w:width,h:height,mode:ResizeStrategy.NEAREST_NEIGHBOR});
  for(let row=0;row<height/112;row++)for(let col=0;col<width/96;col++){
    let transparent=false,visible=false;
    for(let y=row*112;y<(row+1)*112;y++)for(let x=col*96;x<(col+1)*96;x++){
      const alpha=output.bitmap.data[(y*width+x)*4+3];transparent||=alpha===0;visible||=alpha>0;
    }
    if(!transparent||!visible)throw new Error(`Cell ${col+1}, row ${row+1} needs visible artwork on a transparent background. Include every angle and pose.`);
  }
  return encodeWebp(output);
}
