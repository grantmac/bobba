// Origins Room Interface: showInfostand / showObjectInfo; info_stand.window.
// Original positions: plate (65,42), name bar (0,78), image anchored at (111,72).
// It also shows a built piece (showObjectInfo): its icon, name and who built it.
export async function createInfoStand(prepareImage){
  const panel=document.createElement('section');panel.className='user-info-stand';panel.hidden=true;
  panel.setAttribute('aria-label','Selected character');
  const plate=document.createElement('canvas'),portrait=document.createElement('canvas'),bar=document.createElement('canvas'),name=document.createElement('span'),by=document.createElement('span');
  plate.className='info-plate';portrait.className='info-portrait';bar.className='info-name-bg';name.className='info-name';by.className='info-by';
  portrait.width=96;portrait.height=112;panel.append(plate,portrait,bar,name,by);document.body.append(panel);
  await Promise.all([['info_plate',plate],['info_name_bg',bar]].map(([file,canvas])=>new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>{const prepared=prepareImage(image,{matte:true});canvas.width=prepared.width;canvas.height=prepared.height;canvas.getContext('2d').drawImage(prepared,0,0);resolve();};image.onerror=reject;image.src=`/assets/info-stand/${file}.png`;
  })));
  let selected=null,lastImage=null,showing=0;
  const clearPortrait=()=>{lastImage=null;portrait.getContext('2d').clearRect(0,0,96,112);};
  return {
    get selected(){return selected;},
    select(player){selected=player.id;showing++;name.textContent=player.name;by.textContent='';panel.hidden=false;},
    // A built piece: name on the bar, builder underneath, catalogue icon on the plate (pixel-scaled to fit).
    inspect({name:title,by:builder,icon}){
      selected=null;const token=++showing;name.textContent=title;by.textContent=builder?`Built by ${builder}`:'';panel.hidden=false;clearPortrait();
      if(!icon)return;const image=new Image();image.onload=()=>{
        if(token!==showing)return;const ctx=portrait.getContext('2d');ctx.clearRect(0,0,96,112);ctx.imageSmoothingEnabled=false;
        let scale=Math.min(80/image.width,80/image.height);if(scale>1)scale=Math.floor(scale);
        const w=Math.round(image.width*scale),h=Math.round(image.height*scale);ctx.drawImage(image,Math.round((96-w)/2),Math.round(100-h),w,h);
      };image.src=icon;
    },
    update(player,image){if(!player){this.hide();return;}name.textContent=player.name;if(image&&image!==lastImage){lastImage=image;const ctx=portrait.getContext('2d');ctx.clearRect(0,0,96,112);ctx.drawImage(image,0,0);}},
    hide(){selected=null;showing++;by.textContent='';panel.hidden=true;},
  };
}
