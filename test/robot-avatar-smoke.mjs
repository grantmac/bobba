// Run with Vite serving the app and CHROME_EXECUTABLE_PATH pointing to Chrome.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser=await puppeteer.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH,headless:true});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto((process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5173')+'/test/robot-avatar-browser.html');
  await page.waitForSelector('body[data-ready="true"]');
  const result=await page.evaluate(()=>{
    const frames=window.__ROBOT_FRAMES__,clipped=[],blank=[],sizes=[];
    for(const [key,frame] of frames){
      if(frame.width!==96||frame.height!==112)sizes.push(key);
      const pixels=frame.getContext('2d').getImageData(0,0,96,112).data;
      let count=0;
      for(let y=0;y<112;y++)for(let x=0;x<96;x++)if(pixels[(y*96+x)*4+3]){
        count++;
        if(x===0||x===95||y===0||y===111)clipped.push(key);
      }
      if(!count)blank.push(key);
    }
    const image=key=>frames.get(key).toDataURL();
    const dances=Array.from({length:8},(_,direction)=>{
      const steps=Array.from({length:8},(_,step)=>image(`${direction}:dance:${step}`));
      const legs=Array.from({length:8},(_,step)=>Array.from(frames.get(`${direction}:dance:${step}`).getContext('2d').getImageData(0,83,96,29).data).join(','));
      return {unique:new Set(steps).size,legs:new Set(legs).size,reusesWave:steps.some(pose=>[0,1].some(step=>pose===image(`${direction}:wave:${step}`)))};
    });
    // After two turns, the freeze holds the original direction and bounces.
    const freezes=Array.from({length:8},(_,d)=>({
      holds:image(`${d}:breakdance:8`)===image(`${d}:breakdance:12`),
      stopsSpinning:image(`${d}:breakdance:9`)!==image(`${d}:breakdance:1`),
      bounces:image(`${d}:breakdance:8`)!==image(`${d}:breakdance:10`),
    }));
    return {count:frames.size,clipped,blank,sizes,dances,freezes};
  });
  assert.deepEqual(errors,[]);
  assert.equal(result.count,272);
  for(const field of ['clipped','blank','sizes'])assert.deepEqual(result[field],[],field);
  for(const dance of result.dances){assert.equal(dance.unique,8);assert.ok(dance.legs>=4);assert.equal(dance.reusesWave,false);}
  for(const freeze of result.freezes)assert.deepEqual(freeze,{holds:true,stopsSpinning:true,bounces:true});
  console.log('Robot: 272 valid frames; articulated dance and spin-to-freeze verified in all eight directions.');
}finally{await browser.close();}
