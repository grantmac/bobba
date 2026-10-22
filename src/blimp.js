// A pixel-art airship in the room's isometric projection, drifting along the x axis
// behind the room with a red neon sign on its near side. Everything is rasterised per
// pixel in a sheared frame (u along the axis, v vertical, screen y = v + u/2), so the
// edges stay crisp. The sprite is drawn once; only the tail beacon blinks.
export function createBlimp({texts=['POOLSIDE FM']}={}){
  const width=224,height=150;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  const cu=96,cv=27,ru=86,rv=25;            // envelope centre and radii in the sheared frame
  const HULL=['#24283d','#30364f','#3f4865','#53607d','#6c7e99','#8fa4b8','#bccbd1'];
  const OUTLINE='#171925';
  // Neon lettering rasterised once, then mapped onto the envelope's side.
  const tail=[cu+ru-2,cv];                   // tail tip in the sheared frame
  const screen=(u,v)=>[u,v+u/2];
  const T=screen(...tail);
  function paint(text){
  const sign=document.createElement('canvas');sign.width=160;sign.height=20;
  const sctx=sign.getContext('2d');sctx.font='bold 11px Verdana,sans-serif';sctx.textAlign='center';sctx.textBaseline='middle';
  const layer=(color,offsets)=>{const c=document.createElement('canvas');c.width=sign.width;c.height=sign.height;const k=c.getContext('2d');k.font=sctx.font;k.textAlign='center';k.textBaseline='middle';k.fillStyle='#fff';for(const [dx,dy] of offsets)k.fillText(text,80+dx,10+dy);return {color,data:k.getImageData(0,0,c.width,c.height).data};};
  const layers=[layer('#ffd6d9',[[0,-1]]),layer('#ff4d5e',[[0,0]]),layer('#b8182f',[[-1,0],[1,0],[0,-1],[0,1]]),layer('#6b1020',[[-2,0],[2,0],[0,-2],[0,2],[-1,-1],[1,1],[-1,1],[1,-1]])];
  const textWidth=Math.ceil(sctx.measureText(text).width),panelW=textWidth+14,panelU=cu-panelW/2,panelV=cv-6;
  const inTriangle=(px,py,[ax,ay],[bx,by],[cx2,cy2])=>{const d1=(px-bx)*(ay-by)-(ax-bx)*(py-by),d2=(px-cx2)*(by-cy2)-(bx-cx2)*(py-cy2),d3=(px-ax)*(cy2-ay)-(cx2-ax)*(py-ay);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));};
  const nearFin=[screen(tail[0]-30,cv+1),[T[0]-32,T[1]+25],[T[0]+7,T[1]+5]];
  const farFin=[screen(tail[0]-28,cv-2),[T[0]+30,T[1]-20],[T[0]+7,T[1]-3]];
  const vFin=[[tail[0]-27,cv-3],[tail[0]+4,cv-27],[tail[0]+7,cv-1]];        // sheared-frame triangle
  const gondola={u1:cu-22,u2:cu+22,vt:cv+rv+1,vb:cv+rv+13};
  const topFace=[[gondola.u1,gondola.vt],[gondola.u2,gondola.vt],[gondola.u2-10,gondola.vt-10],[gondola.u1-10,gondola.vt-10]]; // sheared-frame parallelogram
  const endFace=[[gondola.u1,gondola.vt],[gondola.u1,gondola.vb],[gondola.u1-10,gondola.vb-10],[gondola.u1-10,gondola.vt-10]];
  const inQuad=(u,v,q)=>inTriangle(u,v,q[0],q[1],q[2])||inTriangle(u,v,q[0],q[2],q[3]);
  const image=ctx.createImageData(width,height),data=image.data;
  const put=(i,hex)=>{data[i]=parseInt(hex.slice(1,3),16);data[i+1]=parseInt(hex.slice(3,5),16);data[i+2]=parseInt(hex.slice(5,7),16);data[i+3]=255;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,u=x,v=y-x/2;
    const axial=(u-cu)/ru,vertical=(v-cv)/rv,e=axial**2+vertical**2;
    if(x>=4+panelU&&x<panelU+panelW-4&&v>=panelV-1&&v<panelV+19&&e<=1){
      // Sign panel on the near side, with the neon text sampled from the raster.
      const sx=Math.round(u-panelU-panelW/2+80),sy=Math.round(v-panelV);
      let hex='#252c42';
      for(const {color,data:d} of layers){if(sx>=0&&sx<sign.width&&sy>=0&&sy<sign.height&&d[(sy*sign.width+sx)*4+3]>110){hex=color;break;}}
      if(v<panelV)hex='#8191a5';
      else if(v>=panelV+18)hex='#111421';
      else if(u<panelU+6)hex='#56647d';
      put(i,hex);continue;
    }
    if(inTriangle(x,y,...nearFin)){
      put(i,y>T[1]+18?'#252b40':(y-x/2>cv+5?'#4c5874':'#7789a1'));continue;
    }
    if(inTriangle(u,v,...vFin)){
      put(i,u>tail[0]+1?'#30374f':(v<cv-14?'#91a4b8':'#65768f'));continue;
    }
    if(e<=1){
      const edge=((u-cu)/(ru-1.5))**2+((v-cv)/(rv-1.5))**2>1;
      if(edge){put(i,OUTLINE);continue;}
      const facing=Math.sqrt(Math.max(0,1-e));
      const light=Math.max(0,-axial*.36-vertical*.66+facing*.62);
      const shade=Math.min(HULL.length-1,Math.floor(light*HULL.length));
      const seam=vertical<-.25&&Math.abs(facing*.55+vertical*.83)<.035;
      put(i,HULL[Math.max(0,shade-(seam?1:0))]);continue;
    }
    if(inTriangle(x,y,...farFin)){put(i,y<T[1]-10?'#596780':'#30384f');continue;}
    if(u>=gondola.u1&&u<gondola.u2&&v>=gondola.vt&&v<gondola.vb){
      const window=v>=gondola.vt+3&&v<gondola.vt+8&&((u-gondola.u1-3)%8)<4&&u-gondola.u1>=3&&u<gondola.u2-3;
      const border=u===gondola.u1||u===gondola.u2-1||v>=gondola.vb-1;
      let color=v<gondola.vt+2?'#889aad':'#4b5871';
      if(border)color=OUTLINE;
      if(window)color=v<gondola.vt+5?'#e7f5ee':'#83bdc9';
      put(i,color);continue;
    }
    if(inQuad(u,v,endFace)){put(i,'#323c53');continue;}
    if(inQuad(u,v,topFace)){put(i,'#9caebd');continue;}
  }
  return image;
  }
  const PERIOD=100000,TRAVEL=64000,stills=new Map();
  const still=text=>{if(!stills.has(text))stills.set(text,paint(text));return stills.get(text);};
  const messageAt=now=>texts[Math.floor(now/PERIOD)%texts.length];
  ctx.putImageData(still(texts[0]),0,0);
  let lastBlink=-1,lastText=texts[0];
  return {canvas,width,height,draw(now,reducedMotion=false){
    const blink=reducedMotion?1:Math.floor(now/600)%2,text=messageAt(now);
    if(blink===lastBlink&&text===lastText)return false;lastBlink=blink;lastText=text;
    ctx.putImageData(still(text),0,0);
    ctx.fillStyle=blink?'#ff3b4d':'#5a1420';ctx.fillRect(Math.round(T[0])-1,Math.round(T[1])-2,3,3);
    return true;
  },
  // Flies nose-first along the room's x axis towards the back corner, parallel to the
  // back wall's top edge (which also drops two pixels across for one down), so it stays a
  // fixed height above the walls and never passes over the room. x and y are relative to
  // the room's origin tile; there's a long pause off-screen between crossings.
  position(now,span){
    const t=now%PERIOD;
    if(t>TRAVEL)return null;
    const k=t/TRAVEL,x1=span/2+width,x0=-(span/2+width),x=x1-k*(x1-x0);
    return {x,y:-340+x/2+Math.round(Math.sin(now/1400)*3)};
  }};
}
