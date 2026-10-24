import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import {buildSprite,splitStrip,prepareAsset} from '../shared/sprite-build.js';
test('height limits scale both sprite axes instead of flattening the isometric projection',()=>{
  for(const [kind,w,h,display_width,expected] of [['floor',100,400,100,[50,200]],['wall',100,600,48,[16,96]],['floor',100,50,100,[100,50]]]){
    const image=new Jimp({width:w,height:h,color:0x446688ff});
    const sprite=buildSprite(image,{kind,width:1,depth:1,display_width,prepared:true});
    assert.deepEqual([sprite.width,sprite.height],expected);
    assert.equal(sprite.width/sprite.height,w/h);
    assert.equal(image.width/image.height,w/h);
  }
  assert.throws(()=>buildSprite(new Jimp({width:100,height:1,color:0x446688ff}),{kind:'floor',width:1,depth:1,display_width:200,prepared:true}),/stretching would distort/);
});
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
  for(const frames of [1,9,2.5])assert.throws(()=>splitStrip(strip(2),frames),/2 to 8/);
});
test('an animated piece packs its frames into one sheet with cells, a frame time and a switch',async()=>{
  const uploads=[],upload=async buffer=>{uploads.push(buffer);return `id${uploads.length}`;};
  const {spec,summary}=await prepareAsset({name:'Lamp',kind:'lamp',width:1,depth:1,frames:3,frame_ms:400,switchable:true},{2:splitStrip(strip(3),3)},upload);
  assert.equal(uploads.length,2);
  const icon=await decodeImage(uploads[1]);
  assert.ok(icon.width<=72&&icon.height<=72);assert.notEqual(spec.icon,spec.parts[0].storageId);
  const sheet=await decodeImage(uploads[0]);
  assert.equal(spec.parts.length,1);assert.equal(spec.parts[0].frames.length,3);
  assert.equal(sheet.width,spec.parts[0].frames.reduce((w,c)=>w+c.width,0));
  assert.deepEqual([spec.frameDuration,spec.switchable],[400,true]);
  assert.deepEqual(spec.views.map(v=>v.direction),[2,4]);
  assert.deepEqual(summary({id:'a',type:'asset_a'}).frames,3);
  await assert.rejects(prepareAsset({name:'Lamp',kind:'lamp',width:1,depth:1,switchable:true},{2:strip(1)},upload),/animated/);
});

test('eight distinct frames survive splitting and packing in order',async()=>{
  const image=new Jimp({width:64*8,height:64,color:0});
  const colors=Array.from({length:8},(_,i)=>((i+1)*0x18000000+0x004488ff)>>>0);
  for(let f=0;f<8;f++)for(let y=16;y<48;y++)for(let x=16;x<48;x++)image.setPixelColor(colors[f],f*64+x,y);
  const cells=splitStrip(image,8);
  assert.equal(cells.length,8);
  const uploads=[];
  const {spec,summary}=await prepareAsset({name:'Eight frames',kind:'lamp',width:1,depth:1,frames:8,frame_ms:100},{2:cells},async buffer=>{uploads.push(buffer);return `id${uploads.length}`;});
  const sheet=await decodeImage(uploads[0]);
  assert.equal(spec.parts[0].frames.length,8);
  for(const [i,cell] of spec.parts[0].frames.entries())assert.equal(sheet.getPixelColor(cell.x+Math.floor(cell.width/2),Math.floor(cell.height/2)),colors[i]);
  assert.equal(spec.frameDuration,100);
  assert.equal(summary({id:'a',type:'asset_a'}).frames,8);
});

test('identical rotations upload once per asset while different pixels and separate assets stay independent',async()=>{
  const uploads=[],upload=async buffer=>{uploads.push(buffer);return `id${uploads.length}`;};
  const build=()=>prepareAsset({name:'Lamp',kind:'lamp',width:2,depth:1},
    {0:strip(1),2:strip(1),4:strip(1),6:strip(1).setPixelColor(0xff0000ff,30,30)},upload);
  const {spec}=await build();
  assert.equal(uploads.length,3); // one shared sprite, one different sprite, one icon
  assert.equal(new Set(spec.parts.slice(0,3).map(p=>p.storageId)).size,1);
  assert.notEqual(spec.parts[3].storageId,spec.parts[0].storageId);
  assert.notDeepEqual(spec.parts[0].reg,spec.parts[1].reg);
  assert.deepEqual(spec.views.map(v=>v.direction),[0,2,4,6]);
  const second=await build();
  assert.equal(uploads.length,6);
  assert.notEqual(second.spec.parts[0].storageId,spec.parts[0].storageId);
});
