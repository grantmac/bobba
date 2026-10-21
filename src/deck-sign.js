// The Poolside FM sign that lights up on the wall behind the DJ decks. Each
// image is pre-sheared to lie flat on its wall and drawn at DENSITY times the
// room's pixel size for smoother lettering; width/height are in room pixels and
// textHeight is the unsheared lettering height, used to hang the sign above the floor.
const FILES={left:'/assets/posters/poolside-fm-left.png',right:'/assets/posters/poolside-fm-right.png'};
export const SIGN_LIFT=74,SIGN_DENSITY=3;
export async function loadDeckSign(){
  const signs={};
  await Promise.all(Object.entries(FILES).map(([side,src])=>new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      canvas.getContext('2d').drawImage(image,0,0);
      const width=image.width/SIGN_DENSITY,height=image.height/SIGN_DENSITY;
      signs[side]={canvas,width,height,textHeight:height-Math.floor((image.width-1)/2)/SIGN_DENSITY};resolve();
    };
    image.onerror=()=>reject(new Error(`Could not load ${src}`));image.src=src;
  })));
  return signs;
}
