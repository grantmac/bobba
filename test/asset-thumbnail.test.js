import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import {assetThumbnail} from '../shared/asset-thumbnail.js';
test('thumbnails crop the first animation frame and preserve foregrounds and transparency',async()=>{
  const sheet=new Jimp({width:400,height:200,color:0});
  sheet.scan((x,y)=>{if(x>=200)sheet.setPixelColor(0x00ff00ff,x,y);else if(x>10&&y>10)sheet.setPixelColor(0xff0000ff,x,y);});
  const front=new Jimp({width:400,height:200,color:0});front.setPixelColor(0x0000ffff,100,100);
  // Small crop lets us verify compositing without resampling the test pixel.
  const icon=await decodeImage(await assetThumbnail(sheet,{frame:{x:90,y:90,width:20,height:20},foreground:front}));
  assert.equal(icon.getPixelColor(10,10),0x0000ffff);assert.equal(icon.getPixelColor(1,1),0xff0000ff);
  const thumbnail=await decodeImage(await assetThumbnail(sheet,{frame:{x:0,y:0,width:200,height:200}}));
  assert.equal(thumbnail.width,72);assert.equal(thumbnail.height,72);assert.equal(thumbnail.getPixelColor(0,0),0);
  assert.equal(thumbnail.getPixelColor(50,50),0xff0000ff);
  assert.equal(sheet.width,400); // The room sprite was not resized.
});
