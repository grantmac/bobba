import {DANCE_ROWS} from '../shared/room-layout.js';

const COLORS=['#da79a1','#71bfd0','#ddb969','#9e85ce','#7ec5a4','#de8c70'];
export function createDanceFloor(width){
  const canvas=document.createElement('canvas');
  canvas.width=(width+DANCE_ROWS)*32;canvas.height=(width+DANCE_ROWS)*16;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
  const colors=COLORS.map(hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)));
  let last=-1;
  function draw(phase,on=true){
    const key=on?phase:'off';
    if(key===last)return false;last=key;
    if(!on)phase=0;
    for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
      const sx=px+.5-DANCE_ROWS*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
      if(x<0||x>=width||z<0||z>=DANCE_ROWS)continue;
      const u=x%1,v=z%1,edge=Math.min(u,v,1-u,1-v),index=(Math.floor(x)+2*Math.floor(z)+phase)%colors.length;
      const color=edge<.018?[38,42,49]:colors[index],shade=(edge<.035?.85:1)*(on?1:.24);
      const offset=(py*canvas.width+px)*4;
      for(let c=0;c<3;c++)pixels.data[offset+c]=color[c]*shade;
      pixels.data[offset+3]=255;
    }
    ctx.putImageData(pixels,0,0);return true;
  }
  draw(0);return {canvas,draw};
}
