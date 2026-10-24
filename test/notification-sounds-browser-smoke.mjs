// Local fixtures only: no room joins, chat sends or backend mutations.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5197';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true});
try{
  for(const width of [1200,390]){
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width,height:900});
    await page.goto(origin+'/test/toolbar-browser.html');
    await page.waitForFunction(()=>/^(PASS|FAIL):/.test(document.querySelector('#result').textContent));
    const result=await page.$eval('#result',el=>el.textContent);
    assert.match(result,/^PASS:/);assert.deepEqual(errors,[]);
    if(width===390)await page.click('.toolbar-menu-toggle');
    await page.click('.music-toggle');
    await page.screenshot({path:`/tmp/habbo-notification-controls-${width}.png`});
    if(width===390){await page.close();continue;}
    await page.evaluate(async()=>{
      const {createNotificationSounds}=await import('/src/notification-sounds.js');
      window.soundTest={createNotificationSounds,notes:0,ended:0};
      soundTest.sound=createNotificationSounds({createContext:()=>{
        const context=new AudioContext();soundTest.context=context;
        const oscillator=context.createOscillator.bind(context);
        context.createOscillator=()=>{
          const note=oscillator();soundTest.notes++;
          note.addEventListener('ended',()=>soundTest.ended++);return note;
        };
        return context;
      }});
      document.addEventListener('pointerdown',()=>{void soundTest.sound.unlock();});
      document.querySelector('.notification-mute').addEventListener('click',event=>soundTest.sound.setMuted(event.target.getAttribute('aria-pressed')==='true'));
    });
    await page.click('#chat-message');
    await page.waitForFunction(()=>soundTest.context?.state==='running');
    const foreground=await browser.newPage();await foreground.bringToFront();
    assert.equal(await page.evaluate(()=>document.hidden),true);
    const started=await page.evaluate(async()=>{
      await soundTest.sound.play();await soundTest.sound.play('message');
      return {notes:soundTest.notes,state:soundTest.context.state};
    });
    assert.deepEqual(started,{notes:3,state:'running'});
    await page.waitForFunction(()=>soundTest.ended===3,{polling:50});
    await page.bringToFront();await page.click('.music-toggle');await page.click('.notification-mute');
    assert.equal(await page.evaluate(()=>soundTest.sound.muted),true);
    assert.equal(await page.evaluate(()=>soundTest.createNotificationSounds().muted),true);
    await foreground.bringToFront();
    const mutedNotes=await page.evaluate(async()=>{
      await soundTest.sound.play();await soundTest.sound.play('message');return soundTest.notes;
    });
    assert.equal(mutedNotes,3);
    await page.bringToFront();await page.click('.notification-mute');
    assert.equal(await page.evaluate(()=>soundTest.createNotificationSounds().muted),false);
    await foreground.close();await page.close();
  }
  console.log('PASS: desktop/mobile mute controls, real background audio completion, and saved mute preference.');
}finally{await browser.close();}
