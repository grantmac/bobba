// Run against the local Vite server with CHROME_EXECUTABLE_PATH set. No backend writes.
import {readFile,writeFile} from 'node:fs/promises';
import {renderInBrowser} from '../server/render.js';
import {Jimp} from 'jimp';
import {prepareAsset,splitSheet,splitStrip} from '../shared/sprite-build.js';
import {assetCatalogueEntry} from '../convex/lib/assets.js';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5199';
const image=new Jimp({width:128,height:128,color:0}),mask=new Jimp({width:128,height:128,color:0});
for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  for(let y=10;y<55;y++)for(let x=10;x<54;x++)if(y<35||x<15||x>48)image.setPixelColor(0x425f85ff,col*64+x,row*64+y);
  for(let y=30;y<36;y++)for(let x=10;x<54;x++){image.setPixelColor(0xdc9467ff,col*64+x,row*64+y);mask.setPixelColor(0xffffffff,col*64+x,row*64+y);}
}
const {spec}=await prepareAsset({name:'Preview seat',kind:'seat',width:2,depth:1,seat_z:1,seat_height:20},splitSheet(image,mask),async b=>'data:image/png;base64,'+b.toString('base64'));
const asset=await assetCatalogueEntry({storage:{getUrl:async id=>id}},{...spec,_id:'preview',ownerId:'preview'});
const preview=await renderInBrowser(origin,{mode:'asset',asset});await writeFile('/tmp/habbo-asset-preview.png',Buffer.from(preview,'base64'));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true});
try{
  const strip=new Jimp({width:128,height:64,color:0}),stripMask=new Jimp({width:128,height:64,color:0});
  for(let f=0;f<2;f++)for(let y=10;y<55;y++)for(let x=10;x<54;x++){
    strip.setPixelColor(f?0xaa3333ff:0x3333aaff,f*64+x,y);if(y>30)stripMask.setPixelColor(0xffffffff,f*64+x,y);
  }
  const built=await prepareAsset({name:'Animated seat',kind:'seat',width:2,depth:1,seat_z:1,seat_height:20,frames:2,frame_ms:250,switchable:true}, {2:splitStrip(strip,2,stripMask)},async b=>'data:image/png;base64,'+b.toString('base64'));
  const animated=await assetCatalogueEntry({storage:{getUrl:async id=>id}},{...built.spec,_id:'animated',ownerId:'preview'});
  for(const definition of [asset,animated]){
    const page=await browser.newPage();await page.evaluateOnNewDocument(a=>{window.__TEST_ASSET__=a;},definition);
    await page.goto(origin+'/test/foreground-browser.html');await page.waitForFunction(()=>window.__TEST_RESULT__);
    assert.equal(await page.evaluate(()=>window.__TEST_RESULT__),'passed');await page.close();
  }
}finally{await browser.close();}
const catalog=JSON.parse(await readFile(new URL('../public/assets/furniture/catalog.json',import.meta.url)));
const wall=catalog.find(a=>a.category==='Wall'&&a.views.some(v=>v.direction===4));
const spaces=Array.from({length:8},(_,i)=>({id:'s'+i,name:'Space '+i,owner:'preview',ownerName:'Preview',width:16,depth:8,floor:'wood',floorColor:'#b59232'}));
const scene={serverTime:Date.now(),players:[],assets:[asset],room:{options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:[{id:'seat',type:asset.id,x:136,z:2,rotation:2},...(wall?[{id:'wall',type:wall.id,x:137,z:0,rotation:4,u:.5,height:60}]:[])]},region:{x:135,z:0,width:16,depth:8}};
scene.players.push({id:'fixture-player',name:'Preview',role:'guest',route:[{x:136.5,z:3.5}],startedAt:Date.now(),direction:2,seatId:'seat',look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}});
const picture=await renderInBrowser(origin,{mode:'room',scene});await writeFile('/tmp/habbo-room-preview.png',Buffer.from(picture,'base64'));
console.log('Rendered isolated seat and far-space room to /tmp/habbo-asset-preview.png and /tmp/habbo-room-preview.png');
