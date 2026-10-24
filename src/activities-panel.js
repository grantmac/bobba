import {roomExtraPanel,button,element} from './room-extra-panel.js';
export function createActivitiesPanel({api,getPlayer,canCreate,now=Date.now}){
  const {toggle,dialog,body}=roomExtraPanel('Activities');
  body.append(element('p','Join a quiz or hunt in this space. Scores stay saved between visits; each new round adds to your total.'));
  const newButton=button('Create an activity',()=>openCreator());
  const creator=document.createElement('form');creator.className='activity-create';creator.hidden=true;
  const list=document.createElement('div'),status=element('p','');status.className='room-extra-status';status.setAttribute('role','status');
  body.append(newButton,creator,list,status);
  let spaceId=null,stop=null,timer=null,epoch=0,busy=false;
  function clocks(){for(const el of list.querySelectorAll('[data-deadline]')){const seconds=Math.max(0,Math.ceil((Number(el.dataset.deadline)-now())/1000));el.textContent=seconds?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' remaining':'Round ended';}}
  async function perform(action,message){if(busy)return;busy=true;try{const result=await action();status.textContent=message??(result?.correct===true?'Correct! One point.':result?.correct===false?'Not quite. Someone else can buzz in.':'Saved.');}catch(e){status.textContent=e.message;}finally{busy=false;}}
  function render(games){
    list.replaceChildren();
    if(!games.length)list.append(element('p','No activities in this space yet.'));
    for(const game of games){
      const card=document.createElement('section');card.className='activity-card';card.append(element('h2',game.name));
      const live=game.status==='playing'&&game.endsAt>now(),clock=element('p',game.status==='waiting'?'Waiting for the host':game.status==='finished'?'Round finished':'');clock.className='activity-clock';
      if(game.status==='playing')clock.dataset.deadline=game.endsAt;card.append(clock);
      card.append(element('p',(game.kind==='quiz'?'Buzzer quiz':'Treasure hunt')+' · Round '+game.round));
      if(!game.me)card.append(button('Join activity',()=>perform(()=>api.play(game.id,'join'),'You joined.')));
      if(game.kind==='quiz'&&game.question){
        card.append(element('p',game.question.prompt));
        const holder=game.scores.find(p=>p.playerId===game.buzzer);
        if(holder)card.append(element('p',holder.name+' has the buzzer.'));
        if(game.me?.answered)card.append(element('p','You have answered this round.'));
        const buzz=button('Buzz in',()=>perform(()=>api.play(game.id,'buzz',{round:game.round}),'You have the buzzer. Choose an answer.'));
        buzz.disabled=!live||!game.me||!!game.buzzer||game.me.answered;card.append(buzz);
        const options=document.createElement('div');options.className='room-extra-actions';
        game.question.options.forEach((text,choice)=>{const b=button(text,()=>perform(()=>api.play(game.id,'answer',{round:game.round,choice})));b.disabled=!live||game.buzzer!==getPlayer().id;options.append(b);});card.append(options);
      }else{
        for(const target of game.targets){const row=document.createElement('div');row.className='activity-target';const found=game.me?.found.includes(target.itemId);row.append(element('p',target.clue));const b=button(found?'Found ✓':'Collect nearby object',()=>perform(()=>api.play(game.id,'collect',{round:game.round,itemId:target.itemId}),'Found it! One point.'));b.disabled=!live||!game.me||found;row.append(b);card.append(row);}
      }
      const table=document.createElement('table');table.className='activity-scores';table.append(element('caption','Scoreboard'));
      for(const player of game.scores){const row=document.createElement('tr');row.append(element('th',player.name),element('td',String(player.score)));table.append(row);}card.append(table);
      if(game.canManage){
        const actions=document.createElement('div');actions.className='room-extra-actions';
        actions.append(button(live?'Finish round':game.round?'Start next round':'Start round',()=>perform(()=>api.control(game.id,live?'finish':'start'),live?'Round finished.':'Round started.')));
        let confirming=false;actions.append(button('Delete activity',b=>{if(!confirming){confirming=true;b.textContent='Delete activity and scores?';return;}void perform(()=>api.control(game.id,'delete'),'Activity deleted.');}));card.append(actions);
      }
      list.append(card);
    }
    clocks();
  }
  function watch(){
    stop?.();stop=null;const request=++epoch;spaceId=getPlayer().zone??'main';
    creator.hidden=true;newButton.hidden=!canCreate(spaceId);status.textContent='';list.replaceChildren(element('p','Loading activities…'));
    stop=api.watch(spaceId,games=>{if(request===epoch&&dialog.open)render(games);},message=>{if(request===epoch)status.textContent=message;});
  }
  function field(parent,label,type='text'){const wrap=element('label',label),input=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');if(input.tagName==='INPUT')input.type=type;wrap.append(input);parent.append(wrap);return input;}
  async function openCreator(){
    creator.replaceChildren();creator.hidden=false;
    const name=field(creator,'Activity name');name.required=true;name.maxLength=40;
    const kind=field(creator,'Activity','select');for(const [value,label] of [['quiz','Buzzer quiz'],['hunt','Treasure hunt']]){const option=element('option',label);option.value=value;kind.append(option);}
    const duration=field(creator,'Round length (seconds)','number');duration.min=15;duration.max=3600;duration.value=60;duration.required=true;
    const questions=document.createElement('div'),targets=document.createElement('div');creator.append(questions,targets);targets.hidden=true;
    const entries=[];
    function addQuestion(){
      const box=document.createElement('div');box.className='activity-question';
      const prompt=field(box,'Question');prompt.required=true;prompt.maxLength=300;
      const options=field(box,'Answer choices (one per line)','textarea');options.required=true;options.rows=3;
      const answer=field(box,'Correct answer','select');
      options.oninput=()=>{const selected=answer.value;answer.replaceChildren();options.value.split('\n').filter(x=>x.trim()).forEach((text,i)=>{const option=element('option',text.trim());option.value=i;answer.append(option);});if([...answer.options].some(o=>o.value===selected))answer.value=selected;};
      const entry={box,prompt,options,answer};entries.push(entry);
      box.append(button('Remove question',()=>{entries.splice(entries.indexOf(entry),1);box.remove();}));questions.append(box);
    }
    addQuestion();const add=button('Add question',()=>{if(entries.length<20)addQuestion();});creator.append(add);
    let objects=null;const targetEntries=[];const request=epoch,creationSpace=spaceId;
    kind.onchange=async()=>{
      const hunt=kind.value==='hunt';questions.hidden=hunt;targets.hidden=!hunt;add.hidden=hunt;
      questions.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=hunt);
      if(!hunt||objects)return;
      targets.replaceChildren(element('p','Loading objects…'));
      try{
        const result=await api.objects(creationSpace);if(request!==epoch||creator.hidden)return;objects=result;targets.replaceChildren();
        if(!objects.length)targets.append(element('p','Place some furniture in your space first.'));
        for(const object of objects){const box=document.createElement('div');box.className='activity-target';const use=field(box,object.name+' ('+object.x+', '+object.z+')','checkbox'),clue=field(box,'Clue');clue.maxLength=300;clue.value='Find '+object.name;targetEntries.push({object,use,clue});targets.append(box);}
      }catch(e){targets.replaceChildren(element('p',e.message));}
    };
    const save=button('Create activity',()=>{});save.type='submit';creator.append(save,button('Cancel',()=>{creator.hidden=true;}));
    creator.onsubmit=event=>{
      event.preventDefault();void perform(async()=>{
        const args={spaceId:creationSpace,name:name.value,kind:kind.value,durationSeconds:Number(duration.value)};
        if(kind.value==='quiz')args.questions=entries.map(e=>({prompt:e.prompt.value,options:e.options.value.split('\n').map(x=>x.trim()).filter(Boolean),answer:Number(e.answer.value)}));
        else args.targets=targetEntries.filter(e=>e.use.checked).map(e=>({itemId:e.object.id,clue:e.clue.value}));
        await api.create(args);creator.hidden=true;
      },'Activity created. Join, then start the first round.');
    };
    name.focus();
  }
  toggle.onclick=()=>{if(dialog.open)return;dialog.showModal();watch();timer=setInterval(clocks,500);};
  dialog.addEventListener('close',()=>{epoch++;stop?.();stop=null;clearInterval(timer);timer=null;});
  return {setSpace(id){if(dialog.open&&id!==spaceId)watch();},close:()=>dialog.close()};
}
