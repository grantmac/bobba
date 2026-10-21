export function pinchView(view,previous,next,origin){
  const zoom=Math.max(.75,Math.min(4,view.zoom*next.distance/Math.max(1,previous.distance))),ratio=zoom/view.zoom;
  return {zoom,panX:next.x-origin.x-(previous.x-origin.x-view.panX)*ratio,panY:next.y-origin.y-(previous.y-origin.y-view.panY)*ratio};
}
export function installTouchNavigation(element,{getView,setView,cancelTap}){
  const touches=new Map();let dragged=false,start=null;
  const point=e=>({x:e.clientX,y:e.clientY});
  const pair=()=>{
    const [a,b]=[...touches.values()];
    return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};
  };
  element.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch'&&(e.pointerType!=='mouse'||e.button!==0))return;
    if(!touches.size){dragged=false;start=point(e);}
    touches.set(e.pointerId,point(e));element.setPointerCapture(e.pointerId);
    if(touches.size>1){dragged=true;cancelTap();e.stopImmediatePropagation();}
  },true);
  element.addEventListener('pointermove',e=>{
    if(!touches.has(e.pointerId))return;
    const old=touches.get(e.pointerId),before=touches.size>=2?pair():null;touches.set(e.pointerId,point(e));
    if(touches.size>=2){
      const rect=element.getBoundingClientRect();
      setView(pinchView(getView(),before,pair(),{x:rect.left+rect.width/2,y:rect.top+rect.height/2}));
      dragged=true;
    }else if(dragged||Math.hypot(e.clientX-start.x,e.clientY-start.y)>8){
      const view=getView(),from=dragged?old:start;setView({...view,panX:view.panX+e.clientX-from.x,panY:view.panY+e.clientY-from.y});dragged=true;
    }
    if(dragged){if(element.style)element.style.cursor='grabbing';cancelTap();e.preventDefault();e.stopImmediatePropagation();}
  },{capture:true,passive:false});
  const end=e=>{
    if(!touches.has(e.pointerId))return;
    touches.delete(e.pointerId);
    if(dragged||e.type==='pointercancel'||e.type==='lostpointercapture'){cancelTap();e.stopImmediatePropagation();}
    if(!touches.size){dragged=false;start=null;if(element.style)element.style.cursor='';}
  };
  element.addEventListener('pointerup',end,true);element.addEventListener('pointercancel',end,true);
  element.addEventListener('lostpointercapture',end,true);
}
