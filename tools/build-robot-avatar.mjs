import {Jimp,ResizeStrategy} from 'jimp';
import {trim} from '../shared/sprite-build.js';

// The same trim/nearest-neighbour pipeline as furniture, packed for the character atlas.
const source=await Jimp.read(new URL('./tnarg-portrait-source.png',import.meta.url).pathname);
const cellWidth=Math.floor(source.width/4),poses=[],bands=[];
// Find the transparent gutters rather than assuming the generator placed each row exactly.
for(let y=0;y<source.height;y++){
  let occupied=false;
  for(let x=0;x<source.width;x++)if(source.bitmap.data[(y*source.width+x)*4+3]>=128){occupied=true;break;}
  if(!occupied)continue;
  const last=bands.at(-1);
  if(last&&y-last[1]<source.height*.025)last[1]=y;
  else bands.push([y,y]);
}
if(bands.length!==3)throw new Error('Expected three separate rows of robot poses.');
for(let row=0;row<3;row++)for(let col=0;col<4;col++){
  const [top,bottom]=bands[row];
  const pose=source.clone().crop({x:col*cellWidth,y:top,w:cellWidth,h:bottom-top+1});
  for(let i=3;i<pose.bitmap.data.length;i+=4)pose.bitmap.data[i]=pose.bitmap.data[i]>=128?255:0;
  trim(pose);poses.push(pose);
}
const scale=72/Math.max(...poses.slice(0,8).map(p=>p.height));
const atlas=new Jimp({width:384,height:336,color:0x00000000});
for(const [i,pose] of poses.entries()){
  pose.resize({w:Math.round(pose.width*scale),h:Math.round(pose.height*scale),mode:ResizeStrategy.NEAREST_NEIGHBOR});
  let left=pose.width,right=0;
  for(let y=Math.floor(pose.height*.85);y<pose.height;y++)for(let x=0;x<pose.width;x++)if(pose.bitmap.data[(y*pose.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);}
  const anchor=(left+right)/2,row=Math.floor(i/4),baseline=row===2?84:100;
  atlas.composite(pose,(i%4)*96+Math.round(48-anchor),row*112+baseline-pose.height);
}
atlas.quantize({colors:24,paletteQuantization:'wuquant',imageQuantization:'nearest'});
for(let i=3;i<atlas.bitmap.data.length;i+=4)atlas.bitmap.data[i]=atlas.bitmap.data[i]>=128?255:0;
await atlas.write(new URL('../public/assets/bot/tnarg-robot-v3.png',import.meta.url).pathname);
console.log('Built 12 robot poses at native character scale.');
