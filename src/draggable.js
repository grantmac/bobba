// Lets a floating window be dragged by its title bar, mouse or touch. On the first drag
// the window switches from its CSS anchoring (centred, or pinned to a corner) to explicit
// left/top so it can go anywhere, clamped so the bar never leaves the screen.
export function makeDraggable(panel,handle=panel.querySelector('header')){
  if(!handle)return;
  let start=null;
  handle.style.cursor='move';
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0&&event.pointerType==='mouse')return;
    if(event.target.closest('button,input,select,textarea,a'))return;
    const rect=panel.getBoundingClientRect();
    panel.style.left=`${rect.left}px`;panel.style.top=`${rect.top}px`;panel.style.right='auto';panel.style.bottom='auto';panel.style.transform='none';panel.style.margin='0';
    start={x:event.clientX-rect.left,y:event.clientY-rect.top,w:rect.width,h:handle.getBoundingClientRect().height};
    handle.setPointerCapture(event.pointerId);event.preventDefault();
  });
  handle.addEventListener('pointermove',event=>{
    if(!start)return;
    const left=Math.max(8-start.w+40,Math.min(window.innerWidth-40,event.clientX-start.x)),top=Math.max(0,Math.min(window.innerHeight-start.h,event.clientY-start.y));
    panel.style.left=`${Math.round(left)}px`;panel.style.top=`${Math.round(top)}px`;
  });
  const end=()=>{start=null;};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
}
