// The active hh_room Room Component creates Balloon Manager (not the older
// hh_room_utils Chat Display). Its defaults are 7 bubbles, a 21px step,
// 4000ms idle scroll, 400 characters, and a bottom registration point at 125.
export function createChat({getSpeaker,getLayout,onSelectSpeaker}){
  const layer=document.createElement('div');layer.className='chat-bubbles';layer.setAttribute('role','log');layer.setAttribute('aria-label','Room chat');layer.setAttribute('aria-live','polite');layer.setAttribute('aria-relevant','additions');document.body.append(layer);
  let bubbles=[],nextScroll=Infinity,lastLayout='';
  function position(item){
    const layout=getLayout(),width=item.element.offsetWidth;
    const left=Math.max(6,Math.min(window.innerWidth-width-6,item.x-width/2));
    item.element.style.left=`${left}px`;item.element.style.top=`${layout.baseline-item.offset-19}px`;
  }
  function scroll(){
    for(const item of bubbles){item.offset+=21;position(item);}
    bubbles=bubbles.filter(item=>{if(item.offset>=147){item.element.remove();return false;}return true;});
  }
  function say(message,mode='Say',source){
    const text=message.trim().slice(0,400);if(!text)return;
    const speaker=source||getSpeaker();
    scroll();
    if(bubbles.length>=7)bubbles.shift().element.remove();
    const element=document.createElement('button');element.type='button';element.className='chat-bubble';element.dataset.mode=mode;element.title=`${speaker.name}: ${text}`;element.style.setProperty('--speaker-color',speaker.color);
    const name=document.createElement('strong');name.textContent=speaker.name+':';const words=document.createElement('span');words.textContent=' '+text;element.append(name,words);element.onclick=()=>onSelectSpeaker(speaker);
    const item={element,x:speaker.x,offset:0};layer.append(element);bubbles.push(item);position(item);
    nextScroll=performance.now()+4000;
  }
  window.addEventListener('resize',()=>bubbles.forEach(position));
  return {say,update(now){
    const layout=JSON.stringify(getLayout());if(layout!==lastLayout){lastLayout=layout;bubbles.forEach(position);}
    if(bubbles.length&&now>=nextScroll){scroll();nextScroll=now+4000;}
  }};
}
