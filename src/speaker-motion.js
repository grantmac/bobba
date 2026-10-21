// The two woofers move inside their fixed rims; the cabinet and mount are untouched.
export function createSpeakerMotion(source,direction){
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  const ctx=canvas.getContext('2d');
  const cones=direction===2?[[68,124],[117,108]]:[[28,105],[77,126]];
  let previous=-1;
  function draw(now,playing=false,reducedMotion=false){
    const phase=playing&&!reducedMotion?Math.round(Math.max(0,Math.sin(now/75))*3):0;
    if(phase===previous)return false;previous=phase;
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
    if(phase){
      ctx.save();ctx.scale(canvas.width/144,canvas.height/207);
      for(const [x,y] of cones){
        ctx.save();ctx.beginPath();ctx.ellipse(x,y,15,20,direction===2?.35:-.35,0,Math.PI*2);ctx.clip();
        ctx.translate(x,y);ctx.scale(1+phase*.025,1+phase*.025);ctx.translate(-x,-y);
        ctx.drawImage(source,0,0,144,207);ctx.restore();
      }
      ctx.restore();
    }
    return true;
  }
  draw(0);
  return {canvas,draw};
}
