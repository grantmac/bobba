import {Jimp,loadFont} from 'jimp';
import {SANS_16_BLACK,SANS_10_BLACK} from 'jimp/fonts';
import {isoPoint} from './asset-geometry.js';
let fonts;
export async function assetBlueprint({width=1,depth=1,frames,kind='floor'}){
  if(![width,depth].every(n=>Number.isInteger(n)&&n>=1&&n<=4))throw new Error('Footprint must be 1 to 4 tiles each way.');
  const [label,tiny]=await (fonts??=Promise.all([loadFont(SANS_16_BLACK),loadFont(SANS_10_BLACK)]));
  const image=new Jimp({width:800,height:560,color:0xe5e5dfff});
  const views=frames||kind==='wall'?[2,4]:[2,4,6,0],facing={2:'lower-right',4:'lower-left',6:'upper-left',0:'upper-right'};
  function line(x,y,dx,dy,color=0x496c83ff){const n=Math.max(Math.abs(dx),Math.abs(dy));for(let i=0;i<=n;i++)image.setPixelColor(color,Math.round(x+dx*i/n),Math.round(y+dy*i/n));}
  for(const [i,direction] of views.entries()){
    const ox=(i%2)*400,oy=Math.floor(i/2)*280,w=direction%4===2?depth:width,d=direction%4===2?width:depth;
    image.print({font:label,x:ox+12,y:oy+12,text:`${direction}: ${facing[direction]}`});
    image.print({font:tiny,x:ox+12,y:oy+36,text:frames?'Single view + mirrored second view':'Separate artwork for this rotation'});
    const cx=ox+160-(w-d)*16,cy=oy+92;
    for(let x=0;x<w;x++)for(let z=0;z<d;z++){
      const p=isoPoint(x,z),sx=cx+p.x,sy=cy+p.y;
      line(sx,sy,32,16);line(sx+32,sy+16,-32,16);line(sx,sy+32,-32,-16);line(sx-32,sy+16,32,-16);
      image.print({font:tiny,x:sx-7,y:sy+12,text:`${x},${z}`});
    }
    line(ox+340,oy+80,0,95,0xd12164ff);line(ox+336,oy+80,8,0,0xd12164ff);line(ox+336,oy+175,8,0,0xd12164ff);
    image.print({font:tiny,x:ox+318,y:oy+183,text:'95 px'});
    image.print({font:tiny,x:ox+12,y:oy+252,text:'1:1 room pixels; (0,0) is the back/top tile'});
  }
  return (await image.getBuffer('image/png')).toString('base64');
}
