// Exercise speech positions against actual rendered avatars, with no backend writes.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5173';
const main=await (await fetch(origin+'/src/main.js')).text();
const probe=`
window.__chatHead=id=>{
  const mesh=id==='grant'?avatar:peers.get(id).mesh;
  const p=mesh.position.clone();p.y+=55;p.project(camera);
  return {x:view.left+(p.x+1)*view.halfW,y:view.top+(1-p.y)*view.halfH};
};
window.__chatCamera=(dx=0,dy=0,factor=1)=>{panX+=dx;panY+=dy;zoom*=factor;resize();};
window.__chatCenter=()=>{panX=-avatar.position.x*displayScale;panY=(avatar.position.y+55)*displayScale;resize();};
`;
const mock=`
export {samplePlayer} from '/src/multiplayer.js?fixture-original';
export function createMultiplayer(){
  const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
  const me={id:'grant',name:'Grant',role:'guest',zone:'main',route:[{x:3.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,look};
  const bot={...me,id:'tnarg',name:'Tnarg',kind:'bot',route:[{x:9.5,z:3.5}]};
  const chair={id:'chair',type:'small_chair_armas',rotation:0,x:3,z:4};
  const room={options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces:[],stickies:[],furniture:[chair]};
  const noop=()=>{};let handlers,messages=[];
  const emit=()=>handlers.onState({me,players:[bot],messages});
  const network={me,now:()=>Date.now(),population:{people:2},identity:{},pairing:{code:''},bot:{},
    loadPreview:async()=>({room,players:[]}),resume:async()=>me,
    assets:{list:async()=>[],watch:noop},agents:{attached:()=>noop},
    whiteboard:{all:async()=>({strokes:[],serial:0}),watch:noop},visits:{},setZones:noop,
    watch(value){handlers=value;value.onMap(room);value.onSignals({danceFloorOn:true});value.onFurniture({zones:new Map([['main',[chair]]]),inventory:[]});emit();}
  };
  window.__sendChat=id=>{const p=id==='grant'?me:bot;messages.push({id:'m'+messages.length,playerId:p.id,name:p.name,color:p.look.top.color,body:id==='grant'?'yooooo':'Grant! Back again — the lounge missed you. 🎉',mode:'Say',...p.route.at(-1),sentAt:Date.now()});emit();};
  window.__chatPose=seated=>{me.seatId=seated?'chair':null;me.route=[seated?{x:3.5,z:4.5}:{x:4.5,z:5.5}];emit();};
  return network;
}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  for(const width of [1440,390]){
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width,height:900});await page.setRequestInterception(true);
    page.on('request',r=>{
      if(r.url()===origin+'/src/main.js')return r.respond({contentType:'text/javascript',body:main+probe});
      if(r.url()===origin+'/src/multiplayer.js')return r.respond({contentType:'text/javascript',body:mock});
      if(!r.url().startsWith(origin)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))return r.abort();
      return r.continue();
    });
    await page.goto(origin);await page.waitForFunction(()=>!document.body.hasAttribute('data-loading')&&window.__room,{timeout:45000});
    await page.evaluate(()=>{window.__chatCenter();window.__sendChat('grant');});
    const check=async()=>{
      await page.waitForFunction(()=>{const p=window.__chatHead('grant'),r=document.querySelector('.chat-bubble').getBoundingClientRect();return Math.abs(r.x+r.width/2-p.x)<2&&Math.abs(r.bottom-(p.y-8))<2;});
    };
    await check();
    await page.evaluate(()=>window.__chatCamera(30,25));await check();
    await page.evaluate(()=>window.__chatCamera(0,0,1.2));await check();
    await page.evaluate(()=>window.__chatPose(false));await check();
    await page.evaluate(()=>window.__chatPose(true));await check();
    await page.evaluate(()=>window.__sendChat('tnarg'));
    await page.waitForFunction(()=>document.querySelectorAll('.chat-bubble').length===2);
    const bubbles=await page.$$eval('.chat-bubble',els=>els.map(el=>el.getBoundingClientRect().toJSON()));
    assert(bubbles[0].right+7.9<=bubbles[1].left||bubbles[1].right+7.9<=bubbles[0].left||bubbles[0].bottom+7.9<=bubbles[1].top||bubbles[1].bottom+7.9<=bubbles[0].top);
    await page.screenshot({path:`/tmp/habbo-speech-position-${width}.png`});
    assert.deepEqual(errors,[]);console.log(`${width}px: rendered avatar anchoring, pan, zoom, movement, sitting and two speakers passed`);await page.close();
  }
}finally{await browser.close();}
