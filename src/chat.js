// The active hh_room Room Component creates Balloon Manager (not the older
// hh_room_utils Chat Display). Its defaults are 7 bubbles, a 21px step,
// 4000ms idle scroll, 400 characters, and a bottom registration point at 125.
export function createChat({getSpeaker,onSelectSpeaker}){
  const layer=document.createElement('div');layer.className='chat-bubbles';document.body.append(layer);
  const stream=document.createElement('div');stream.className='chat-stream';stream.setAttribute('role','log');stream.setAttribute('aria-label','Room chat from across the map');stream.setAttribute('aria-live','polite');stream.setAttribute('aria-relevant','additions');layer.append(stream);
  let bubbles=[],nextScroll=Infinity;
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
  // A shared screen-space stack keeps distant speakers readable while the map moves.
  // Only the bubbles rise; avatar positions and camera zoom cannot move chat off screen.
  function position(){
    const anchor=stream.clientHeight-16,left=stream.clientWidth/2;
    let ceiling=Infinity;
    for(let i=bubbles.length-1;i>=0;i--){
      const item=bubbles[i],height=item.element.offsetHeight;
      const bottom=Math.min(anchor-item.offset,ceiling);
      item.element.style.left=`${left}px`;item.element.style.top=`${anchor}px`;
      item.element.style.setProperty('--chat-rise',`${anchor-bottom}px`);
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
    const item={element,offset:0};stream.append(element);bubbles.push(item);position();
    nextScroll=performance.now()+4000;
  }
  new ResizeObserver(position).observe(stream);
  return {say,typing,removeTyping,update(now){
    if(bubbles.length&&now>=nextScroll){scroll();position();nextScroll=now+4000;}
  }};
}
