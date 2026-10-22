// Downloads each current sprite once, keeps originals, and verifies lossless candidates.
// This writes local files only. It never uploads or changes Convex records.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {Jimp} from 'jimp';
import {encodePng} from '../shared/png.js';

const [cataloguePath,outputPath,...extra]=process.argv.slice(2);
if(!cataloguePath||!outputPath||extra.length)throw Error('Usage: node tools/audit-sprites.mjs CATALOGUE.json OUTPUT_DIRECTORY');
const output=resolve(outputPath),catalogue=JSON.parse(await readFile(cataloguePath,'utf8'));
await mkdir(join(output,'originals'),{recursive:true});
await mkdir(join(output,'optimized'),{recursive:true});
const files=new Map();
for(const asset of catalogue)for(const part of asset.parts){
  if(!files.has(part.file))files.set(part.file,[]);
  files.get(part.file).push({assetId:asset.id,name:asset.name,density:asset.spriteDensity??1,width:part.width,height:part.height,frames:part.frames??null,layer:part.layer,direction:part.direction});
}
const results=[];
for(const [url,uses] of files){
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.convex.cloud')||!/^\/api\/storage\/[^/]+$/.test(parsed.pathname))throw Error('Expected a Convex storage URL');
  const key=createHash('sha256').update(url).digest('hex'),originalPath=join(output,'originals',key+'.png');
  let original;
  try{original=await readFile(originalPath);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Download failed (${response.status}): ${uses[0].name}`);
    original=Buffer.from(await response.arrayBuffer());await writeFile(originalPath,original);
  }
  const image=await Jimp.read(original);
  const candidate=await encodePng(image),optimized=candidate.length<original.length?candidate:original;
  const decoded=await Jimp.read(optimized);
  if(decoded.width!==image.width||decoded.height!==image.height||!decoded.bitmap.data.equals(image.bitmap.data))throw Error(`Pixels changed: ${uses[0].name}`);
  const optimizedPath=join(output,'optimized',key+'.png');await writeFile(optimizedPath,optimized);
  const dimensions=uses.map(use=>{
    const expectedWidth=use.frames?Math.max(...use.frames.map(f=>f.x+f.width)):use.width*use.density;
    const expectedHeight=use.frames?Math.max(...use.frames.map(f=>f.y+f.height)):use.height*use.density;
    const excessFrameResolution=use.frames?.some(f=>f.width>use.width*use.density||f.height>use.height*use.density)??false;
    return {...use,expectedWidth,expectedHeight,excessWidth:Math.max(0,image.width-expectedWidth),excessHeight:Math.max(0,image.height-expectedHeight),excessFrameResolution};
  });
  results.push({url,originalPath,optimizedPath,sha256:createHash('sha256').update(original).digest('hex'),originalBytes:original.length,optimizedBytes:optimized.length,savedBytes:original.length-optimized.length,width:image.width,height:image.height,uses:dimensions});
  // Keep progress durable: interrupted runs reuse the originals instead of downloading again.
  await writeFile(join(output,'report.json'),JSON.stringify({complete:false,files:results},null,2)+'\n');
  if(results.length%25===0)console.log(JSON.stringify({processed:results.length,total:files.size}));
}
const originalBytes=results.reduce((n,r)=>n+r.originalBytes,0),optimizedBytes=results.reduce((n,r)=>n+r.optimizedBytes,0);
const summary={assets:catalogue.length,files:results.length,improved:results.filter(r=>r.savedBytes>0).length,originalBytes,optimizedBytes,savedBytes:originalBytes-optimizedBytes,savedPercent:100*(originalBytes-optimizedBytes)/originalBytes,oversizedFiles:results.filter(r=>r.uses.some(u=>u.excessWidth||u.excessHeight||u.excessFrameResolution)).length};
await writeFile(join(output,'report.json'),JSON.stringify({complete:true,summary,files:results},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
