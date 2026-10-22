import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {encodePng} from '../shared/png.js';

test('smaller PNG encoding preserves every colour and alpha value',async()=>{
  const image=new Jimp({width:192,height:96,color:0});
  image.scan((x,y,i)=>image.bitmap.data.set([x,Math.floor(y/8)*16,(x+y)%256,(x*7+y)%256],i));
  const original=await image.getBuffer('image/png'),encoded=await encodePng(image),decoded=await Jimp.read(encoded);
  assert.ok(encoded.length<=original.length);
  assert.equal(decoded.width,image.width);assert.equal(decoded.height,image.height);
  assert.deepEqual(decoded.bitmap.data,image.bitmap.data);
});

test('keeps the original encoding when the alternate is larger',async()=>{
  const original=Buffer.from('small'),alternate=Buffer.from('larger version');
  assert.equal(await encodePng({getBuffer:async(_mime,options)=>options?alternate:original}),original);
});
