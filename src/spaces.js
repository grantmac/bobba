// Player-added spaces: blocks of floor chained along the back wall past the lounge. Each is
// drawn once per room build from the same prepared floor texture as the main room, with the
// two open faces (+x and +z) dropped 19 px like the pool surround and the lounge carpet.
const FACE=19;
// Sample the room's prepared floor tile at a room coordinate; wood gets the main floor's per-plank
// tone and grain streaks so an added wood floor matches the room's.
export function floorSampler(floorImage,wood){
  const pixels=floorImage.getContext('2d').getImageData(0,0,floorImage.width,floorImage.height).data,width=floorImage.width;
  const plain=pixels.slice((20*width+65)*4,(20*width+65)*4+3);
  return (x,z)=>{
    const u=((x%2)+2)%2,v=((z%2)+2)%2,from=(Math.floor((u+v)*16)*width+Math.floor(65+(u-v)*32))*4;
    let factor=1;
    if(wood&&pixels[from]===plain[0]&&pixels[from+1]===plain[1]&&pixels[from+2]===plain[2]){
      const plank=Math.floor(z*2),section=Math.floor((x+(plank%2)*.5)/1.5);
      const grain=Math.sin(x*3.1+plank*2.3)*Math.sin(z*97+x*1.7+section);
      factor=(1+(((plank*7+section*13)%5)-2)*.022)*(grain>.72?1.05:grain<-.76?.93:1);
    }
    return [Math.min(255,pixels[from]*factor),Math.min(255,pixels[from+1]*factor),Math.min(255,pixels[from+2]*factor)];
  };
}
const shade=(color,factor)=>color.map(c=>Math.max(0,Math.min(255,Math.round(c*factor))));
export function createSpaceFloor(width,depth,sample){
  const canvas=document.createElement('canvas');canvas.width=(width+depth)*32;canvas.height=(width+depth)*16+FACE+1;
  const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
    const sx=px+.5-depth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    let color=null;
    if(x>=0&&x<width&&z>=0&&z<depth)color=sample(x,z);
    else{
      const downX=sy-(width-sx/64)*32,zEdge=(sy-downX)/32-sx/64;
      if(downX>=0&&downX<FACE&&zEdge>=0&&zEdge<depth)color=shade(sample(width-.01,zEdge),downX<2?.95:.62);
      else{
        const downZ=sy-(depth+sx/64)*32,xEdge=sx/64+(sy-downZ)/32;
        if(downZ>=0&&downZ<FACE&&xEdge>=0&&xEdge<width)color=shade(sample(xEdge,depth-.01),downZ<2?.85:.48);
      }
    }
    if(color)data.data.set([color[0],color[1],color[2],255],(py*canvas.width+px)*4);
  }
  ctx.putImageData(data,0,0);return canvas;
}
// Steel tread plates with inset seams, raised grips and bolted edge channels.
export function createMetalWalkway(width,depth){
  return createSpaceFloor(width,depth,(x,z)=>{
    const u=Math.floor(x*32)%32,v=Math.floor(z*32),back=depth*32-1;
    if(v===0)return [187,198,204];
    if(v===1||v===back)return [77,90,100];
    if(v===back-1)return [164,178,187];
    if(u===0)return [52,64,73];
    if(u===1)return [163,177,185];
    if(v<5||v>back-5){
      const row=v<5?v:back-v;
      if((u===5||u===27)&&row===3)return [44,56,64];
      if((u===4||u===26)&&row===2)return [206,215,220];
      return [112,128,139];
    }
    const a=u%8,b=v%8,diagonal=(Math.floor(u/8)+Math.floor(v/8))%2?a+b-7:b-a;
    if(a>=2&&a<=5){
      if(diagonal===0)return [182,194,202];
      if(diagonal===1)return [66,80,91];
    }
    const tone=Math.floor(x)%2?0:5,brush=v%4===0?3:0;
    return [116+tone+brush,132+tone+brush,143+tone+brush];
  });
}
// An uploaded picture's pixels, scaled down with smoothing when it is bigger than the area it will
// cover (so photos do not sparkle), left crisp when it is smaller. Null if the browser cannot read it.
export function picturePixels(image,maxWidth,maxHeight){
  const scale=Math.min(1,maxWidth/image.width,maxHeight/image.height);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=scale<1;ctx.drawImage(image,0,0,canvas.width,canvas.height);
  try{return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};}catch{return null;}
}
// Lay a picture over a floor sampler: 'tile' repeats it on every tile, 'cover' stretches one copy
// over the whole space. Transparent pixels let the finish beneath show through.
export function pictureSampler(base,picture,fit,width,depth){
  if(!picture)return base;
  const {data,width:w,height:h}=picture;
  return (x,z)=>{
    const u=fit==='cover'?x/width:((x%1)+1)%1,v=fit==='cover'?z/depth:((z%1)+1)%1;
    const i=(Math.min(h-1,Math.floor(v*h))*w+Math.min(w-1,Math.floor(u*w)))*4,a=data[i+3]/255;
    if(a>=1)return [data[i],data[i+1],data[i+2]];
    const under=base(x,z);return [data[i]*a+under[0]*(1-a),data[i+1]*a+under[1]*(1-a),data[i+2]*a+under[2]*(1-a)];
  };
}
// One 32 px segment of a space's back wall: the wallpaper, then the picture skewed onto the wall
// face, whose top edge drops 16 px across the segment. 'tile' fits one copy per segment, 'cover'
// spreads one copy across the space's whole wall (segment `index` of `count`).
export function wallSegment(base,picture,fit,index,count){
  const canvas=document.createElement('canvas');canvas.width=base.width;canvas.height=base.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(base,0,0);
  const slice=fit==='cover'?picture.width/count:picture.width,sx=fit==='cover'?index*slice:0;
  ctx.setTransform(1,.5,0,1,0,0);ctx.imageSmoothingEnabled=slice>32||picture.height>117;
  ctx.drawImage(picture,sx,0,slice,picture.height,0,0,32,117);
  return canvas;
}
