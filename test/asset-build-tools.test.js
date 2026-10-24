import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import {splitSheet,splitStrip,prepareAsset} from '../shared/sprite-build.js';
import {seatSpots,seatReport,designBrief} from '../shared/asset-geometry.js';
import {seatFor} from '../shared/furniture-model.js';
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
test('per-view seat corrections replace shared nudges and agree with the game and preview coordinates',()=>{
  const asset={category:'Seating',width:2,depth:1,seat:{x:0,z:1,height:20,offsetX:3,offsetY:2,offsets:[{rotation:6,x:7,y:-5},{rotation:4,x:0,y:0}]},views:[2,4,6,0].map(direction=>({direction}))};
  const seats=seatSpots(asset),report=seatReport(asset);
  assert.deepEqual(Object.fromEntries(Object.entries(seats).map(([r,s])=>[r,s.offset])),{2:[3,8],4:[0,6],6:[7,1],0:[3,8]});
  assert.deepEqual(report.rotations.find(r=>r.direction===6).seats[0],{tile:[0,0],surface:{x:7,y:-9},avatar_anchor:{x:7,y:17}});
  for(const {direction,seats:positions} of report.rotations){
    const live=seatFor({x:0,z:0,rotation:direction},{...asset,seat:seats});
    const [x,z]=live.cells[0],p={x:(x-z)*32,y:(x+z+1)*16};
    assert.deepEqual(positions[0].avatar_anchor,{x:p.x+live.offsetX,y:p.y+live.offsetY});
    assert.equal(positions[0].surface.y,positions[0].avatar_anchor.y-26);
  }
});
test('seat build validates per-view corrections before uploads and warns about missing occlusion',async()=>{
  let uploads=0;const upload=async()=>{uploads++;return 'upload';};
  for(const seat_offsets of [null,[{rotation:1,x:0,y:0}],[{rotation:6,x:25,y:0}],[{rotation:6,x:0,y:1.5}],[{rotation:6,x:0,y:0},{rotation:6,x:1,y:1}]]){
    await assert.rejects(prepareAsset({...args,seat_offsets},splitSheet(sheet()),upload),/seat.offset|Seat offsets/i);
  }
  await assert.rejects(prepareAsset({...args,seat_offsets:[{rotation:6,x:0,y:0}]},{2:splitStrip(sheet(),2)},upload),/supported/);
  assert.equal(uploads,0);
  const offsets=[{rotation:6,x:7,y:-5}];
  const built=await prepareAsset({...args,seat_offsets:offsets},splitSheet(sheet()),upload);
  assert.deepEqual(built.spec.seat.offsets,offsets);
  assert.deepEqual(built.summary({}).validation.warnings.filter(w=>w.code==='seat_foreground_review').map(w=>w.direction),[0,2,4,6]);
  const emptyMask=new Jimp({width:128,height:128,color:0});
  const defaults=await prepareAsset({name:'Chair',kind:'seat',width:1,depth:1},splitSheet(sheet(),emptyMask),upload);
  assert.ok(defaults.summary({}).validation.warnings.some(w=>w.code==='default_seat_position'));
  assert.equal(defaults.summary({}).validation.warnings.filter(w=>w.code==='seat_foreground_review').length,4);
});
test('foreground mask is aligned through trimming and scaling and metadata describes all views',async()=>{
  const image=sheet(),mask=new Jimp({width:128,height:128,color:0});
  for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let y=45;y<54;y++)for(let x=12;x<52;x++)mask.setPixelColor(0xffffffff,col*64+x,row*64+y);
  const files=[];const {spec,summary}=await prepareAsset(args,splitSheet(image,mask),async b=>{files.push(b);return `file${files.length}`;});
  assert.ok(!summary({}).validation.warnings.some(w=>w.code==='seat_foreground_review'));
  assert.equal(files.length,3);assert.ok(spec.parts.every(p=>p.foregroundStorageId));
  assert.equal(new Set(spec.parts.map(p=>p.storageId)).size,1);
  assert.equal(new Set(spec.parts.map(p=>p.foregroundStorageId)).size,1);
  const icon=await decodeImage(files[2]);assert.ok(icon.width<=72&&icon.height<=72);
  const base=await decodeImage(files[0]),front=await decodeImage(files[1]);
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
