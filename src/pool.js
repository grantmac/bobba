export async function loadPoolAssets(){
  const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});
  const [water,ladder]=await Promise.all([load('/assets/pool/lido-water.png'),load('/assets/pool/lido-ladder.png')]);
  return {water,ladder};
}
export function createPool(depth,{water,ladder}){
  const width=5,canvas=document.createElement('canvas');canvas.width=(width+depth)*32;canvas.height=(width+depth)*16+20;
  const ctx=canvas.getContext('2d'),point=(x,z,drop=0)=>[(x-z)*32+depth*32,(x+z)*16+drop];
  function path(points){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
  function polygon(points,color){path(points);ctx.fillStyle=color;ctx.fill();}
  const hole=[point(1.2,1),point(3.8,1),point(4,1.2),point(4,depth-1.2),point(3.8,depth-1),point(1.2,depth-1),point(1,depth-1.2),point(1,1.2)];let last=-1;
  return {canvas,left:-depth*32,draw(phase=0){
    if(last===phase)return false;last=phase;ctx.clearRect(0,0,canvas.width,canvas.height);
    // A shallow tiled surround, built at the same height as the main floor.
    polygon([point(5,0),point(5,depth),point(5,depth,19),point(5,0,19)],'#6d828a');
    polygon([point(0,depth),point(5,depth),point(5,depth,19),point(0,depth,19)],'#4c626c');
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let py=0;py<(width+depth)*16;py++)for(let px=0;px<canvas.width;px++){
      const sx=px+.5-depth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
      if(x<0||x>=width||z<0||z>=depth)continue;
      const edge=Math.min(x%1,1-x%1,z%1,1-z%1),color=edge<.016?[144,166,175]:(Math.floor(x)+Math.floor(z))%2?[214,228,233]:[228,239,242];
      const i=(py*canvas.width+px)*4;pixels.data.set([...color,255],i);
    }
    ctx.putImageData(pixels,0,0);
    polygon(hole,'#8bbad6');
    // Recessed white-blue ceramic bed and the pool's inner walls.
    ctx.save();path(hole);ctx.clip();
    polygon(hole.map(([x,y])=>[x,y+20]),'#c9eaf3');
    ctx.strokeStyle='#82bbd1';ctx.lineWidth=1;
    for(let x=1;x<=4;x+=.25){ctx.beginPath();ctx.moveTo(...point(x,1,20));ctx.lineTo(...point(x,depth-1,20));ctx.stroke();}
    for(let z=1;z<=depth-1;z+=.25){ctx.beginPath();ctx.moveTo(...point(1,z,20));ctx.lineTo(...point(4,z,20));ctx.stroke();}
    polygon([point(1,1),point(4,1),point(4,1,20),point(1,1,20)],'#73a5cd');
    polygon([point(1,1),point(1,depth-1),point(1,depth-1,20),point(1,1,20)],'#5085b0');
    polygon([point(1,1,10),point(4,1,10),point(4,1.35,10),point(1,1.35,10)],'#c1e5e9');
    polygon([point(1,1,10),point(1.35,1,10),point(1.35,depth-1,10),point(1,depth-1,10)],'#a7d5e4');
    ctx.restore();
    const waterline=hole.map(([x,y])=>[x,y+7]);
    ctx.save();path(hole);ctx.clip();path(waterline);ctx.clip();
    ctx.globalAlpha=.33;ctx.drawImage(water,0,0,canvas.width,canvas.height);ctx.globalAlpha=1;
    ctx.strokeStyle='#a8e1e7';ctx.lineWidth=1;
    for(let i=0;i<9;i++){
      const x=1.4+(i%3)*.9,z=1.35+Math.floor(i/3)*(depth-2)/3,offset=((phase+i)%6)*.15;
      ctx.beginPath();ctx.moveTo(...point(x-.13,z+offset,7));ctx.lineTo(...point(x+.13,z+offset,7));ctx.stroke();
    }
    // Four clusters of small white bubbles give the hot tub its active jets.
    for(const [jx,jz] of [[1.6,1.6],[3.4,1.6],[1.6,3.4],[3.4,3.4]])for(let i=0;i<6;i++){
      const angle=(i/6)*Math.PI*2+phase*.4,radius=.12+((phase+i)%4)*.035,[x,y]=point(jx+Math.cos(angle)*radius,jz+Math.sin(angle)*radius,7);
      ctx.strokeStyle=i%2?'#ecffff':'#c6f1f3';ctx.beginPath();ctx.ellipse(Math.round(x),Math.round(y),1.5,1,0,0,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
    // Thin white coping follows the opening, with the original Lido ladder.
    ctx.lineJoin='round';ctx.strokeStyle='#647c85';ctx.lineWidth=9;path(hole);ctx.stroke();
    ctx.strokeStyle='#f5f7ee';ctx.lineWidth=6;path(hole);ctx.stroke();
    const [lx,ly]=point(1,Math.min(depth-1.5,2));ctx.drawImage(ladder,Math.round(lx)-10,Math.round(ly)-21);
    return true;
  }};
}

export function createWoodDeck(width,depth){
  const canvas=document.createElement('canvas');canvas.width=(width+depth)*32;canvas.height=(width+depth)*16+20;
  const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
    const sx=px+.5-depth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    let color;
    if(x>=0&&x<width&&z>=0&&z<depth){
      const board=Math.floor(x*2),edge=x*2%1<.035||((z+(board%2))%2<.025);
      color=edge?[81,52,34]:[[143,100,64],[153,110,72],[134,92,58],[160,116,77]][board%4];
      if(!edge&&Math.sin((z*120+board*31))>.93)color=color.map(v=>v-9);
    }else{
      const across=sx/64+(sy-18)/32;
      if(x>=width&&across<width&&z>=0&&z<depth)color=[90,61,42];
    }
    if(color)data.data.set([...color,255],(py*canvas.width+px)*4);
  }
  ctx.putImageData(data,0,0);return canvas;
}
