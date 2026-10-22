// Read-only fixture against local Vite; no room joins or backend mutations.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5197';
const browser=await puppeteer.launch({
  executablePath:process.env.CHROME_EXECUTABLE_PATH,
  headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader'],
  defaultViewport:{width:1200,height:900,deviceScaleFactor:1},
});
try{
  for(const away of [false,true]){
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.evaluateOnNewDocument(away=>{
      const player={id:'fixture',name:'Sleepy',role:'guest',away,route:[{x:4.5,z:4.5}],startedAt:Date.now(),direction:2,seatId:null,
        action:'dance',actionStarted:Date.now(),
        look:{hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}}};
      window.__ROOM_RENDER_INPUT__={mode:'room',scene:{serverTime:Date.now(),players:[player],assets:[],
        room:{options:{shape:'square',wall:'plain',wallColor:'#dcded4',floor:'wood',floorColor:'#f7de9c',window:true},spaces:[],stickies:[],furniture:[]}}};
    },away);
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__ROOM_RENDER_RESULT__||window.__ROOM_RENDER_ERROR__,{timeout:45000});
    const result=await page.evaluate(()=>{
      const label=document.querySelector('.player-target');
      return {error:window.__ROOM_RENDER_ERROR__,label:label?.getAttribute('aria-label'),
        away:label?.dataset.away,visible:label?!label.hidden:false,
        marker:label?getComputedStyle(label,'::after').content:null};
    });
    assert.equal(result.error,undefined);assert.deepEqual(errors,[]);
    assert.equal(result.away,String(away));assert.equal(result.visible,true);
    assert.equal(result.label,away?'Select Sleepy (away)':'Select Sleepy');
    assert.equal(result.marker,away?'"zZ"':'none');
    if(away)await page.screenshot({path:'/tmp/habbo-presence-away.png'});
    await page.close();
  }
  console.log('PASS: active and away avatars remain visible; the sleeping marker and accessible status match presence.');
}finally{await browser.close();}
