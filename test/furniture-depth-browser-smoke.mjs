import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5198';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true,args:['--enable-unsafe-swiftshader']});
try{
  for(const width of [1280,390]){
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:800,deviceScaleFactor:width===390?3:1});
    await page.goto(origin+'/test/furniture-depth-browser.html');await page.waitForFunction(()=>window.__TEST_RESULT__);
    assert.equal(await page.evaluate(()=>window.__TEST_RESULT__),'passed');assert.deepEqual(errors,[]);
    await page.screenshot({path:`/tmp/furniture-depth-${width}.png`,fullPage:true});
    const scene=await page.evaluate(()=>window.__DEPTH_SCENE__);
    await page.evaluateOnNewDocument(scene=>{window.__ROOM_RENDER_INPUT__={mode:'room',scene};},scene);
    await page.goto(origin+'/');await page.waitForFunction(()=>window.__ROOM_RENDER_RESULT__||window.__ROOM_RENDER_ERROR__);
    assert.equal(await page.evaluate(()=>window.__ROOM_RENDER_ERROR__),undefined);
    await page.waitForFunction(()=>window.__room?.visuals.length===2);
    const orders=await page.evaluate(()=>Object.fromEntries(window.__room.visuals.map(v=>[v.id,v.order])));
    assert(orders.bar<orders.bag,'The full room animation loop must apply the corrected order');
    await page.close();
    console.log(`${width}px: furniture depth, avatars, rotation, support and hit testing passed`);
  }
}finally{await browser.close();}
