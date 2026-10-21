// The games lounge floor: a dark carpet with a faint diagonal weave, plus the two
// open-edge faces, drawn once per room build like the pool deck.
export function createLoungeFloor(width,depth){
  const canvas=document.createElement('canvas');canvas.width=(width+depth)*32;canvas.height=(width+depth)*16+20;
  const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
    const sx=px+.5-depth*32,sy=py+.5,x=sx/64+sy/32,z=sy/32-sx/64;
    let color=null;
    if(x>=0&&x<width&&z>=0&&z<depth){
      const u=x%1,v=z%1,edge=Math.min(u,1-u,v,1-v);
      const weave=((Math.floor(x*8)+Math.floor(z*8))&1)?[46,48,62]:[42,44,57];
      color=edge<.02?[36,38,50]:weave;
      if(Math.min(u,v)<.06)color=color.map(c=>c+5);
    }else{
      // Open faces on the +x and +z sides, matching the pool surround's 19 px drop.
      const downX=sy-(width-sx/64)*32,zEdge=(sy-downX)/32-sx/64;
      if(downX>=0&&downX<19&&zEdge>=0&&zEdge<depth)color=downX<2?[70,74,92]:[46,49,64];
      else{
        const downZ=sy-(depth+sx/64)*32,xEdge=sx/64+(sy-downZ)/32;
        if(downZ>=0&&downZ<19&&xEdge>=0&&xEdge<width)color=downZ<2?[58,61,78]:[36,38,52];
      }
    }
    if(color)data.data.set([...color,255],(py*canvas.width+px)*4);
  }
  ctx.putImageData(data,0,0);return canvas;
}

// The sunken sofa artwork, fitted to the pit by tools/sunken-sofa.py at twice room
// resolution. Its rim's far corner sits 128 px right of and 20 px below the sprite's
// top-left at room scale; the room anchors that on the pit's origin tile.
export function loadSunkenSofa(){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);resolve({canvas,width:image.width/2,height:image.height/2,left:-128,top:-20});};
    image.onerror=()=>reject(new Error('Could not load the sunken sofa.'));image.src='/assets/lounge/sunken-sofa.png';
  });
}
