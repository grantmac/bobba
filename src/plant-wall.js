// A living wall of pixel-art foliage closing off the open back edge of the pool
// deck. It is shaped like the room's right-hand wall: 116 px tall, sloping 16 px
// per tile. Built in layers: a dark backing of small leaves, mid-sized leaves,
// clustered foreground plants with outlined leaves, trailing vines from the top,
// a few flowers, and a shadowed base where it meets the deck.
const GREENS=[[34,74,40],[46,98,48],[62,124,56],[86,150,66],[112,176,80],[150,196,96]];
// Leaf shapes as rows of [offset,width] pixels.
const SMALL=[[0,2],[0,2]];
const OVAL=[[1,3],[0,5],[1,3]];
const SLANT=[[2,3],[1,3],[0,3]];
const BIG=[[2,3],[1,5],[0,7],[1,5],[2,3]];
const BROAD=[[1,4],[0,6],[0,6],[1,4]];
export function createPlantWall(tiles){
  const width=tiles*32,height=16*tiles+117,pad=6;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+pad;
  const ctx=canvas.getContext('2d');ctx.translate(0,pad);
  let seed=29;const rand=()=>(seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const pick=list=>list[Math.floor(rand()*list.length)];
  const top=px=>px/2;
  const rgb=(c,delta=0)=>`rgb(${c.map(v=>Math.max(0,Math.min(255,v+delta))).join(',')})`;
  // Light falls from above: the lower the leaf on the wall, the darker it is drawn.
  const lit=(color,py,px)=>{const depth=(py-top(px))/116;return color.map(v=>Math.round(v*(1.1-.38*depth)));};
  function leaf(shape,px,py,color,{outline=false,rib=false}={}){
    const tone=lit(color,py,px);
    if(outline)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])shape.forEach(([o,w],r)=>{ctx.fillStyle=rgb(tone,-34);ctx.fillRect(px+o+dx,py+r+dy,w,1);});
    shape.forEach(([o,w],r)=>{
      ctx.fillStyle=rgb(tone,r===0?18:r===shape.length-1?-16:0);ctx.fillRect(px+o,py+r,w,1);
    });
    if(rib){const r=Math.floor(shape.length/2),[o,w]=shape[r];ctx.fillStyle=rgb(tone,30);ctx.fillRect(px+o+1,py+r,Math.max(1,w-2),1);}
  }
  ctx.save();
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(width,16*tiles);ctx.lineTo(width,16*tiles+116);ctx.lineTo(0,116);ctx.closePath();ctx.clip();
  ctx.fillStyle='#17301a';ctx.fillRect(0,-pad,width,height+pad);
  // Backing: dense small dark leaves.
  for(let i=0;i<tiles*520;i++){const px=Math.floor(rand()*width),py=Math.floor(top(px)+rand()*116);leaf(SMALL,px,py,GREENS[Math.floor(rand()*2)]);}
  // Middle: scattered medium leaves.
  for(let i=0;i<tiles*170;i++){const px=Math.floor(rand()*width),py=Math.floor(top(px)+rand()*116);leaf(rand()<.5?OVAL:SLANT,px,py,GREENS[1+Math.floor(rand()*3)]);}
  // Foreground: clustered plants of large outlined leaves, each cluster one species tone.
  for(let c=0;c<tiles*4;c++){
    const cx=8+rand()*(width-16),cy=top(cx)+10+rand()*90,shape=rand()<.5?BIG:BROAD,base=GREENS[2+Math.floor(rand()*3)];
    const tint=rand()<.2?[base[0]+40,base[1]+20,base[2]-10]:base; // the odd yellow-green plant
    const count=6+Math.floor(rand()*6);
    for(let i=0;i<count;i++){
      const angle=rand()*Math.PI*2,radius=rand()*11;
      leaf(shape,Math.round(cx+Math.cos(angle)*radius-3),Math.round(cy+Math.sin(angle)*radius*.7-2),tint,{outline:true,rib:true});
    }
  }
  // Trailing vines hang from the top, swaying slightly, with paired leaves.
  for(let v=0;v<tiles*5;v++){
    let px=4+Math.floor(rand()*(width-8));const length=28+rand()*62,start=top(px),tone=GREENS[2+Math.floor(rand()*2)];
    for(let y=0;y<length;y++){
      if(y%9===0)px+=Math.round(rand()*2-1);
      ctx.fillStyle=rgb(lit([40,86,44],start+y,px));ctx.fillRect(px,Math.floor(start+y),1,1);
      if(y%6===3)leaf(SLANT,px+(y%12===3?1:-3),Math.floor(start+y)-1,tone);
    }
  }
  // Flowers: tiny pink and white clusters.
  for(let i=0;i<tiles*4;i++){
    const px=4+Math.floor(rand()*(width-8)),py=Math.floor(top(px)+8+rand()*96),color=rand()<.5?'#f2a9c9':'#f6f1dc';
    ctx.fillStyle=color;ctx.fillRect(px,py,2,2);ctx.fillRect(px+3,py+1,1,1);ctx.fillRect(px-1,py+2,1,1);
    ctx.fillStyle='#f7df6a';ctx.fillRect(px+1,py+1,1,1);
  }
  // Shadow where the wall meets the deck, and a dark line under the top edge.
  ctx.fillStyle='rgba(10,26,12,.55)';ctx.beginPath();ctx.moveTo(0,106);ctx.lineTo(width,16*tiles+106);ctx.lineTo(width,16*tiles+116);ctx.lineTo(0,116);ctx.closePath();ctx.fill();
  ctx.restore();
  // A ragged fringe of leaves breaks the straight top edge.
  for(let i=0;i<tiles*30;i++){
    const px=3+Math.floor(rand()*(width-8)),py=Math.floor(top(px))-1-Math.floor(rand()*4);
    leaf(rand()<.6?SLANT:OVAL,px,py,GREENS[3+Math.floor(rand()*3)]);
  }
  return canvas;
}
