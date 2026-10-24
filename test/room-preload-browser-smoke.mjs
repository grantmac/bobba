// Local fixture with delayed room data and sprites; never joins the live room.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5198';
const mainSource=await (await fetch(origin+'/src/main.js')).text();
const probe=`
window.__viewSpace=id=>{const s=layout.spaces.find(s=>s.id===id),p=groundPoint(s.x+4,s.z+4);panX=-p.x*displayScale;panY=-(p.y-CENTER_Y)*displayScale;resize();};
window.__panPosition=()=>({x:panX,y:panY});
`;
const mock=`
import {roomLayout} from '/shared/room-layout.js';
import {shapes} from '/convex/lib/catalog.js';
export {samplePlayer} from '/src/multiplayer.js?fixture-original';
export function createMultiplayer(){
  const me={id:'visitor',name:'Visitor',role:'guest',zone:'main',route:[{x:3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,
    look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
  const spaces=Array.from({length:40},(_,i)=>({id:'space-'+i,name:'Space '+i,owner:'builder',width:8,depth:8,floor:'wood',floorColor:'#f7de9c',level:0}));
  const layout=roomLayout(shapes.square,spaces);
  const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces,stickies:[],furniture:[]};
  let handlers;const loaded=new Map(),pending=new Set(),noop=()=>{};
  const emit=()=>handlers?.onFurniture({zones:new Map([...loaded].filter(([id])=>network.zones.includes(id))),inventory:[]});
  const network={me,now:()=>Date.now(),zones:[],population:{people:1},identity:{},pairing:{code:''},bot:{},
    loadPreview:async()=>({room,players:[]}),resume:async()=>me,
    assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},
    whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{},
    setZones(ids){
      network.zones=ids;if(!handlers)return;
      for(const id of ids){
        if(loaded.has(id)||pending.has(id))continue;pending.add(id);
        setTimeout(()=>{
          const space=layout.spaces.find(s=>s.id===id);
          loaded.set(id,space?[{id:'chair-'+id.slice(6),type:'small_chair_armas',rotation:0,x:space.x+3,z:space.z+3}]:[]);
          pending.delete(id);emit();
        },250);
      }
      emit();
    },
    watch(value){handlers=value;value.onMap(room);value.onSignals({danceFloorOn:true});value.onFurniture({zones:new Map(),inventory:[]});value.onState({me,players:[],messages:[]});network.setZones(network.zones);},
  };
  return network;
}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
try{
  for(const mobile of [false,true]){
    const page=await browser.newPage(),errors=[],images=[];
    await page.setViewport({width:mobile?390:1200,height:mobile?844:900,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
    page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request',request=>{
      const url=new URL(request.url());
      if(url.pathname==='/src/main.js')return request.respond({contentType:'text/javascript',body:mainSource+probe});
      if(url.pathname==='/src/multiplayer.js'&&!url.search)return request.respond({contentType:'text/javascript',body:mock});
      if(url.pathname.startsWith('/assets/furniture/')&&/\.(png|webp)$/.test(url.pathname)){
        images.push(url.pathname);setTimeout(()=>request.continue(),500);return;
      }
      if(!request.url().startsWith(origin)&&!request.url().startsWith('data:')&&!request.url().startsWith('blob:'))return request.abort();
      return request.continue();
    });
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!document.body.hasAttribute('data-loading')&&window.__room,{timeout:45000});
    const zones=await page.evaluate(()=>window.__room.zones);
    const ahead=zones.subscribed.find(id=>id!=='main'&&!zones.visible.includes(id));
    assert(ahead,'A room beyond the drawing area is preloaded');
    assert(!zones.subscribed.includes('space-39'),'Distant rooms are not all subscribed');
    const chair='chair-'+ahead.slice(6);
    await page.waitForFunction(chair=>window.__room.visuals.some(v=>v.id===chair.slice(0,6)),{},chair);
    assert(images.length>0,'Furniture sprites were downloaded before scrolling');
    const downloads=images.length;
    const arrival=await page.evaluate(id=>{window.__viewSpace(id);return {zones:window.__room.zones,visuals:window.__room.visuals};},ahead);
    assert(arrival.zones.drawn.includes(ahead));
    assert(arrival.visuals.some(v=>v.id===chair.slice(0,6)),'Furniture is already drawn on the first frame in the room');
    assert.equal(images.length,downloads,'Scrolling into the prepared room does not fetch its sprites again');
    const rect=await page.$eval('#scene',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
    const center={x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2};
    const position=()=>page.evaluate(()=>window.__panPosition());
    const pause=()=>new Promise(resolve=>setTimeout(resolve,600));
    await page.mouse.move(center.x,center.y);
    const beforeEdge=await position();
    await page.mouse.move(rect.right-2,center.y);await pause();
    if(mobile){
      assert.deepEqual(await position(),beforeEdge,'Edge scrolling stays disabled on mobile');
    }else{
      assert((await position()).x<beforeEdge.x-50,'Right edge pans toward rooms on the right');
      await page.mouse.move(center.x,center.y);await pause();
      const stopped=await position();await pause();
      assert.deepEqual(await position(),stopped,'Leaving the edge stops movement');
      for(const [x,y,axis,sign] of [[rect.left+2,center.y,'x',1],[center.x,rect.top+2,'y',1],[center.x,rect.bottom-2,'y',-1]]){
        const before=await position();await page.mouse.move(x,y);await pause();
        assert(((await position())[axis]-before[axis])*sign>50,'Each edge pans in its own direction');
      }
      await page.mouse.down();const held=await position();await pause();
      assert.deepEqual(await position(),held,'Holding a mouse button suspends edge scrolling');
      await page.mouse.up();
      await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='test-edge-dialog';document.body.append(dialog);dialog.showModal();});
      await page.mouse.move(rect.right-2,center.y);const modal=await position();await pause();
      assert.deepEqual(await position(),modal,'A modal suspends edge scrolling');
      await page.evaluate(()=>document.querySelector('#test-edge-dialog').remove());
      await page.mouse.move(center.x,center.y);
      await page.evaluate(()=>{const input=document.createElement('input');input.id='test-edge-input';document.body.append(input);input.focus();});
      await page.mouse.move(rect.right-2,center.y);const typing=await position();await pause();
      assert.deepEqual(await position(),typing,'Typing suspends edge scrolling');
      await page.evaluate(()=>document.querySelector('#test-edge-input').remove());
    }
    await page.waitForFunction(()=>window.__room.visuals.length>0);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: nearby furniture preloads on desktop/mobile; desktop edge scrolling pans in all directions and pauses for controls; mobile stays unchanged.');
}finally{await browser.close();}
