import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {prepareWearable} from '../shared/wearable-build.js';
import {wearableCell,wearableSize,WEARABLE_POSES,WEARABLE_DIRECTIONS} from '../shared/wearables.js';
import {wearableHandlers} from '../server/wearables-mcp.js';
import {decodeImage} from '../shared/image-codec.js';
test('wearable processing preserves transparent cell alignment at native scale',async()=>{
  const source=new Jimp({width:1536,height:224,color:0});
  for(let col=0;col<8;col++)source.setPixelColor(col===1?0x00ff00ff:0xff0000ff,col*192+100,60);
  const buffer=await prepareWearable(source,'headwear');
  assert.equal(buffer.toString('ascii',8,12),'WEBP');
  const image=await decodeImage(buffer);
  assert.deepEqual({width:image.width,height:image.height},wearableSize('headwear'));
  assert.equal(image.getPixelColor(50,30),0xff0000ff);assert.equal(image.getPixelColor(146,30),0x00ff00ff);assert.equal(image.getPixelColor(0,0),0);
});
test('bad shape, blank and opaque wearable sheets fail before upload',async()=>{
  await assert.rejects(prepareWearable(new Jimp({width:768,height:113,color:0}),'headwear'),/768/);
  await assert.rejects(prepareWearable(new Jimp({width:768,height:112,color:0}),'headwear'),/visible/);
  await assert.rejects(prepareWearable(new Jimp({width:768,height:112,color:0xffffffff}),'headwear'),/transparent/);
});
test('jackets select walking, sitting and waving poses; hats turn with the head',()=>{
  assert.equal(wearableCell('jacket',4,2).y,3*112);
  assert.equal(wearableCell('jacket',6,-1,true).y,5*112);
  assert.equal(wearableCell('jacket',0,-1,false,'wave',1).y,7*112);
  assert.deepEqual(wearableCell('headwear',3,3),{x:288,y:0,width:96,height:112});
});

test('every authored direction, action and carry cell is selected exactly',()=>{
  for(const [row,pose] of WEARABLE_POSES.entries())for(const direction of WEARABLE_DIRECTIONS){
    assert.deepEqual(wearableCell('jacket',direction,pose.frame,pose.sitting,pose.action,pose.actionFrame??0,pose.carry),{x:direction*96,y:row*112,width:96,height:112});
  }
});
test('missing angles or poses cannot be published',async()=>{
  const image=new Jimp({...wearableSize('jacket'),color:0});image.setPixelColor(0xff0000ff,40,30);
  await assert.rejects(prepareWearable(image,'jacket'),/Cell 2, row 1/);
});
test('submission cleans the source after saving and cleans a failed processed upload',async()=>{
  for(const fail of [false,true]){
    const source=new Jimp({...wearableSize('headwear'),color:0});
    for(let col=0;col<8;col++)source.setPixelColor(0xff0000ff,col*96+40,30);
    const removed=[];
    const handlers=wearableHandlers({api:{wearables:{create:'save'},agents:{discardUpload:'discard'}},loadSource:async()=>source,uploader:()=>async()=>'processed',
      call:async(kind,fn,args)=>{if(fn==='save'){if(fail)throw new Error('Save failed');return {id:'hat'};}removed.push(args.storageId);}
    });
    const submission=handlers.submit_wearable({slot:'headwear',name:'Hat',storage_id:'source'},{token:'key'});
    if(fail){await assert.rejects(submission,/Save failed/);assert.deepEqual(removed,['processed']);}
    else{assert.deepEqual(await submission,{id:'hat'});assert.deepEqual(removed,['source']);}
  }
});
