// Each cell is a complete, untrimmed avatar canvas. Animated jacket cells
// already include each limb's direction and offsets from the guide renderer.
export const WEARABLE_DIRECTIONS=[0,1,2,3,4,5,6,7];
const poses=[{frame:-1},{frame:0},{frame:1},{frame:2},{frame:3},{frame:-1,sitting:true},
  ...[0,1].map(actionFrame=>({frame:-1,action:'wave',actionFrame})),
  ...[0,1].map(actionFrame=>({frame:-1,sitting:true,action:'wave',actionFrame})),
  ...Array.from({length:8},(_,actionFrame)=>({frame:-1,action:'dance',actionFrame}))];
export const WEARABLE_POSES=[...poses,...poses.map(pose=>({...pose,carry:true}))];
export function wearableSize(slot){return {width:768,height:slot==='jacket'?WEARABLE_POSES.length*112:112};}
export function wearableCell(slot,direction,frame=-1,sitting=false,action=null,actionFrame=0,carry=false){
  const facing=((direction%8)+8)%8;
  const pose=action==='dance'?10+actionFrame%8:action==='wave'?(sitting?8:6)+actionFrame%2:sitting?5:frame>=0?1+frame%4:0;
  const row=slot==='headwear'?0:pose+(carry?poses.length:0);
  return {x:WEARABLE_DIRECTIONS.indexOf(facing)*96,y:row*112,width:96,height:112};
}
export function wearablePrompt({name,slot,description}){
  const {width,height}=wearableSize(slot);
  return `Create ${name}: ${description}. Habbo-style crisp pixel art on a transparent background. This is a ${slot} overlay, NOT a complete avatar. Use the supplied avatar guide as the exact alignment template and REMOVE ALL avatar pixels from the output. Output ${width} x ${height} pixels, or an exact integer multiple. Eight columns, each 96 x 112 pixels, in avatar direction order 0 through 7 exactly as shown in the guide. Never trim, shift or resize individual cells. ${slot==='headwear'?'One row. Draw only the hat, helmet or head accessory, aligned to the guide head.':'36 rows: standing; walking frames 0, 1, 2, 3; sitting; waving frames 0 and 1; seated waving frames 0 and 1; dance frames 0 through 7. Then repeat those 18 poses while holding a drink. Match every limb in each supplied guide cell, including dance turns and offsets. Seated-wave cells also animate breakdancing. Draw only the jacket, including sleeves matching each pose. Leave hands, face, drink and legs transparent.'} No labels, grid lines, shadows or background. Preserve transparent empty space in every cell.`;
}
