export function createDanceFloorControls({onChange,onError=()=>{}}){
  const panel=document.createElement('section');panel.className='furniture-actions dance-floor-controls';panel.hidden=true;panel.setAttribute('aria-label','Dance floor');
  panel.innerHTML='<button class="furniture-close" aria-label="Deselect dance floor">×</button><strong>Dance floor</strong><div><button type="button" role="switch" aria-label="Dance floor lights" aria-checked="true"><span></span> On</button></div>';
  const button=panel.querySelector('[role=switch]');let on=true;
  function receive(value){on=value;button.setAttribute('aria-checked',String(on));button.innerHTML=`<span></span> ${on?'On':'Off'}`;}
  button.onclick=async()=>{button.disabled=true;try{await onChange(!on);}catch(error){onError(error.message);}finally{button.disabled=false;}};
  panel.querySelector('.furniture-close').onclick=()=>{panel.hidden=true;};document.body.append(panel);
  return {receive,open(){panel.hidden=false;},close(){panel.hidden=true;}};
}
