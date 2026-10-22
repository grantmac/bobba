// A bounded, pixel-drawn numeric display. Programs supply data, never drawing code or HTML.
const GLYPHS={
  '0':['111','101','101','101','111'],'1':['010','110','010','010','111'],
  '2':['111','001','111','100','111'],'3':['111','001','111','001','111'],
  '4':['101','101','111','001','001'],'5':['111','100','111','001','111'],
  '6':['111','100','111','101','111'],'7':['111','001','010','010','010'],
  '8':['111','101','111','101','111'],'9':['111','101','111','001','111'],
  '-':['000','000','111','000','000'],
};
export function drawProgramDisplay(ctx,width,height,{text,color,corners:p}){
  ctx.save();
  ctx.transform((p[2]-p[0])*width/64,(p[3]-p[1])*height/64,(p[4]-p[0])*width/24,(p[5]-p[1])*height/24,p[0]*width,p[1]*height);
  ctx.beginPath();ctx.rect(0,0,64,24);ctx.clip();ctx.fillStyle=color;
  const scale=Math.floor(Math.min(64/(text.length*4-1),24/5)),left=(64-(text.length*4-1)*scale)/2,top=(24-5*scale)/2;
  for(const [i,char] of [...text].entries())for(const [y,row] of GLYPHS[char].entries())for(let x=0;x<3;x++)if(row[x]==='1')ctx.fillRect(left+(i*4+x)*scale,top+y*scale,scale,scale);
  ctx.restore();
}
// One composite per placed copy; changing one display cannot change other copies or thumbnails.
export function createProgramDisplays(){
  const frames=new Map();
  return {
    frame(id,base,display){
      if(!base||!display){frames.delete(id);return base;}
      const key=JSON.stringify(display),cached=frames.get(id);
      if(cached?.base===base&&cached.key===key)return cached.frame;
      const canvas=document.createElement('canvas');canvas.width=base.canvas.width;canvas.height=base.canvas.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(base.canvas,0,0);ctx.globalCompositeOperation='source-atop';
      drawProgramDisplay(ctx,canvas.width,canvas.height,display);
      const frame={...base,canvas,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
      frames.set(id,{base,key,frame});return frame;
    },
    retain(ids){for(const id of frames.keys())if(!ids.has(id))frames.delete(id);},
  };
}
