// Remove only exterior white pixels. White inside outlined sprite shapes must
// remain opaque so the original grayscale avatar masks can receive a tint.
export function prepareImage(image, { tint='#ffffff', polygon, matte=false, paletteMap }={}) {
  const canvas = document.createElement('canvas');
  canvas.width=image.width; canvas.height=image.height;
  const ctx=canvas.getContext('2d', { willReadFrequently:true });
  ctx.drawImage(image,0,0);
  if (polygon) {
    ctx.globalCompositeOperation='destination-in';
    ctx.beginPath();polygon.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.closePath();ctx.fill();ctx.globalCompositeOperation='source-over';
  }
  const frame=ctx.getImageData(0,0,canvas.width,canvas.height), pixels=frame.data;
  if (matte) {
    const w=canvas.width,h=canvas.height,visited=new Uint8Array(w*h),queue=[];
    const push=(x,y)=>{
      if(x<0||y<0||x>=w||y>=h)return;
      const index=y*w+x,p=index*4;
      if(visited[index])return;
      visited[index]=1;
      if(pixels[p]>=250&&pixels[p+1]>=250&&pixels[p+2]>=250){pixels[p+3]=0;queue.push(index);}
    };
    for(let x=0;x<w;x++){push(x,0);push(x,h-1);}
    for(let y=0;y<h;y++){push(0,y);push(w-1,y);}
    for(let i=0;i<queue.length;i++){const x=queue[i]%w,y=Math.floor(queue[i]/w);push(x-1,y);push(x+1,y);push(x,y-1);push(x,y+1);}
  }
  const rgb=tint.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255);
  for(let i=0;i<pixels.length;i+=4){const mapped=paletteMap?.get(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);if(mapped){pixels[i]=mapped[0];pixels[i+1]=mapped[1];pixels[i+2]=mapped[2];}pixels[i]*=rgb[0];pixels[i+1]*=rgb[1];pixels[i+2]*=rgb[2];}
  ctx.putImageData(frame,0,0);
  return canvas;
}
