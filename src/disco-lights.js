import {DANCE_ROWS} from '../shared/room-layout.js';

// Pixel-art light spots the disco ball throws onto the dance floor. They circle
// the ball's shadow as it spins, twinkle, and fade with the ball when the floor
// is switched off. Drawn additively over the floor lights, under everything else.
const TINTS=[[255,255,255],[255,242,214],[214,236,255]];
const SHAPES=[[4,8,4],[4,10,14,10,4],[6,12,16,18,16,12,6]];
const SPOTS=Array.from({length:22},(_,i)=>({
  radius:.7+((i*7)%11)/11*2.8,angle:i*2.399,shape:i%3,tint:TINTS[(i*5)%3],
  speed:(i%2?1:-1)*(.5+(i%5)/6),twinkle:((i*13)%7)/7*Math.PI*2,
}));
export function createDiscoLights(width){
  const canvas=document.createElement('canvas');
  canvas.width=(width+DANCE_ROWS)*32;canvas.height=(width+DANCE_ROWS)*16;
  const ctx=canvas.getContext('2d');let lastKey='';
  const centre={x:width/2,z:DANCE_ROWS/2};
  const point=(x,z)=>({x:Math.round((x-z)*32+DANCE_ROWS*32),y:Math.round((x+z)*16)});
  return {canvas,draw(now,strength,reducedMotion=false){
    const tick=reducedMotion?0:Math.floor(now/90),level=Math.round(Math.max(0,Math.min(1,strength))*8)/8;
    const key=`${tick}:${level}`;
    if(key===lastKey)return false;lastKey=key;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(level<=0)return true;
    ctx.save();ctx.beginPath();
    for(const [x,z] of [[0,0],[width,0],[width,DANCE_ROWS],[0,DANCE_ROWS]]){const p=point(x,z);ctx.lineTo(p.x,p.y);}
    ctx.clip();
    const t=tick*.09;
    for(const spot of SPOTS){
      const a=spot.angle+t*spot.speed*.3,p=point(centre.x+Math.cos(a)*spot.radius,centre.z+Math.sin(a)*spot.radius*.9);
      const glow=Math.round((.3+.4*(.5+.5*Math.sin(t*2.3+spot.twinkle)))*level*20)/20;
      ctx.fillStyle=`rgba(${spot.tint.join(',')},${glow})`;
      const rows=SHAPES[spot.shape];
      rows.forEach((w,i)=>ctx.fillRect(p.x-w/2,p.y-Math.floor(rows.length/2)+i,w,1));
    }
    ctx.restore();return true;
  }};
}
