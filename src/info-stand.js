// Origins Room Interface: showInfostand / showObjectInfo; info_stand.window.
// Original positions: plate (65,42), name bar (0,78), image anchored at (111,72).
export async function createInfoStand(prepareImage){
  const panel=document.createElement('section');panel.className='user-info-stand';panel.hidden=true;
  panel.setAttribute('aria-label','Selected character');
  const plate=document.createElement('canvas'),portrait=document.createElement('canvas'),bar=document.createElement('canvas'),name=document.createElement('span');
  plate.className='info-plate';portrait.className='info-portrait';bar.className='info-name-bg';name.className='info-name';
  portrait.width=96;portrait.height=112;panel.append(plate,portrait,bar,name);document.body.append(panel);
  await Promise.all([['info_plate',plate],['info_name_bg',bar]].map(([file,canvas])=>new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>{const prepared=prepareImage(image,{matte:true});canvas.width=prepared.width;canvas.height=prepared.height;canvas.getContext('2d').drawImage(prepared,0,0);resolve();};image.onerror=reject;image.src=`/assets/info-stand/${file}.png`;
  })));
  let selected=null,lastImage=null;
  return {
    get selected(){return selected;},
    select(player){selected=player.id;name.textContent=player.name;panel.hidden=false;},
    update(player,image){if(!player){this.hide();return;}name.textContent=player.name;if(image&&image!==lastImage){lastImage=image;const ctx=portrait.getContext('2d');ctx.clearRect(0,0,96,112);ctx.drawImage(image,0,0);}},
    hide(){selected=null;panel.hidden=true;},
  };
}
