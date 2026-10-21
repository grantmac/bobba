import {DANCE_ROWS} from '../shared/room-layout.js';

const COLORS=['#da79a1','#71bfd0','#ddb969','#9e85ce','#7ec5a4','#de8c70'];
export function createDanceFloor(width){
  const canvas=document.createElement('canvas');
  canvas.width=(width+DANCE_ROWS)*32;canvas.height=(width+DANCE_ROWS)*16;
  const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);
  const colors=COLORS.map(hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)));
  // The geometry never changes, so each pixel's tile index and shading are computed once;
  // a phase change is then just a palette lookup per pixel.
  const count=canvas.width*canvas.height,tile=new Int16Array(count).fill(-1),shade=new Float32Array(count);
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
    const sx=px+.5-DANCE_ROWS*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    if(x<0||x>=width||z<0||z>=DANCE_ROWS)continue;
    const u=x%1,v=z%1,edge=Math.min(u,v,1-u,1-v),i=py*canvas.width+px;
    // Each light is a bevelled pixel-art panel: lit along its upper edges, shadowed
    // along its lower edges, with a stepped glow that brightens towards the centre.
    const ring=Math.max(Math.abs(u-.5),Math.abs(v-.5));
    const bevel=Math.min(u,v)<.07?1.22:Math.max(u,v)>.93?.68:1;
    const glow=ring<.14?1.14:ring<.27?1.05:ring<.4?.97:.9;
    tile[i]=edge<.018?-2:Math.floor(x)+2*Math.floor(z);shade[i]=edge<.018?1:bevel*glow;
    pixels.data[i*4+3]=255;
  }
  const outline=[38,42,49];
  let last=-1;
  function draw(phase,on=true){
    const key=on?phase:'off';
    if(key===last)return false;last=key;
    if(!on)phase=0;
    const dim=on?1:.24,data=pixels.data;
    for(let i=0;i<count;i++){
      const t=tile[i];if(t===-1)continue;
      const color=t===-2?outline:colors[(t+phase)%colors.length],s=shade[i]*dim,o=i*4;
      data[o]=Math.min(255,color[0]*s);data[o+1]=Math.min(255,color[1]*s);data[o+2]=Math.min(255,color[2]*s);
    }
    ctx.putImageData(pixels,0,0);return true;
  }
  draw(0);return {canvas,draw};
}
