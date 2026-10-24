import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import {prepareSurface,surfaceSize} from '../shared/surface-build.js';
// A smooth photo-like gradient with soft alpha: everything the room's pixel art is not.
function photo(width,height){
  const image=new Jimp({width,height,color:0x00000000});
  image.scan((x,y,i)=>{image.bitmap.data[i]=Math.round(255*x/width);image.bitmap.data[i+1]=Math.round(255*y/height);image.bitmap.data[i+2]=128;image.bitmap.data[i+3]=x<width/4?Math.round(255*4*x/width):255;});
  return image;
}
const colours=image=>{const seen=new Set();image.scan((x,y,i)=>{if(image.bitmap.data[i+3])seen.add(image.bitmap.data.slice(i,i+3).join(','));});return seen.size;};
test('every picture comes out at game scale, with a small palette and hard alpha',async()=>{
  for(const [surface,fit,w,h] of [['floor','tile',64,64],['floor','cover',512,512],['wall','tile',32,117],['wall','cover',256,117]]){
    assert.deepEqual(surfaceSize(surface,fit),{w,h});
    const {buffer,width,height}=await prepareSurface(photo(1024,768),{surface,fit});
    assert.deepEqual([width,height],[w,h]);
    const out=await decodeImage(buffer);
    assert.deepEqual([out.width,out.height],[w,h]);
    assert.ok(colours(out)<=32,`${surface} ${fit} kept ${colours(out)} colours`);
    let soft=0;out.scan((x,y,i)=>{const a=out.bitmap.data[i+3];if(a!==0&&a!==255)soft++;});
    assert.equal(soft,0);
  }
});
test('art already drawn at game scale keeps its pixels whole',async()=>{
  const tiny=new Jimp({width:16,height:16,color:0xff0000ff});
  tiny.scan((x,y,i)=>{if((x+y)%2)tiny.bitmap.data.set([0,0,255,255],i);});
  const out=await decodeImage((await prepareSurface(tiny,{surface:'floor',fit:'tile'})).buffer);
  assert.equal(colours(out),2);
  // Nearest-neighbour enlargement: each source pixel becomes a solid 4 by 4 block.
  assert.deepEqual([...out.bitmap.data.slice(0,4)],[255,0,0,255]);assert.deepEqual([...out.bitmap.data.slice(3*4,3*4+4)],[255,0,0,255]);assert.deepEqual([...out.bitmap.data.slice(4*4,4*4+4)],[0,0,255,255]);
});
