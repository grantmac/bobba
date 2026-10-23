// Full room UI with a local multiplayer fixture: no live room joins or mutations.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5189';
// Expose the rendered transform only in this intercepted test module.
const mainSource=await (await fetch(origin+'/src/main.js')).text();
const cameraProbe='\nwindow.__terraceView=()=>{zoom=.5;panX=-320;panY=-90;resize();};window.__terraceCentre=(x,z)=>{Object.assign(position,{x,z});centreViewOnAvatar(true);};\nwindow.__testCamera=()=>({scale:displayScale,x:view.left+view.halfW+viewOffsetX,y:view.top+view.halfH+viewOffsetY});';
const mock=`
import {roomLayout} from '/shared/room-layout.js';
import {shapes} from '/convex/lib/catalog.js';
export {samplePlayer} from '/src/multiplayer.js?fixture-original';
export function createMultiplayer(){
  const me={id:'visitor',name:'Visitor',role:'admin',zone:'main',route:[{x:3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,
    look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
  let spaces=Array.from({length:6},(_,i)=>({id:'space-'+i,name:i===5?'Moon garden':'Space '+(i+1),level:[0,0,1,1,-1,-1][i],owner:'visitor',ownerName:'Builder '+(i+1),width:8,depth:8,floor:'wood',floorColor:'#f7de9c'}));
  const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:[]};
  room.furniture=[{id:'upper-chair',type:'small_chair_armas',rotation:0,x:11,z:-10},{id:'lower-chair',type:'small_chair_armas',rotation:0,x:35,z:14}];
  let handlers;const noop=()=>{};
  const network={me,now:()=>Date.now(),zones:[],population:{people:1},identity:{},pairing:{code:''},bot:{},
    loadPreview:async()=>({room,players:[]}),resume:async()=>me,
    assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},
    whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{},
    setZones(ids){network.zones=ids;},
    watch(value){handlers=value;value.onMap(room);value.onSignals({danceFloorOn:true});value.onFurniture({zones:new Map([['main',room.furniture]]),inventory:[]});value.onState({me,players:[],messages:[]});},
    async setSpaceLevel(spaceId,level){if(window.__levelError)throw Error(window.__levelError);spaces=spaces.map(s=>s.id===spaceId?{...s,level}:s);room.spaces=spaces;handlers.onMap(room);},
    async teleport(spaceId){
      window.__teleportCalls=(window.__teleportCalls??0)+1;
      await new Promise(resolve=>setTimeout(resolve,100));
      if(window.__teleportError)throw new Error(window.__teleportError);
      const i=spaces.findIndex(s=>s.id===spaceId);
      const arrival={route:[spaceId==='main'?{x:3.5,z:4.5}:{x:roomLayout(shapes.square,spaces).spaces[i].x+3.5,z:roomLayout(shapes.square,spaces).spaces[i].z+3.5}],startedAt:Date.now(),direction:2,seatId:null,zone:spaceId,action:null};
      Object.assign(me,arrival);handlers.onState({me,players:[],messages:[]});return arrival;
    },
  };
  window.__renameSpace=()=>{spaces=spaces.map((s,i)=>i===5?{...s,name:'Renamed garden'}:s);room.spaces=spaces;handlers.onMap(room);};
  return network;
}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage(),errors=[];
    await page.setViewport({width:mobile?390:1600,height:mobile?844:1100,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
    page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(new URL(request.url()).pathname==='/src/main.js')return request.respond({contentType:'text/javascript',body:mainSource+cameraProbe});
      if(new URL(request.url()).pathname==='/src/multiplayer.js'&&!request.url().includes('fixture-original'))return request.respond({contentType:'text/javascript',body:mock});
      if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))return request.abort();
      return request.continue();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!document.body.hasAttribute('data-loading')&&window.__room,{timeout:45000});
    if(!mobile){await page.evaluate(()=>window.__terraceView());await page.screenshot({path:'/tmp/terraces-overview.png'});}
    for(const id of ['space-2','space-4']){
      if(mobile)await page.click('.toolbar-menu-toggle');await page.click('.spaces-toggle');
      await page.click(`[data-space-id="${id}"]`);
      await page.waitForFunction(id=>!document.querySelector('.spaces-dialog').open&&window.__room.zones.drawn.includes(id),{},id);
      await page.waitForFunction(id=>window.__room.visuals.some(v=>v.id===(id==='space-2'?'upper-':'lower-')),{},id);
      const cell=await page.evaluate(id=>{const s=window.__room.layout.spaces.find(s=>s.id===id);return {x:s.x+3.5,z:s.z+3.5};},id);
      assert.deepEqual(await page.evaluate(()=>({x:window.__room.avatar.x,z:window.__room.avatar.z})),cell);
    }
    await page.waitForFunction(()=>window.__room.visuals.some(v=>v.id==='lower-'));
    if(mobile)await page.click('.toolbar-menu-toggle');await page.click('.spaces-toggle');
    await page.select('[data-level-space="space-4"]','1');
    await page.waitForFunction(()=>document.querySelector('.spaces-status').textContent.includes('is on the upper'));
    assert.equal(await page.evaluate(()=>window.__room.layout.spaces.find(s=>s.id==='space-4').level),1);
    await page.evaluate(()=>window.__levelError='Could not move the room.');
    await page.select('[data-level-space="space-4"]','-1');
    await page.waitForFunction(()=>document.querySelector('.spaces-status').textContent==='Could not move the room.');
    assert.equal(await page.$eval('[data-level-space="space-4"]',el=>el.value),'1');
    await page.screenshot({path:mobile?'/tmp/terraces-mobile-controls.png':'/tmp/terraces-controls.png'});
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: tier rendering, desktop/mobile teleport, level selector, saved level and failed-change recovery.');
}finally{await browser.close();}
