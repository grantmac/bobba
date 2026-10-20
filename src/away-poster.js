export function createAwayPoster(){
  const canvas=document.createElement('canvas');canvas.width=44;canvas.height=72;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  ctx.transform(1,-0.5,0,1,1,22);
  ctx.fillStyle='#29251e';ctx.fillRect(0,0,41,49);
  ctx.fillStyle='#fff5d6';ctx.fillRect(1,1,39,47);
  ctx.fillStyle='#d8cba8';ctx.fillRect(2,46,37,1);
  ctx.fillStyle='#322b25';
  const glyphs={
    G:['01110','10001','10000','10111','10001','10001','01110'],
    R:['11110','10001','10001','11110','10100','10010','10001'],
    A:['01110','10001','10001','11111','10001','10001','10001'],
    N:['10001','11001','11001','10101','10011','10011','10001'],
    T:['11111','00100','00100','00100','00100','00100','00100'],
    W:['10001','10001','10001','10101','10101','11011','10001'],
    I:['11111','00100','00100','00100','00100','00100','11111'],
    L:['10000','10000','10000','10000','10000','10000','11111'],
    B:['11110','10001','10001','11110','10001','10001','11110']
  };
  ['GRANT','WILL','BRB'].forEach((word,line)=>{
    const left=Math.floor((41-(word.length*6-1))/2);
    [...word].forEach((letter,i)=>glyphs[letter].forEach((row,y)=>[...row].forEach((pixel,x)=>{
      if(pixel==='1')ctx.fillRect(left+i*6+x,10+line*12+y,1,1);
    })));
  });
  ctx.fillRect(20,3,2,2);
  return canvas;
}
