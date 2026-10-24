// Exercises the real room and the homepage UI without joining or writing to the live room.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5200';
const source=await (await fetch(origin+'/src/main.js')).text();
const probe=`
window.__homeTest={open:id=>homepage.open(id),inspect:id=>homepage.inspect({id}),centre(){const s=layout.spaces[0],p=groundPoint(s.x+4,s.z+4);panX=-p.x*displayScale;panY=-(p.y-CENTER_Y)*displayScale;resize();},phonePoint(){const p=furniture.debugVisuals().find(v=>v.type==='homepage_telephone');return {x:view.halfW+viewOffsetX+p.meshX*displayScale,y:view.halfH+viewOffsetY-p.meshY*displayScale};}};
`;
const mock=`
import {HOMEPAGE_PIECES,HOMEPAGE_SPACE_ID} from '/shared/homepage.js';
import {roomLayout} from '/shared/room-layout.js';import {shapes} from '/convex/lib/catalog.js';
export {samplePlayer} from '/src/multiplayer.js?fixture-original';
export function createMultiplayer(){
 const noop=()=>{},spaces=[{id:HOMEPAGE_SPACE_ID,name:"Grant's Homepage",owner:'visitor',ownerName:'Grant',level:0,width:8,depth:8,floor:'wood',floorColor:'#c7a16a',wall:'plain',wallColor:'#82917d'}];
 const space=roomLayout(shapes.square,spaces).spaces[0];
 const items=HOMEPAGE_PIECES.map(({id,support,...p})=>({...p,id:'homepage-'+id,x:space.x+p.x,z:space.z+p.z,...(support?{supportId:'homepage-'+support}:{})}));
 const me={id:'visitor',name:'Reader',role:'admin',zone:HOMEPAGE_SPACE_ID,route:[{x:space.x+3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
 const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:items};let notes=[];
 const network={me,now:()=>Date.now(),zones:[],population:{people:1},identity:{},pairing:{code:''},bot:{},loadPreview:async()=>({room,players:[]}),resume:async()=>me,assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{watch:cb=>{cb({serverTime:Date.now(),visits:[]});return noop;}},setZones(ids){network.zones=ids;},
 watch(h){h.onMap(room);h.onSignals({danceFloorOn:false});h.onFurniture({zones:new Map([[HOMEPAGE_SPACE_ID,items]]),inventory:[]});h.onState({me,players:[],messages:[]});},
 homepage:{async notes({kind,completed}){return {canManage:true,hasMore:false,notes:notes.filter(n=>n.kind===kind&&n.status===(completed?'done':'new'))};},async add({kind,body}){notes.unshift({id:String(notes.length),kind,body,name:'Reader',status:'new',createdAt:Date.now()});},async review({id,...args}){Object.assign(notes.find(n=>n.id===id),args);}},
 async move(){window.__unexpectedMove=true;},
 };return network;
}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
 for(const mobile of [false,true]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:mobile?390:1500,height:mobile?844:1000,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
  await page.setRequestInterception(true);page.on('request',request=>{
   if(new URL(request.url()).pathname==='/src/main.js')return request.respond({contentType:'text/javascript',body:source+probe});
   if(new URL(request.url()).pathname==='/src/multiplayer.js'&&!request.url().includes('fixture-original'))return request.respond({contentType:'text/javascript',body:mock});
   if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))return request.abort();
   return request.continue();
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.body.hasAttribute('data-loading')&&window.__room,{timeout:45000});
  await page.evaluate(()=>window.__homeTest.centre());
  assert.equal(await page.evaluate(()=>window.__room.visuals.filter(v=>v.id==='homepa').length>=17),true,'All study pieces render');
  await page.evaluate(()=>window.__homeTest.open('about'));
  assert.equal(await page.$eval('#homepage-title',el=>el.textContent),'Hello. I’m Grant.');
  for(const id of ['now','projects','clippings','music','cycling','contact','oldweb','guestbook','suggestions','scrapbook']){
   await page.$eval('[data-page="'+id+'"]',el=>el.click());
   assert(await page.$eval('#homepage-title',el=>el.textContent.length>0));
   const bounds=await page.$eval('.homepage-window',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
   assert(bounds.x>=0&&bounds.y>=0&&bounds.right<=(mobile?390:1500)&&bounds.bottom<=(mobile?844:1000));
   assert(await page.$eval('.homepage-page',el=>el.scrollWidth<=el.clientWidth+1),'No horizontal overflow');
  }
  await page.$eval('[data-page="guestbook"]',el=>el.click());
  await page.type('.homepage-note-form textarea','<img src=x onerror=alert(1)> hello');await page.click('.homepage-note-form button');
  await page.waitForFunction(()=>document.querySelector('.homepage-notes')?.textContent.includes('hello'));
  assert.equal(await page.$eval('.homepage-notes',el=>el.querySelectorAll('img').length),0,'Visitor input renders as text');
  await page.$eval('[data-page="suggestions"]',el=>el.click());
  await page.type('.homepage-note-form textarea','More plants please');await page.click('.homepage-note-form button');
  await page.waitForSelector('.homepage-review textarea');await page.type('.homepage-review textarea','Added a cactus.');await page.click('.homepage-review button');
  await page.waitForFunction(()=>!document.querySelector('.homepage-review'));
  await page.$eval('[data-page="scrapbook"]',el=>el.click());await page.waitForFunction(()=>document.querySelector('.homepage-response')?.textContent.includes('cactus'));
  await page.$eval('[data-page="projects"]',el=>el.click());
  // Inspect only the new document window, not the room, per the room-check policy.
  await (await page.$('.homepage-window')).screenshot({path:mobile?'/tmp/homepage-panel-mobile.png':'/tmp/homepage-panel-desktop.png'});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.homepage-window').open);
  if(!mobile){
   const p=await page.evaluate(()=>window.__homeTest.phonePoint());await page.mouse.click(p.x,p.y);
   await page.waitForFunction(()=>document.querySelector('.homepage-window').open);
   assert.equal(await page.$eval('#homepage-title',el=>el.textContent),'Pick up the phone.','The placed telephone opens contact');
  }
  assert.deepEqual(errors,[]);await page.close();console.log(mobile?'Mobile homepage passed':'Desktop homepage passed');
 }
}finally{await browser.close();}
