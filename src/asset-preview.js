import {createFurniture} from './furniture.js';
import {createAppearance} from './appearance.js';
import {prepareImage} from './sprite-image.js';
import {footprint} from '../shared/furniture-model.js';
import {isoPoint} from '../shared/asset-geometry.js';
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
export async function renderAssetPreview(asset){
  const appearance=await createAppearance({prepareImage,onApply(){},onOpen(){}});
  const output=document.createElement('canvas');output.width=1100;output.height=850;
  const ctx=output.getContext('2d');ctx.fillStyle='#e5e5df';ctx.fillRect(0,0,1100,850);ctx.imageSmoothingEnabled=false;
  const views=asset.views.filter(v=>asset.category!=='Wall'||[2,4].includes(v.direction)).sort((a,b)=>[2,4,6,0].indexOf(a.direction)-[2,4,6,0].indexOf(b.direction));
  for(const [index,view] of views.entries()){
    const x0=(index%2)*550,y0=Math.floor(index/2)*425;
    const item={id:'preview',type:asset.id,x:0,z:0,rotation:view.direction,...(asset.category==='Wall'?{u:.5,height:60}:{})},visuals=[];
    const furniture=await createFurniture({prepareImage,initialItems:[item],initialAssets:[asset],worldPoint:isoPoint,isTile:()=>true,hasWall:()=>true,getAvatar:()=>({x:10,z:10}),stopWalking(){},onChanged(){},onSit(){},focusRoom(){},markTiles(){},
      makeVisual(canvas){const mesh={canvas,material:{map:{}},scale:{setScalar(){}}};visuals.push(mesh);return mesh;},disposeVisual(){},positionVisual(mesh,x,y,w,h,order){Object.assign(mesh,{x,y,w,h,order});}});
    await furniture.whenReady();
    const layers=visuals.map(v=>({...v})),seat=furniture.seat(item.id);
    if(seat){const [x,z]=seat.cells[0],p=isoPoint(x+.5,z+.5);layers.push({canvas:await appearance.previewFrame(look,seat.direction,-1,true),x:p.x+seat.offsetX-48,y:p.y+(seat.offsetY??16)-101,w:96,h:112,order:300+(x+z)*10+9.5});}
    const cells=footprint(item,asset),points=cells.flatMap(([x,z])=>[[x,z],[x+1,z],[x,z+1],[x+1,z+1]].map(([x,z])=>isoPoint(x,z)));
    const left=Math.min(...points.map(p=>p.x),...layers.map(l=>l.x))-8,right=Math.max(...points.map(p=>p.x),...layers.map(l=>l.x+l.w))+8;
    const top=Math.min(-115,...layers.map(l=>l.y))-8,bottom=Math.max(...points.map(p=>p.y),...layers.map(l=>l.y+l.h))+8;
    const scale=Math.min(1.4,350/(right-left),325/(bottom-top)),ox=x0+25-left*scale,oy=y0+55-top*scale;
    ctx.fillStyle='#222';ctx.font='bold 18px sans-serif';ctx.fillText(`Rotation ${view.direction}${view.mirror?' · mirrored':''}`,x0+24,y0+28);
    ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
    if(asset.category==='Wall'){
      const sign=view.direction===4?1:-1;ctx.fillStyle='#c8c7bd';ctx.beginPath();[[0,-117],[sign*32,16-117],[sign*32,16],[0,0]].forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();
    }
    function grid(){ctx.lineWidth=1/scale;ctx.strokeStyle='#496c83';ctx.font='10px sans-serif';for(const [x,z] of cells){const p=isoPoint(x,z);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+32,p.y+16);ctx.lineTo(p.x,p.y+32);ctx.lineTo(p.x-32,p.y+16);ctx.closePath();ctx.stroke();ctx.fillStyle='#24425a';ctx.fillText(`${x},${z}`,p.x-8,p.y+20);}}
    grid();layers.sort((a,b)=>a.order-b.order).forEach(l=>ctx.drawImage(l.canvas,l.x,l.y,l.w,l.h));ctx.globalAlpha=.65;grid();ctx.globalAlpha=1;
    if(seat){const [x,z]=seat.cells[0],p=isoPoint(x+.5,z+.5);p.x+=seat.offsetX;p.y+=(seat.offsetY??16)-26;ctx.strokeStyle='#d12164';ctx.lineWidth=2/scale;ctx.beginPath();ctx.moveTo(p.x-6,p.y);ctx.lineTo(p.x+6,p.y);ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x,p.y+6);ctx.stroke();}
    // A standing avatar alongside every view gives a real reference for scale.
    ctx.restore();const standing=await appearance.previewFrame(look,view.direction,-1,false);ctx.drawImage(standing,x0+400,y0+65,96*scale,112*scale);
    ctx.font='12px sans-serif';ctx.fillStyle='#333';ctx.fillText('Avatar at same scale',x0+400,y0+245);
    ctx.fillText(seat?'Pink cross: seat surface · blue: footprint tiles':'Blue: footprint tiles; origin 0,0 is at the back',x0+24,y0+405);
    furniture.disposePrograms();
  }
  return output.toDataURL('image/png');
}
