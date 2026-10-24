import './homepage.css';
import {homepagePages} from './homepage-content.js';
import {homepageTopicFor} from '../shared/homepage.js';
import {makeDraggable} from './draggable.js';

export function createHomepage({api,onVisitors=()=>{},focusRoom=()=>{}}){
  const dialog=document.createElement('dialog');dialog.className='homepage-window';dialog.setAttribute('aria-labelledby','homepage-title');
  dialog.innerHTML=`<header class="homepage-chrome"><span>grantm.ac / personal space</span><button type="button" aria-label="Close homepage">×</button></header><div class="homepage-layout"><nav aria-label="Explore Grant’s homepage"><a class="homepage-brand" href="#">grantm.ac<span>Make yourself at home.</span></a><div class="homepage-tabs"></div><p class="homepage-nav-note">Objects have stories.<br>Click around.</p></nav><article class="homepage-page" tabindex="-1"></article></div><footer class="homepage-footer"><span>Thanks for stopping by.</span><label hidden><input type="checkbox"> Edit furniture</label><button type="button" data-page="about">Back to the welcome mat</button></footer>`;
  document.body.append(dialog);
  dialog.querySelector('.homepage-chrome span').textContent='Grant’s Homepage';
  makeDraggable(dialog);
  const page=dialog.querySelector('article'),tabs=dialog.querySelector('.homepage-tabs');
  let active='about',version=0,returnFocus=null,editFurniture=false;
  const edit=dialog.querySelector('input');edit.onchange=()=>{editFurniture=edit.checked;};
  for(const entry of homepagePages){const button=document.createElement('button');button.type='button';button.dataset.page=entry.id;button.textContent=entry.label;button.title=entry.object;tabs.append(button);}
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  const button=(text,handler,className)=>{const el=node('button',text,className);el.type='button';el.onclick=handler;return el;};
  function link(label,href){const a=node('a',label);a.href=href;if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}return a;}
  function close(){dialog.close();}
  dialog.querySelector('header button').onclick=close;
  dialog.querySelector('.homepage-brand').onclick=e=>{e.preventDefault();show('about');};
  dialog.addEventListener('click',event=>{const target=event.target.closest('[data-page]');if(target)show(target.dataset.page);});
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('close',()=>{version++;page.querySelector('iframe')?.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else focusRoom();});
  function show(id){
    const entry=homepagePages.find(p=>p.id===id);if(!entry)return;
    active=id;const request=++version;page.replaceChildren();page.scrollTop=0;
    for(const b of tabs.children)b.setAttribute('aria-current',String(b.dataset.page===id));
    page.append(node('p',entry.eyebrow,'homepage-eyebrow'));
    const title=node('h1',entry.title);title.id='homepage-title';page.append(title,node('p',entry.intro,'homepage-lede'));
    for(const text of entry.paragraphs??[])page.append(node('p',text));
    if(entry.cards){const cards=node('div',undefined,'homepage-cards');for(const card of entry.cards){
      const item=node('section',undefined,'homepage-card');item.append(node('span',card.tag,'homepage-tag'),node('h2',card.title),node('p',card.text));
      item.append(card.page?button('Leave an idea →',()=>show(card.page)):link('Explore →',card.href));cards.append(item);
    }page.append(cards);}
    if(entry.links){const links=node('div',undefined,'homepage-links');for(const [label,url] of entry.links)links.append(link(label,url));page.append(links);}
    if(id==='contact'){
      const copy=button('Copy email address',async()=>{try{await navigator.clipboard.writeText('grant.maclennan@gmail.com');copy.textContent='Email copied';}catch{copy.textContent='Select the email address above to copy it.';}},'homepage-secondary');page.append(copy);
    }
    if(id==='oldweb'){
      const launch=button('Boot up the old website',()=>{
        const frame=document.createElement('iframe');frame.title='The original grantm.ac homepage';frame.src='https://www.grantm.ac/';frame.className='homepage-oldweb';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms');frame.referrerPolicy='no-referrer';launch.replaceWith(frame);
      },'homepage-primary');page.append(launch,node('p','If your browser cannot display it here, use “Open the original website” above.','homepage-caption'));
    }
    if(['guestbook','suggestions','scrapbook'].includes(id))showNotes(id,request);
    page.focus({preventScroll:true});
  }
  function showNotes(id,request){
    const completed=id==='scrapbook',kind=id==='guestbook'?'guestbook':'suggestion';
    const current=()=>request===version&&dialog.open;
    if(id==='guestbook')page.append(button('See who has visited the room',()=>{close();onVisitors();},'homepage-secondary'));
    if(!completed){
      const form=node('form',undefined,'homepage-note-form'),label=node('label',kind==='guestbook'?'Your note':'Your suggestion'),input=node('textarea');
      input.name='note';input.maxLength=500;input.required=true;input.rows=3;label.append(input);
      const submit=node('button',kind==='guestbook'?'Sign the guestbook':'Leave suggestion','homepage-primary');submit.type='submit';
      const status=node('p','','homepage-caption');status.setAttribute('role','status');
      form.append(label,node('small','Public, under your room name. Up to 500 characters.'),submit,status);page.append(form);
      form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;status.textContent='Saving…';
        try{await api.add({kind,body:input.value});if(!current())return;input.value='';status.textContent='Saved. Thanks for leaving your mark.';await load();}
        catch(error){if(current())status.textContent=error.message;}finally{submit.disabled=false;}
      };
    }
    const tools=node('div',undefined,'homepage-note-tools');tools.append(button('Refresh',()=>load(),'homepage-secondary'));
    if(!completed)tools.append(button('See the scrapbook →',()=>show('scrapbook'),'homepage-secondary'));
    const status=node('p','Loading notes…','homepage-caption');status.setAttribute('role','status');
    const list=node('ol',undefined,'homepage-notes'),more=button('Older notes',()=>load(true),'homepage-secondary');more.hidden=true;page.append(tools,status,list,more);
    let cursor,loading=false,reload=false;
    async function load(older=false){
      if(loading){if(!older)reload=true;return;}loading=true;more.disabled=true;
      try{
        const result=await api.notes({kind,completed,...(older&&cursor?{cursor}:{})});if(!current())return;
        if(!older)list.replaceChildren();
        for(const note of result.notes){
          const item=node('li'),heading=node('div',undefined,'homepage-note-heading');heading.append(node('strong',note.name),node('time',new Date(note.createdAt).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})));
          item.append(heading,node('p',note.body));if(note.response)item.append(node('p',`Grant: ${note.response}`,'homepage-response'));
          if(result.canManage){
            const controls=node('div',undefined,'homepage-review');
            if(kind==='suggestion'&&!completed){
              const response=node('textarea');response.maxLength=500;response.rows=2;response.setAttribute('aria-label','What changed for this suggestion?');response.placeholder='What changed?';
              const done=button('Add to scrapbook',()=>review('done',response.value));controls.append(response,done);
            }
            controls.append(button('Hide note',()=>review('hidden')));item.append(controls);
            async function review(status,response){
              const buttons=controls.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
              try{await api.review({id:note.id,status,...(response!==undefined?{response}:{})});if(current())await load();}
              catch(error){if(current()){let err=controls.querySelector('[role=alert]');if(!err){err=node('p');err.setAttribute('role','alert');controls.append(err);}err.textContent=error.message;}}
              finally{buttons.forEach(b=>b.disabled=false);}
            }
          }
          list.append(item);
        }
        cursor=result.cursor;more.hidden=!result.hasMore;status.textContent=list.children.length?'':completed?'No completed suggestions yet. The first page is waiting.':'Nothing here yet. You can be the first.';
      }catch(error){if(current())status.textContent=error.message||'Could not load notes. Try Refresh.';}
      finally{loading=false;more.disabled=false;if(reload&&current()){reload=false;void load();}}
    }
    void load();
  }
  function open(id='about'){if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}show(id);}
  return {
    inspect(item){const topic=homepageTopicFor(item);if(!topic||editFurniture)return false;open(topic);return true;},
    open,
    setAdmin(admin){dialog.querySelector('.homepage-footer label').hidden=!admin;},
  };
}
