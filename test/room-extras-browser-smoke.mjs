import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5186';
try{
  for(const width of [1280,390]){
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:900});await page.goto(origin+'/test/room-extras-browser.html');await page.waitForFunction(()=>window.__ready);
    const click=async text=>{await page.evaluate(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label&&!b.disabled);if(!b)throw new Error('No enabled button: '+label);b.click();},text);};
    await click('Appearance');await click('Hats');await page.waitForSelector('button[title="Explorer cap · Your creation"]');
    await page.waitForFunction(()=>document.querySelector('button[title="Explorer cap · Your creation"] canvas').getContext('2d').getImageData(40,20,1,1).data[3]>0);
    await page.screenshot({path:'/tmp/wardrobe-'+width+'.png'});
    await page.click('button[title="Explorer cap · Your creation"]');
    await page.waitForFunction(()=>!document.querySelector('.appearance-apply').disabled);await click('Apply');await page.waitForFunction(()=>window.__equipped.length===1);
    assert.equal((await page.evaluate(()=>window.__equipped))[0][0].id,'hat');
    const pixels=await page.evaluate(async()=>{const frame=await window.__appearance.previewFrame({...window.__look,_wearables:[window.__hat]},2);return [...frame.getContext('2d').getImageData(40,20,1,1).data];});assert.deepEqual(pixels,[240,75,75,255]);
    if(width===1280){assert.equal(await page.evaluate(()=>window.__checkJacket()),352);assert.equal(await page.evaluate(()=>window.__checkTop()),352);}
    await click('Appearance');await click('Tops');await page.waitForSelector('button[title="Custom shirt · Your creation"]');
    await page.waitForFunction(()=>!document.querySelector('.appearance-apply').disabled);
    await page.click('button[title="Custom shirt · Your creation"]');
    await page.waitForFunction(()=>!document.querySelector('.appearance-apply').disabled);
    await page.screenshot({path:'/tmp/custom-top-'+width+'.png'});
    await click('Apply');await page.waitForFunction(()=>window.__equipped.length===2);
    assert.equal((await page.evaluate(()=>window.__equipped[1])).find(w=>w.slot==='top').templateModel,'1');
    await click('Appearance');await click('Tops');await page.waitForFunction(()=>!document.querySelector('.appearance-apply').disabled);
    await page.click('.item-grid button:nth-child(2)');await page.waitForFunction(()=>!document.querySelector('.appearance-apply').disabled);await click('Apply');
    await page.waitForFunction(()=>window.__equipped.length===3);
    assert.equal((await page.evaluate(()=>window.__equipped[2])).some(w=>w.slot==='top'),false);
    await click('Activities');await click('Join activity');await page.waitForFunction(()=>document.querySelector('.activity-scores').textContent.includes('You'));
    await click('Start round');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Buzz in'&&!b.disabled));await click('Buzz in');
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Saturn'&&!b.disabled));await click('Saturn');
    await page.waitForFunction(()=>document.querySelector('.activity-scores td')?.textContent==='1');
    await page.screenshot({path:'/tmp/activities-'+width+'.png'});
    await click('Create an activity');await page.type('.activity-create input','New quiz');
    await page.type('.activity-question input','What colour is the sky?');await page.type('.activity-question textarea','Blue\nGreen');
    await click('Create activity');await page.waitForFunction(()=>window.__created.length===1);
    assert.equal((await page.evaluate(()=>window.__created[0])).questions[0].options[0],'Blue');
    const overflow=await page.evaluate(()=>{const d=document.querySelector('dialog[open]');return d.getBoundingClientRect().width>innerWidth||d.scrollWidth>d.clientWidth;});assert.equal(overflow,false);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__stops===1);
    assert.deepEqual(errors,[]);await page.close();console.log('Wardrobe and activities passed at '+width+'px');
  }
}finally{await browser.close();}
