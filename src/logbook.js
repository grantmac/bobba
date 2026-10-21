import {makeDraggable} from './draggable.js';
// The guest book window: who came in and when they left, newest first, in the room's
// window style. Pages back through older visits on demand and refreshes while open.
export function createLogbook({fetchPage,watch,onError=()=>{}}){
  const panel=document.createElement('section');panel.className='voice-panel logbook';panel.hidden=true;panel.tabIndex=-1;panel.setAttribute('aria-label','Guest book');
  panel.innerHTML='<header><h1>Guest book</h1><button type="button" class="appearance-close" aria-label="Close guest book">×</button></header><div class="logbook-body"><p class="logbook-intro">Everyone who has visited, newest first.</p><ol class="logbook-list" aria-live="polite"></ol><button type="button" class="logbook-more">Older entries</button></div>';
  document.body.append(panel);makeDraggable(panel);
  const list=panel.querySelector('.logbook-list'),more=panel.querySelector('.logbook-more');
  let visits=[],oldest=null,exhausted=false,stop=null,serverTime=Date.now(),clock=null;
  const sameDay=(a,b)=>new Date(a).toDateString()===new Date(b).toDateString();
  const stamp=(t,now)=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+(sameDay(t,now)?'':' · '+new Date(t).toLocaleDateString([],{day:'numeric',month:'short'}));
  const span=ms=>{const m=Math.max(1,Math.round(ms/60000));return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60} min`;};
  function render(){
    const now=serverTime;list.replaceChildren();
    for(const visit of visits){
      const item=document.createElement('li');const name=document.createElement('strong');name.textContent=visit.name;
      const when=document.createElement('span');
      when.textContent=visit.leftAt?(visit.estimated?`in ${stamp(visit.enteredAt,now)}, out some time after`:`in ${stamp(visit.enteredAt,now)}, out ${stamp(visit.leftAt,now)} (${span(visit.leftAt-visit.enteredAt)})`):`in ${stamp(visit.enteredAt,now)}, still here (${span(now-visit.enteredAt)})`;
      item.classList.toggle('is-present',!visit.leftAt);item.append(name,when);list.append(item);
    }
    if(!visits.length){const empty=document.createElement('li');empty.className='logbook-empty';empty.textContent='Nobody has signed in yet.';list.append(empty);}
    more.hidden=exhausted||!visits.length;
  }
  function merge(page){
    serverTime=page.serverTime;const byId=new Map(visits.map(v=>[v.id,v]));
    for(const v of page.visits)byId.set(v.id,v);
    visits=[...byId.values()].sort((a,b)=>b.enteredAt-a.enteredAt);
    oldest=visits.length?visits[visits.length-1].enteredAt:null;render();
  }
  more.onclick=async()=>{more.disabled=true;try{const page=await fetchPage(oldest);if(page.visits.length<40)exhausted=true;merge(page);}catch(error){onError(error.message);}finally{more.disabled=false;}};
  panel.querySelector('header button').onclick=()=>close();
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){close();event.stopPropagation();}});
  function open(){
    panel.hidden=false;visits=[];exhausted=false;render();
    stop?.();stop=watch(page=>{if(page.visits.length<40&&!oldest)exhausted=true;merge(page);},message=>onError(message));
    clearInterval(clock);clock=setInterval(()=>{serverTime+=30000;render();},30000);
    panel.focus();
  }
  function close(){panel.hidden=true;stop?.();stop=null;clearInterval(clock);}
  return {open,close,get isOpen(){return !panel.hidden;}};
}
