// Advance from the room's animation loop so speed is independent of frame rate.
export function installEdgeNavigation(canvas,{enabled,pan}){
  const desktop=matchMedia('(hover: hover) and (pointer: fine)');
  let pointer=null,since=null,last=null;
  const reset=()=>{pointer=null;since=null;last=null;};
  window.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||event.buttons||event.target!==canvas){reset();return;}
    pointer={x:event.clientX,y:event.clientY,event};
  },true);
  window.addEventListener('pointerdown',reset,true);
  window.addEventListener('pointercancel',reset,true);
  window.addEventListener('blur',reset);
  document.addEventListener('visibilitychange',reset);
  canvas.addEventListener('pointerleave',reset);
  return now=>{
    if(!pointer)return;
    const typing=document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    if(!desktop.matches||!enabled()||document.hidden||typing||document.querySelector('dialog[open]')||document.elementFromPoint(pointer.x,pointer.y)!==canvas){reset();return;}
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=640){reset();return;}
    const band=80;
    const axis=(p,start,end)=>p<start||p>end?0:p<start+band?(start+band-p)/band:p>end-band?-(p-end+band)/band:0;
    let x=axis(pointer.x,rect.left,rect.right),y=axis(pointer.y,rect.top,rect.bottom);
    if(!x&&!y){since=null;last=null;return;}
    if(since===null)since=now;
    const elapsed=last===null?0:Math.min(50,Math.max(0,now-last));last=now;
    if(now-since<200)return;
    const length=Math.max(1,Math.hypot(x,y));
    pan(x/length*720*elapsed/1000,y/length*720*elapsed/1000,pointer.event);
  };
}
