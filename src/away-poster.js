export function createAwayPoster(){
  const canvas=document.createElement('canvas');canvas.width=34;canvas.height=58;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.transform(1,-0.5,0,1,1,17);
  ctx.fillStyle='#29251e';ctx.fillRect(0,0,31,40);
  ctx.fillStyle='#fff5d6';ctx.fillRect(1,1,29,38);
  ctx.fillStyle='#d8cba8';ctx.fillRect(2,37,27,1);
  ctx.fillStyle='#322b25';
  const letters=['110101110101110','110101110101101','110101110101110'];
  letters.forEach((letter,i)=>[...letter].forEach((pixel,j)=>{
    if(pixel==='1')ctx.fillRect(4+i*8+(j%3)*2,14+Math.floor(j/3)*2,2,2);
  }));
  ctx.fillRect(14,3,2,2);
  return canvas;
}
