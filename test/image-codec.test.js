import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import sharp from 'sharp';
import {encodeWebp,decodeImage} from '../shared/image-codec.js';

test('lossless WebP preserves dimensions and every RGBA value, including hidden colours',async()=>{
  const image=new Jimp({width:192,height:96,color:0});
  image.scan((x,y,i)=>image.bitmap.data.set([x,y,(x+y)%256,y%3?(x*7+y)%256:0],i));
  const encoded=await encodeWebp(image);
  assert.equal((await sharp(encoded).metadata()).format,'webp');
  const {data,info}=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],[image.width,image.height]);
  assert.deepEqual(data,image.bitmap.data);
  assert.deepEqual((await decodeImage(encoded)).bitmap.data,image.bitmap.data);
});

test('accepts existing PNG input and rejects malformed images',async()=>{
  const image=new Jimp({width:4,height:3,color:0x12345678});
  assert.deepEqual((await decodeImage(await image.getBuffer('image/png'))).bitmap.data,image.bitmap.data);
  await assert.rejects(decodeImage(Buffer.from('not an image')));
});
