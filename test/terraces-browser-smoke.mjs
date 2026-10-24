// Full room UI with a local multiplayer fixture: no live room joins or mutations.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5189';
// Expose the rendered transform only in this intercepted test module.
const mainSource=await (await fetch(origin+'/src/main.js')).text();
const cameraProbe='\nwindow.__terraceView=()=>{zoom=.5;panX=-320;panY=-90;resize();};window.__viewTile=(x,z,close=false)=>{if(close){zoom=2;resize();}const p=groundPoint(x,z);panX=-p.x*displayScale;panY=-(p.y-CENTER_Y)*displayScale;resize();};\nwindow.__teleportPending=()=>teleporting;window.__testCamera=()=>({scale:displayScale,x:view.left+view.halfW+viewOffsetX,y:view.top+view.halfH+viewOffsetY});';
const mock=`
import {roomLayout} from '/shared/room-layout.js';
import {shapes} from '/convex/lib/catalog.js';
import {samplePlayer} from '/src/multiplayer.js?fixture-original';
import {findPath} from '/convex/lib/rules.js';
export {samplePlayer};
export function createMultiplayer(){
  const me={id:'visitor',name:'Visitor',role:'admin',zone:'main',route:[{x:3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,
    look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
  let spaces=Array.from({length:6},(_,i)=>({id:'space-'+i,name:i===5?'Moon garden':'Space '+(i+1),level:[0,0,1,1,-1,-1][i],owner:'visitor',ownerName:'Builder '+(i+1),width:8,depth:8,floor:'wood',floorColor:'#f7de9c'}));
  const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:[]};
  room.furniture=[{id:'upper-chair',type:'small_chair_armas',rotation:0,x:11,z:-10},{id:'lower-chair',type:'small_chair_armas',rotation:0,x:35,z:14}];
  let handlers,clockOffset=0;const noop=()=>{};
  window.__finishWalk=()=>{clockOffset+=120000;};
  const network={me,now:()=>Date.now()+clockOffset,zones:[],population:{people:1},identity:{},pairing:{code:''},bot:{},
    loadPreview:async()=>({room,players:[]}),resume:async()=>me,
    assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},
    whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{},
    setZones(ids){network.zones=ids;},
    watch(value){handlers=value;value.onMap(room);value.onSignals({danceFloorOn:true});value.onFurniture({zones:new Map([['main',room.furniture]]),inventory:[]});value.onState({me,players:[],messages:[]});},
    async move(x,z){
      const current=samplePlayer(me,network.now());
      const route=findPath(room,{x:current.x,z:current.z},{x,z});
      if(!route)throw Error('No route');
      window.__walkRoutes=(window.__walkRoutes??[]).concat([route]);
      Object.assign(me,{route,startedAt:network.now(),seatId:null});
      handlers.onState({me:{...me},players:[],messages:[]});
    },
    async teleport(spaceId){
      window.__teleportCalls=(window.__teleportCalls??0)+1;
      await new Promise(resolve=>setTimeout(resolve,100));
      if(window.__teleportError)throw new Error(window.__teleportError);
      const i=spaces.findIndex(s=>s.id===spaceId);
      const arrival={route:[spaceId==='main'?{x:3.5,z:4.5}:{x:roomLayout(shapes.square,spaces).spaces[i].x+3.5,z:roomLayout(shapes.square,spaces).spaces[i].z+3.5}],startedAt:network.now(),direction:2,seatId:null,zone:spaceId,action:null};
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
      await page.waitForFunction(cell=>!window.__teleportPending()&&window.__room.avatar.x===cell.x&&window.__room.avatar.z===cell.z,{},cell);
      assert.deepEqual(await page.evaluate(()=>({x:window.__room.avatar.x,z:window.__room.avatar.z})),cell);
    }
    await page.waitForFunction(()=>window.__room.visuals.some(v=>v.id==='lower-'));
    if(mobile)await page.click('.toolbar-menu-toggle');await page.click('.spaces-toggle');
    assert.equal(await page.$$eval('[data-level-space]',els=>els.length),0);
    await page.screenshot({path:mobile?'/tmp/terraces-mobile-list.png':'/tmp/terraces-list.png'});
    assert.equal(await page.$$eval('[data-space-id]',els=>els.length),7);
    assert.equal(await page.$$eval('.spaces-dialog select',els=>els.length),0);
    assert.match(await page.$eval('[data-space-id="space-4"] span',el=>el.textContent),/Located on the lower level/);
    await page.click('.spaces-dialog .appearance-close');
    const fixed=await page.evaluate(()=>window.__room.layout.spaces.map(s=>[s.id,s.x,s.z,s.level]));
    for(const [count,id] of ['space-2','space-4'].entries()){
      const cell=await page.evaluate(id=>{const s=window.__room.layout.spaces.find(s=>s.id===id);return {x:s.x+5,z:s.z+6};},id);
      await page.evaluate(cell=>window.__viewTile(cell.x+.5,cell.z+.5),cell);
      const screen=await page.evaluate(cell=>{const p=window.__room.groundPoint(cell.x+.5,cell.z+.5),c=window.__testCamera();return {x:c.x+p.x*c.scale,y:c.y+(p.y-window.__room.centerY)*c.scale};},cell);
      await page.mouse.click(screen.x,screen.y);
      assert.equal(await page.$eval('.dance-floor-controls',panel=>panel.hidden),true,'Room tiles must not open the lobby dance floor controls');
      await page.waitForFunction(count=>window.__walkRoutes?.length===count+1,{},count);
      const route=await page.evaluate(()=>window.__walkRoutes.at(-1));
      assert.deepEqual(route.at(-1),{x:cell.x+.5,z:cell.z+.5});
      assert.equal(await page.evaluate(()=>{const layout=window.__room.layout;return layout.stairs.every(s=>window.__walkRoutes.at(-1).some(p=>p.x>=s.x&&p.x<s.x+s.width&&p.z>=s.z&&p.z<s.z+s.depth));}),true);
      await page.waitForFunction(route=>Math.hypot(window.__room.avatar.x-route[0].x,window.__room.avatar.z-route[0].z)>.1,{},route);
      await page.evaluate(()=>window.__finishWalk());
      await page.waitForFunction(cell=>Math.hypot(window.__room.avatar.x-cell.x-.5,window.__room.avatar.z-cell.z-.5)<.01,{},cell);
    }
    assert.deepEqual(await page.evaluate(()=>window.__room.layout.spaces.map(s=>[s.id,s.x,s.z,s.level])),fixed);
    // The lobby dance floor still opens its controls; a lower walkway dismisses them.
    for(const dance of [true,false]){
      const cell=await page.evaluate(dance=>{const l=window.__room.layout;return dance?{x:2,z:l.danceStart+2}:{x:l.walkways.find(w=>w.level===-1).x+2,z:l.walkways.find(w=>w.level===-1).z};},dance);
      await page.evaluate(cell=>window.__viewTile(cell.x+.5,cell.z+.5),cell);
      const screen=await page.evaluate(cell=>{const p=window.__room.groundPoint(cell.x+.5,cell.z+.5),c=window.__testCamera();return {x:c.x+p.x*c.scale,y:c.y+(p.y-window.__room.centerY)*c.scale};},cell);
      await page.mouse.click(screen.x,screen.y);
      assert.equal(await page.$eval('.dance-floor-controls',panel=>panel.hidden),!dance,'Only dance floor tiles open the controls');
    }
    if(!mobile){
      await page.evaluate(()=>{const s=window.__room.layout.stairs[0];window.__viewTile(s.x+1,s.z+s.depth/2,true);});
      await page.screenshot({path:'/tmp/terraces-stairs.png'});
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: fixed levels, desktop/mobile teleport and tile clicks walking both ways through stairs.');
}finally{await browser.close();}
