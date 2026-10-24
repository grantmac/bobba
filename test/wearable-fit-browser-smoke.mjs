import assert from 'node:assert/strict';
import {wearableHandlers} from '../server/wearables-mcp.js';
import {renderInBrowser} from '../server/render.js';
import {decodeImage} from '../shared/image-codec.js';

process.env.CHROME_EXECUTABLE_PATH??='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin=process.env.ROOM_RENDER_ORIGIN??'http://127.0.0.1:5186';
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
let source,uploaded,saved;
const handlers=wearableHandlers({api:{wearables:{outfit:'outfit',create:'create'},agents:{discardUpload:'discard'}},render:renderInBrowser,
  call:async(kind,fn,args)=>{
    if(fn==='outfit')return {look,wearables:[]};
    if(fn==='create'){saved=args;return {id:'custom-shirt',slot:args.slot,templateModel:args.templateModel};}
  },loadSource:async()=>source,uploader:()=>async buffer=>{uploaded=buffer;return 'processed';}
});
const context={token:'test-key',origin};
const design=await handlers.design_wearable({slot:'top',name:'Red shirt',description:'A red shirt'},context);
const spec=JSON.parse(design.content[0].text);
assert.equal(spec.template_model,'1');assert.equal(spec.layout.rows.length,36);assert.equal(design.content.length,3);
const template=await decodeImage(Buffer.from(design.content[2].data,'base64'));
assert.equal(template.bitmap.width,768);assert.equal(template.bitmap.height,4032);
source=template.clone();
for(let i=0;i<source.bitmap.data.length;i+=4)if(source.bitmap.data[i+3]){
  source.bitmap.data.set([220,40,60,255],i);
}
const args={slot:'top',name:'Red shirt',storage_id:'source',template_model:spec.template_model};
const preview=await handlers.preview_wearable(args,context);
assert.equal(preview.content[0].mimeType,'image/webp');
const result=await handlers.submit_wearable(args,context);
assert.equal(result.templateModel,'1');assert.equal(saved.templateModel,'1');
assert.equal(uploaded.toString('ascii',8,12),'WEBP');
console.log('Real MCP design → fitting template → preview → submission passed without live writes.');
