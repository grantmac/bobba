import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {splitStrip,prepareAsset} from '../shared/sprite-build.js';
// A three-frame strip of a lamp whose glow grows: the frames share one box so the lamp never jumps.
function strip(frames,cell=64){
  const image=new Jimp({width:cell*frames,height:cell,color:0x00000000});
  for(let f=0;f<frames;f++){
    for(let y=20;y<60;y++)for(let x=f*cell+28;x<f*cell+36;x++)image.setPixelColor(0x444444ff,x,y);
    for(let y=8;y<20;y++)for(let x=f*cell+24-f*4;x<f*cell+40+f*4;x++)image.setPixelColor(0xffdd55ff,x,y);
  }
  return image;
}
test('a strip splits into equal frames cut to one shared box',async()=>{
  const cells=splitStrip(strip(3),3);
  assert.equal(cells.length,3);
  assert.ok(cells.every(c=>c.width===cells[0].width&&c.height===cells[0].height));
  assert.deepEqual([cells[0].width,cells[0].height],[32,52]);
  assert.throws(()=>splitStrip(strip(2),5),/2 to 4/);
});
test('an animated piece packs its frames into one sheet with cells, a frame time and a switch',async()=>{
  const uploads=[],upload=async buffer=>{uploads.push(buffer);return `id${uploads.length}`;};
  const {spec,summary}=await prepareAsset({name:'Lamp',kind:'lamp',width:1,depth:1,frames:3,frame_ms:400,switchable:true},{2:splitStrip(strip(3),3)},upload);
  assert.equal(uploads.length,1);
  const sheet=await Jimp.read(uploads[0]);
  assert.equal(spec.parts.length,1);assert.equal(spec.parts[0].frames.length,3);
  assert.equal(sheet.width,spec.parts[0].frames.reduce((w,c)=>w+c.width,0));
  assert.deepEqual([spec.frameDuration,spec.switchable],[400,true]);
  assert.deepEqual(spec.views.map(v=>v.direction),[2,4]);
  assert.deepEqual(summary({id:'a',type:'asset_a'}).frames,3);
  await assert.rejects(prepareAsset({name:'Lamp',kind:'lamp',width:1,depth:1,switchable:true},{2:strip(1)},upload),/animated/);
});
