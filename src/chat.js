// Keep at most seven messages, aging once per reply or four seconds of idle time.
export function createChat({getSpeaker,getSpeakerPosition,onSelectSpeaker}){
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
  // Place newest messages first, above their speaker's current screen position.
  // Only lift an older bubble when it would overlap one already placed.
  function position(){
    const bounds=stream.getBoundingClientRect(),placed=[],speakers=new Set();
    for(let i=bubbles.length-1;i>=0;i--){
      const item=bubbles[i],element=item.element;
      // Text is immutable; only viewport resizing can change its measured size.
      if(item.viewportWidth!==bounds.width){
        element.hidden=false;const size=element.getBoundingClientRect();item.width=size.width;item.height=size.height;item.viewportWidth=bounds.width;
      }
      const head=getSpeakerPosition(item.speaker),{width,height}=item;
      const x=head.x-bounds.left,y=head.y-bounds.top;
      const center=Math.max(width/2+6,Math.min(bounds.width-width/2-6,x));
      const left=center-width/2,right=center+width/2;
      let bottom=Math.max(height+6,Math.min(bounds.height-8,y-8));
      // Recheck after each move: lifting past one bubble can meet another above it.
      for(let pass=0;pass<placed.length;pass++){
        const collision=placed.find(box=>left<box.right+8&&right>box.left-8&&bottom>box.top-8&&bottom-height<box.bottom+8);
        if(!collision)break;
        bottom=collision.top-8;
      }
      const key=item.speaker.id??item.speaker.name;
      element.dataset.tail=String(!speakers.has(key));speakers.add(key);
      // Keep older messages out of the way when the viewport cannot fit them.
      element.hidden=bottom-height<6;
      if(element.hidden)continue;
      element.style.left=`${center}px`;element.style.top=`${bottom}px`;
      element.style.setProperty('--chat-tail',`${Math.max(12,Math.min(width-12,x-left))}px`);
      placed.push({left,right,top:bottom-height,bottom});
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
    const item={element,speaker,offset:0};stream.append(element);bubbles.push(item);position();
    nextScroll=performance.now()+4000;
  }
  new ResizeObserver(position).observe(stream);
  return {say,typing,removeTyping,update(now){
    if(bubbles.length&&now>=nextScroll){scroll();nextScroll=now+4000;}
    if(bubbles.length)position();
  }};
}
