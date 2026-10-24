import {createAppearance} from './appearance.js';
import {prepareImage} from './sprite-image.js';
import {WEARABLE_DIRECTIONS,WEARABLE_POSES,wearableSize} from '../shared/wearables.js';
export async function renderWearablePreview({look,slot,wearable,guide=false}){
  const appearance=await createAppearance({prepareImage,onApply(){},onOpen(){}});
  const canvas=document.createElement('canvas'),size=wearableSize(slot);
  canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const poses=slot==='jacket'?WEARABLE_POSES:[WEARABLE_POSES[0]];
  const dressed={...look,_wearables:guide?[]:[...(look._wearables??[]).filter(w=>w.slot!==slot),...(wearable?[wearable]:[])]};
  if(guide)for(const group of slot==='headwear'?['hats','headwear']:['jackets'])dressed[group]={model:'none',color:'#624631'};
  for(const [row,pose] of poses.entries())for(const [col,direction] of WEARABLE_DIRECTIONS.entries()){
    const frame=await appearance.previewFrame(dressed,direction,pose.frame,pose.sitting,pose.action,pose.actionFrame??0,pose.carry??false);
    ctx.drawImage(frame,col*96,row*112);
  }
  return canvas.toDataURL('image/png');
}
