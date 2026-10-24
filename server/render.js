// A fresh, read-only browser per render. Only scene data is passed into the page, never keys.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {decodeImage,encodeWebp} from '../shared/image-codec.js';
export async function renderInBrowser(origin,payload){
  const local=process.env.CHROME_EXECUTABLE_PATH;
  const browser=await puppeteer.launch({executablePath:local||await chromium.executablePath(),headless:true,
    args:local?['--no-sandbox','--enable-unsafe-swiftshader']:chromium.args,defaultViewport:{width:1440,height:1000,deviceScaleFactor:1}});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(45000);
    if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET){
      await page.setRequestInterception(true);
      page.on('request',request=>{
        const headers={...request.headers()};
        if(new URL(request.url()).origin===new URL(origin).origin)headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        void request.continue({headers});
      });
    }
    await page.evaluateOnNewDocument(data=>{window.__ROOM_RENDER_INPUT__=data;},payload);
    // The trusted app origin is configured by the deployment, not chosen by the tool caller.
    await page.goto(new URL('/',origin).href,{waitUntil:'domcontentloaded',timeout:20000});
    try{await page.waitForFunction(()=>window.__ROOM_RENDER_RESULT__||window.__ROOM_RENDER_ERROR__);}
    catch{throw new Error('Server render did not become ready. Check that ROOM_RENDER_ORIGIN serves this frontend and permits the renderer to open it.');}
    const result=await page.evaluate(()=>({image:window.__ROOM_RENDER_RESULT__,error:window.__ROOM_RENDER_ERROR__}));
    if(result.error)throw new Error(result.error);
    const png=Buffer.from(result.image.replace(/^data:image\/png;base64,/,''),'base64');
    return (await encodeWebp(await decodeImage(png))).toString('base64');
  }finally{await browser.close();}
}
