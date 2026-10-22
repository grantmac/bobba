import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {splitSheet,splitStrip,prepareAsset} from '../shared/sprite-build.js';
import {seatReport,designBrief} from '../shared/asset-geometry.js';
const args={name:'Test seat',kind:'seat',width:2,depth:1,seat_x:0,seat_z:1,seat_height:20};
const upload=async()=> 'upload';
function sheet(){const image=new Jimp({width:128,height:128,color:0});for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let y=20;y<54;y++)for(let x=12;x<52;x++)image.setPixelColor(0x446688ff,col*64+x,row*64+y);return image;}
test('seat coordinates rotate asymmetrical footprints and distinguish surface from avatar anchor',()=>{
  const report=seatReport({category:'Seating',width:2,depth:1,seat:{x:0,z:1,height:20,offsetX:3,offsetY:2},views:[2,4,6,0].map(direction=>({direction}))});
  assert.deepEqual(report.rotations.map(r=>r.seats[0].tile),[[0,1],[1,0],[0,0],[0,0]]);
  assert.deepEqual(report.rotations[0].seats[0].surface,{x:-29,y:14});
  assert.deepEqual(report.rotations[0].seats[0].avatar_anchor,{x:-29,y:40});
  assert.equal(designBrief({frames:3}).views.length,2);
});
test('foreground mask is aligned through trimming and scaling and metadata describes all views',async()=>{
  const image=sheet(),mask=new Jimp({width:128,height:128,color:0});
  for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let y=45;y<54;y++)for(let x=12;x<52;x++)mask.setPixelColor(0xffffffff,col*64+x,row*64+y);
  const files=[];const {spec,summary}=await prepareAsset(args,splitSheet(image,mask),async b=>{files.push(b);return `file${files.length}`;});
  assert.equal(files.length,8);assert.ok(spec.parts.every(p=>p.foregroundStorageId));
  const base=await Jimp.read(files[0]),front=await Jimp.read(files[1]);
  assert.equal(front.width,base.width);assert.equal(front.height,base.height);
  assert.equal(front.bitmap.data[3],0);assert.ok(front.bitmap.data.at(-1)>0);
  assert.equal(summary({id:'test'}).views.length,4);
  assert.ok(summary({}).validation.warnings.some(w=>w.code==='possible_background'));
  assert.equal(summary({}).seat.rotations.length,4);
});
test('invalid dimensions, seats and mask sizes fail before publishing; walls expose only usable rotations',async()=>{
  assert.throws(()=>splitSheet(new Jimp({width:127,height:128,color:0xffffffff})),/evenly/);
  assert.throws(()=>splitStrip(new Jimp({width:128,height:32,color:0xffffffff}),3),/evenly/);
  assert.throws(()=>splitSheet(sheet(),new Jimp({width:64,height:64,color:0})),/same dimensions/);
  let uploads=0;await assert.rejects(prepareAsset({...args,seat_z:2},splitSheet(sheet()),async()=>{uploads++;}),/within/);assert.equal(uploads,0);
  const {spec}=await prepareAsset({name:'Wall',kind:'wall',width:1,depth:1,display_width:200},splitSheet(sheet()),upload);
  assert.deepEqual(spec.views.map(v=>v.direction),[2,4]);assert.ok(spec.parts.every(p=>p.width<=96));
});
