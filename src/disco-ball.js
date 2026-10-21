import {spriteSheetFrames} from './furniture-spritesheet.js';

export async function createDiscoBall(){
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src='/assets/disco-ball.png';});
  const frames=spriteSheetFrames(image,Array.from({length:4},(_,i)=>({x:i*543,y:0,width:543,height:724})));
  const canvas=document.createElement('canvas');canvas.width=162;canvas.height=240;
  const ctx=canvas.getContext('2d');let progress=0,lastTime=null,lastKey='';
  return {canvas,width:54,height:80,get progress(){return progress;},draw(now,on,reducedMotion=false){
    const elapsed=lastTime===null?0:Math.min(100,Math.max(0,now-lastTime));lastTime=now;
    progress=reducedMotion?Number(on):Math.max(0,Math.min(1,progress+(on?1:-1)*elapsed/1400));
    const eased=progress*progress*(3-2*progress),y=Math.round((eased-1)*canvas.height);
    const phase=reducedMotion||progress===0?0:Math.floor(now/180)%frames.length,key=`${y}:${phase}`;
    if(key===lastKey)return false;lastKey=key;ctx.clearRect(0,0,canvas.width,canvas.height);
    // Clip at the ceiling anchor as the ball lowers or retracts.
    if(progress>0)ctx.drawImage(frames[phase],0,y,canvas.width,canvas.height);
    return true;
  }};
}
