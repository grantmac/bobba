import {encodeWebp} from './image-codec.js';
import {wearableSize} from './wearables.js';
export async function prepareWearable(image,slot,template){
  if(!['headwear','top','jacket'].includes(slot))throw new Error('Choose headwear, top or jacket.');
  const {width,height}=wearableSize(slot),scale=image.bitmap.width/width;
  if(!Number.isInteger(scale)||scale<1||image.bitmap.height!==height*scale)throw new Error(`The ${slot} sheet must be ${width} × ${height} pixels, or an exact integer multiple. Keep every cell aligned.`);
  const {ResizeStrategy}=await import('jimp');
  const output=image.clone().resize({w:width,h:height,mode:ResizeStrategy.NEAREST_NEIGHBOR});
  if(slot==='top'){
    if(!template||template.bitmap.width!==width||template.bitmap.height!==height)throw new Error('Use the fitting template from design_wearable.');
    for(let i=3;i<output.bitmap.data.length;i+=4){
      const alpha=template.bitmap.data[i];
      if(alpha&&output.bitmap.data[i]!==255)throw new Error('Cover every visible pixel of the fitting template with opaque clothing. Preview all poses before saving.');
      // The renderer applies the per-part mask once, including any soft edges.
      output.bitmap.data[i]=alpha?255:0;
    }
  }
  for(let row=0;row<height/112;row++)for(let col=0;col<width/96;col++){
    let transparent=false,visible=false;
    for(let y=row*112;y<(row+1)*112;y++)for(let x=col*96;x<(col+1)*96;x++){
      const alpha=output.bitmap.data[(y*width+x)*4+3];transparent||=alpha===0;visible||=alpha>0;
    }
    if(!transparent||!visible)throw new Error(`Cell ${col+1}, row ${row+1} needs visible artwork on a transparent background. Include every angle and pose.`);
  }
  return encodeWebp(output);
}
