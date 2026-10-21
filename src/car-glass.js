// Apply window translucency while loading; keep the supplied artwork unchanged.
export function prepareCarGlass(canvas){
  const ctx=canvas.getContext('2d'),image=ctx.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
  const width=canvas.width,mask=new Uint8Array(width*canvas.height);
  for(let i=0;i<mask.length;i++){
    const at=i*4,r=pixels[at],b=pixels[at+2];
    if(pixels[at+3]>100&&b-r>=12&&b>=50&&r<=140)mask[i]=1;
  }
  for(let start=0;start<mask.length;start++){
    if(mask[start]!==1)continue;
    const pane=[],queue=[start];mask[start]=2;
    while(queue.length){
      const i=queue.pop();pane.push(i);
      const neighbors=[i-width,i+width];
      if(i%width)neighbors.push(i-1);
      if(i%width<width-1)neighbors.push(i+1);
      for(const next of neighbors)if(next>=0&&next<mask.length&&mask[next]===1){mask[next]=2;queue.push(next);}
    }
    // Small blue highlights on the body and wheels remain opaque.
    if(pane.length>=300)for(const i of pane)pixels[i*4+3]=Math.round(pixels[i*4+3]*.5);
  }
  ctx.putImageData(image,0,0);return canvas;
}
