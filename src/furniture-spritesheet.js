// Trim each supplied cell at load time so varying transparent padding cannot
// make an animated item jump around its tile anchor.
export function spriteSheetFrames(image,regions,trim=true){
  return regions.map(({x,y,width,height})=>{
    const cell=document.createElement('canvas');cell.width=width;cell.height=height;
    const ctx=cell.getContext('2d');ctx.drawImage(image,x,y,width,height,0,0,width,height);
    if(!trim)return cell;
    const pixels=ctx.getImageData(0,0,width,height).data;
    let left=width,top=height,right=-1,bottom=-1;
    for(let py=0;py<height;py++)for(let px=0;px<width;px++)if(pixels[(py*width+px)*4+3]>8){
      left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
    }
    if(right<left)return cell;
    const trimmed=document.createElement('canvas');trimmed.width=right-left+1;trimmed.height=bottom-top+1;
    trimmed.getContext('2d').drawImage(cell,left,top,trimmed.width,trimmed.height,0,0,trimmed.width,trimmed.height);
    return trimmed;
  });
}
