// Full room UI with a local multiplayer fixture: no live room joins or mutations.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5197';
// Expose the rendered transform only in this intercepted test module.
const mainSource=await (await fetch(origin+'/src/main.js')).text();
const cameraProbe='\nwindow.__testCamera=()=>({scale:displayScale,x:view.left+view.halfW+viewOffsetX,y:view.top+view.halfH+viewOffsetY});';
const mock=`
export {samplePlayer} from '/src/multiplayer.js?fixture-original';
export function createMultiplayer(){
  const me={id:'visitor',name:'Visitor',role:'guest',zone:'main',route:[{x:3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,
    look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
  let spaces=Array.from({length:8},(_,i)=>({id:'space-'+i,name:i===5?'Moon garden':'Space '+(i+1),owner:'owner-'+i,ownerName:'Builder '+(i+1),width:8,depth:8,floor:'wood',floorColor:'#f7de9c'}));
  const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:[]};
  let handlers;const noop=()=>{};
  const network={me,now:()=>Date.now(),zones:[],population:{people:1},identity:{},pairing:{code:''},bot:{},
    loadPreview:async()=>({room,players:[]}),resume:async()=>me,
    assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},
    whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{},
    setZones(ids){network.zones=ids;},
    watch(value){handlers=value;value.onMap(room);value.onSignals({danceFloorOn:true});value.onFurniture({zones:new Map(),inventory:[]});value.onState({me,players:[],messages:[]});},
    async teleport(spaceId){
      window.__teleportCalls=(window.__teleportCalls??0)+1;
      await new Promise(resolve=>setTimeout(resolve,100));
      if(window.__teleportError)throw new Error(window.__teleportError);
      const i=spaces.findIndex(s=>s.id===spaceId);
      const arrival={route:[spaceId==='main'?{x:3.5,z:4.5}:{x:21+i*8+3.5,z:3.5}],startedAt:Date.now(),direction:2,seatId:null,zone:spaceId,action:null};
      Object.assign(me,arrival);handlers.onState({me,players:[],messages:[]});return arrival;
    },
  };
  window.__renameSpace=()=>{spaces=spaces.map((s,i)=>i===5?{...s,name:'Renamed garden'}:s);room.spaces=spaces;handlers.onMap(room);};
  return network;
}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  for(const deviceScaleFactor of [1,2,3]){
    const mobile=deviceScaleFactor!==1;
    const page=await browser.newPage(),errors=[];
    await page.setViewport({width:mobile?390:1200,height:mobile?844:900,deviceScaleFactor,isMobile:mobile,hasTouch:mobile});
    page.on('pageerror',e=>errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      if(request.url()===origin+'/src/main.js')return request.respond({contentType:'text/javascript',body:mainSource+cameraProbe});
      if(request.url()===origin+'/src/multiplayer.js')return request.respond({contentType:'text/javascript',body:mock});
      if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))return request.abort();
      return request.continue();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!document.body.hasAttribute('data-loading')&&window.__room,{timeout:45000});
    const open=async()=>{if(mobile)await page.click('.toolbar-menu-toggle');await page.click('.spaces-toggle');};
    await open();
    assert.equal(await page.$eval('.spaces-dialog',d=>d.open),true);
    assert.equal(await page.$$eval('.space-destination',buttons=>buttons.length),9);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.spaceId),'main');
    const bounds=await page.$eval('.spaces-dialog',d=>{const r=d.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
    assert(bounds.left>=0&&bounds.right<=(mobile?390:1200)&&bounds.top>=0&&bounds.bottom<=(mobile?844:900));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.spaces-dialog').open);
    await page.waitForFunction(selector=>document.activeElement===document.querySelector(selector),{},mobile?'.toolbar-menu-toggle':'.spaces-toggle');
    assert.equal(await page.evaluate(()=>document.activeElement.className),mobile?'toolbar-menu-toggle':'bar-icon spaces-toggle');
    assert(!await page.evaluate(()=>window.__room.zones.drawn.includes('space-5')));
    await open();
    await page.evaluate(()=>window.__renameSpace());
    assert.equal(await page.$eval('[data-space-id="space-5"] strong',el=>el.textContent),'Renamed garden');
    await page.screenshot({path:mobile?'/tmp/teleport-mobile.png':'/tmp/teleport-desktop.png'});
    await page.click('[data-space-id="space-5"]');
    assert(await page.$$eval('.space-destination',buttons=>buttons.every(b=>b.disabled)));
    await page.waitForFunction(()=>!document.querySelector('.spaces-dialog').open&&document.querySelector('#scene').dataset.cell==='64,3');
    assert.equal(await page.evaluate(()=>window.__teleportCalls),1);
    const arrival=await page.evaluate(()=>({avatar:window.__room.avatar,zones:window.__room.zones,moving:document.querySelector('#scene').dataset.moving}));
    assert.equal(arrival.avatar.x,64.5);assert.equal(arrival.avatar.z,3.5);assert.equal(arrival.moving,'false');
    assert(arrival.zones.visible.includes('space-5'));assert(arrival.zones.drawn.includes('space-5'));assert(arrival.zones.subscribed.includes('space-5'));
    await page.screenshot({path:mobile?'/tmp/teleport-arrival-mobile.png':'/tmp/teleport-arrival-desktop.png'});
    if(mobile){
      const cdp=await page.createCDPSession(),before=await page.evaluate(()=>window.__testCamera());
      const anchor={x:(195-before.x)/before.scale,y:(400-before.y)/before.scale};
      const points=distance=>[{x:195-distance/2,y:400,id:1},{x:195+distance/2,y:400,id:2}];
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(100)});
      let changedScale=false;
      for(const distance of [104,110,130,160,200,230,180,140,100,200]){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(distance)});
        const after=await page.evaluate(()=>window.__testCamera());
        changedScale ||= after.scale!==before.scale;
        assert(Math.abs(after.x+anchor.x*after.scale-195)<2,'Distant space stays beneath horizontal pinch centre');
        assert(Math.abs(after.y+anchor.y*after.scale-400)<2,'Distant space stays beneath vertical pinch centre');
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert(changedScale,'Pinching changes the rendered zoom');
      assert.equal(await page.evaluate(()=>window.__room.avatar.x),64.5);
      // Reach the walkway below the final space while still zoomed in.
      const floor=await page.evaluate(()=>{const p=window.__room.iso(84.5,8.5);return {x:p.x,y:p.y-window.__room.centerY};});
      for(let drag=0;drag<16;drag++){
        const camera=await page.evaluate(()=>window.__testCamera());
        const dx=195-(camera.x+floor.x*camera.scale),dy=400-(camera.y+floor.y*camera.scale);
        if(Math.hypot(dx,dy)<2)break;
        const factor=Math.min(1,180/Math.max(Math.abs(dx),Math.abs(dy)));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:400,id:1}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195+dx*factor,y:400+dy*factor,id:1}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      const panned=await page.evaluate(()=>window.__testCamera());
      assert(Math.abs(panned.x+floor.x*panned.scale-195)<2,'Can pan across to the final space while zoomed in');
      assert(Math.abs(panned.y+floor.y*panned.scale-400)<2,'Can pan low enough to centre the final walkway while zoomed in');
      await cdp.detach();
    }
    await open();await page.evaluate(()=>window.__teleportError='That space is full right now.');
    await page.click('[data-space-id="main"]');
    await page.waitForFunction(()=>document.querySelector('.spaces-status').textContent==='That space is full right now.');
    assert.equal(await page.$eval('.spaces-dialog',d=>d.open),true);
    assert.equal(await page.evaluate(()=>window.__room.avatar.x),64.5);
    await page.evaluate(()=>window.__teleportError='');await page.click('[data-space-id="main"]');
    await page.waitForFunction(()=>!document.querySelector('.spaces-dialog').open&&document.querySelector('#scene').dataset.cell==='3,4');
    assert(await page.evaluate(()=>window.__room.zones.visible.includes('main')));
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: desktop/mobile space list, live rename, focus, pending/error states, avatar teleport, distant-space pinch at 2x/3x pixel density, camera streaming and lobby return.');
}finally{await browser.close();}
