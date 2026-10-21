// Whiteboard limits shared by the server and the editor.
export const BOARD_WIDTH=192,BOARD_HEIGHT=120,MAX_POINTS=600,MAX_STROKES=400;
export const COLORS=['#1b1b1b','#d7263d','#1f6fd1','#1e9c4a','#ffffff'];
// Merge a delta from the server into the local stroke list: new strokes are appended,
// known ones are replaced, and a clear newer than what we have wipes the board first.
export function applyUpdate(strokes,update,known={clearedSerial:0}){
  let next=strokes;
  if(update.clearedSerial>known.clearedSerial)next=[];
  const byId=new Map(next.map(s=>[s.id,s]));
  for(const stroke of update.strokes)byId.set(stroke.id,stroke);
  return {strokes:[...byId.values()].sort((a,b)=>a.serial-b.serial),clearedSerial:update.clearedSerial,serial:Math.max(known.serial??0,update.serial,...update.strokes.map(s=>s.serial))};
}
