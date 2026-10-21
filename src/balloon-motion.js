// The original number-one balloon ends in a straight, one-pixel string.
// Move its envelope intact and bend the string back to its original anchor.
export function createBalloonMotion(source){
  const paddingX=4,paddingY=2,knotX=20,knotY=62;
  const canvas=document.createElement('canvas');canvas.width=source.width+paddingX*2;canvas.height=source.height+paddingY*2;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  let previous='';
  function draw(now,reducedMotion=false){
    const x=reducedMotion?0:Math.round(Math.sin(now/1800)*2);
    const y=reducedMotion?0:Math.round(Math.sin(now/1300+.4));
    const bend=reducedMotion?0:Math.round(Math.sin(now/2300));
    const key=`${x}:${y}:${bend}`;if(key===previous)return false;previous=key;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,0,0,source.width,knotY,paddingX+x,paddingY+y,source.width,knotY);
    const start=knotY+y,end=source.height-1;
    for(let row=start;row<=end;row++){
      const t=(end-row)/(end-start),sway=Math.round(x*t+bend*4*t*(1-t));
      const sourceRow=Math.round(knotY+(1-t)*(end-knotY));
      ctx.drawImage(source,knotX,sourceRow,1,1,paddingX+knotX+sway,paddingY+row,1,1);
    }
    return true;
  }
  draw(0,true);
  return {canvas,paddingX,paddingY,draw};
}
