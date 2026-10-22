// The active hh_room Room Component creates Balloon Manager (not the older
// hh_room_utils Chat Display). Its defaults are 7 bubbles, a 21px step,
// 4000ms idle scroll, 400 characters, and a bottom registration point at 125.
export function createChat({getSpeaker,getLayout,onSelectSpeaker}){
  const layer=document.createElement('div');layer.className='chat-bubbles';layer.setAttribute('role','log');layer.setAttribute('aria-label','Room chat');layer.setAttribute('aria-live','polite');layer.setAttribute('aria-relevant','additions');document.body.append(layer);
  let bubbles=[],nextScroll=Infinity,lastLayout={};
  const typingBubbles=new Map();
  function removeTyping(id){typingBubbles.get(id)?.remove();typingBubbles.delete(id);}
  function typing(id,name,active,x,y){
    if(!active){removeTyping(id);return;}
    let element=typingBubbles.get(id);
    if(!element){
      element=document.createElement('div');element.className='typing-bubble';element.setAttribute('role','img');element.setAttribute('aria-label',`${name} is typing`);
      element.innerHTML='<i></i><i></i><i></i>';layer.append(element);typingBubbles.set(id,element);
    }
    const left=`${Math.round(x)}px`,top=`${Math.round(y)}px`;
    if(element.style.left!==left)element.style.left=left;
    if(element.style.top!==top)element.style.top=top;
  }
  // Camera movement updates the head anchor immediately. Message scrolling uses a separate
  // CSS transform so its animation never delays panning or zooming. Keep subpixel coordinates
  // from the renderer: rounding to CSS pixels makes bubbles wobble on high-density displays.
  function position(layout=getLayout()){
    let ceiling=Infinity;
    for(let i=bubbles.length-1;i>=0;i--){
      const item=bubbles[i],width=item.element.offsetWidth,height=item.element.offsetHeight;
      const head=layout.originY+(item.y-layout.centerY-96)*layout.scale;
      // Lay out newest to oldest so wrapped text and speakers at different depths
      // cannot collide. Expiry still uses scroll ticks, not the resulting height.
      const bottom=Math.min(head-item.offset,ceiling);
      const left=Math.max(width/2+6,Math.min(innerWidth-width/2-6,layout.originX+item.x*layout.scale));
      item.element.style.left=`${left}px`;item.element.style.top=`${head}px`;
      item.element.style.setProperty('--chat-rise',`${head-bottom}px`);
      ceiling=bottom-height-2;
    }
  }
  function scroll(){
    for(const item of bubbles)item.offset+=21;
    bubbles=bubbles.filter(item=>{if(item.offset>=147){item.element.remove();return false;}return true;});
  }
  function say(message,mode='Say',source){
    const text=message.trim().slice(0,400);if(!text)return;
    const speaker=source||getSpeaker();
    scroll();
    if(bubbles.length>=7)bubbles.shift().element.remove();
    const element=document.createElement('button');element.type='button';element.className='chat-bubble';element.dataset.mode=mode;element.title=`${speaker.name}: ${text}`;element.style.setProperty('--speaker-color',speaker.color);
    const name=document.createElement('strong');name.textContent=speaker.name+':';const words=document.createElement('span');words.textContent=' '+text;element.append(name,words);element.onclick=()=>onSelectSpeaker(speaker);
    const item={element,x:speaker.x,y:speaker.y??0,offset:0};layer.append(element);bubbles.push(item);position();
    nextScroll=performance.now()+4000;
  }
  window.addEventListener('resize',()=>position());
  return {say,typing,removeTyping,update(now){
    const layout=getLayout();
    if(layout.originX!==lastLayout.originX||layout.originY!==lastLayout.originY||layout.scale!==lastLayout.scale||layout.centerY!==lastLayout.centerY){lastLayout={...layout};position(layout);}
    if(bubbles.length&&now>=nextScroll){scroll();position(layout);nextScroll=now+4000;}
  }};
}
