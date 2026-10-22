// Read-only browser test: real background throttling, followed by a lost worker.
// No room joins or backend writes. Default duration exceeds the five-minute threshold.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5178';
const duration=Number(process.env.ROOM_BACKGROUND_MS??360000);
const browser=await puppeteer.launch({
  executablePath:process.env.CHROME_EXECUTABLE_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true,
  ignoreDefaultArgs:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'],
});
try{
  const page=await browser.newPage();
  const fixture=origin+'/test/program-resume-browser-smoke.html';
  await page.setRequestInterception(true);
  page.on('request',request=>request.url()===fixture
    ?request.respond({status:200,contentType:'text/html',body:'<!doctype html><title>Program resume test</title>'})
    :request.continue());
  await page.goto(fixture,{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const {createProgramSandbox}=await import('/src/asset-program-runtime.js');
    const result=window.resumeTest={visual:null,errors:[],people:12};
    const runtime=createProgramSandbox({
      program:{source:`export default function(api){api.on('tick',()=>api.setVisual({animation:api.item.on&&api.state.running,display:{text:String(api.room.people).padStart(3,'0'),color:'#ffbe55',corners:[.1,.2,.9,.6,.1,.4]}}));}`},
      views:[4],onVisual:value=>{result.visual=value;},onError:message=>result.errors.push(message),
      onSave:()=>{throw Error('This fixture must not save state');},
    });
    const update=()=>runtime.update({item:{id:'counter',on:false},room:{people:result.people},state:{running:false},occupants:[],time:Date.now(),revision:4,serial:9,events:[],isHost:false});
    const timer=setInterval(update,100);update();
    result.dispose=()=>{clearInterval(timer);runtime.dispose();};
  });
  await page.waitForFunction(()=>window.resumeTest.visual?.display?.text==='012');
  const foreground=await browser.newPage();await foreground.bringToFront();
  assert.equal(await page.evaluate(()=>document.hidden),true);
  for(let elapsed=0;elapsed<duration;){
    const pause=Math.min(30000,duration-elapsed);
    await new Promise(resolve=>setTimeout(resolve,pause));elapsed+=pause;
    console.log(`Background browser test: ${Math.round(elapsed/1000)} seconds elapsed.`);
  }
  await page.bringToFront();
  await page.evaluate(()=>{window.resumeTest.people=13;});
  await page.waitForFunction(()=>window.resumeTest.visual?.display?.text==='013',{timeout:20000});
  let result=await page.evaluate(()=>({visual:window.resumeTest.visual,errors:window.resumeTest.errors}));
  assert.equal(result.visual.animation,false);assert.deepEqual(result.errors,[]);
  console.log(`PASS: live count updates and stopped animation survives ${duration/1000} seconds in a real background tab.`);
  // Simulate the browser destroying the worker while the room remains mounted.
  await foreground.bringToFront();
  await page.evaluate(()=>{document.querySelector('iframe[title="Furniture program"]').remove();});
  await page.bringToFront();
  await page.evaluate(()=>{window.resumeTest.people=14;});
  await page.waitForFunction(()=>window.resumeTest.visual?.display?.text==='014',{timeout:20000});
  result=await page.evaluate(()=>({visual:window.resumeTest.visual,errors:window.resumeTest.errors,frames:document.querySelectorAll('iframe[title="Furniture program"]').length}));
  assert.equal(result.visual.animation,false);assert.deepEqual(result.errors,[]);assert.equal(result.frames,1);
  await page.evaluate(()=>window.resumeTest.dispose());
  console.log('PASS: destroyed worker reconnects on return, restoring count and stopped state without reloading the room.');
}finally{await browser.close();}
