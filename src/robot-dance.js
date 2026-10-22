// Articulate the existing robot at its mechanical joints. Like appearance.js,
// the dance moves limbs independently while keeping the head and feet anchored.
// Coordinates are native pixels in tnarg-robot-v3's 96×112 cells.
const JOINTS=[
  {left:[41,69],right:[58,68],hips:[46,53],split:51},
  {left:[37,68],right:[57,69],hips:[43,51],split:47},
  {left:[42,70],right:[61,69],hips:[47,55],split:52},
  {left:[35,69],right:[56,70],hips:[41,50],split:46},
];
const BEATS=[
  {sway:-1,bob:0,left:12,right:-55,kick:-10,head:0},
  {sway:-2,bob:1,left:24,right:-72,kick:-18,head:0},
  {sway:-1,bob:-1,left:12,right:-55,kick:-8,head:1},
  {sway:0,bob:0,left:-12,right:-20,kick:0,head:1},
  {sway:1,bob:0,left:55,right:-12,kick:10,head:0},
  {sway:2,bob:1,left:72,right:-24,kick:18,head:0},
  {sway:1,bob:-1,left:55,right:-12,kick:8,head:-1},
  {sway:0,bob:0,left:20,right:12,kick:0,head:-1},
];
const BOUNCE=[0,2,4,2,0,2,4,2];

function canvas(){
  const result=document.createElement('canvas');result.width=96;result.height=112;
  return result;
}

function rig(source,column){
  const joints=JOINTS[column],pixels=source.getContext('2d').getImageData(0,0,96,112);
  const layers=Object.fromEntries(['head','body','left','right','legLeft','legRight'].map(name=>{
    const image=canvas(),ctx=image.getContext('2d');return [name,{image,ctx,pixels:ctx.createImageData(96,112)}];
  }));
  for(let y=0;y<112;y++)for(let x=0;x<96;x++){
    const index=(y*96+x)*4;
    if(!pixels.data[index+3])continue;
    const leftEdge=joints.left[0]+(y<74?4:y<82?2:0);
    const rightEdge=joints.right[0]-(y<74?3:y<82?1:0);
    const leftEnd=column===0||column===2?91:84,rightEnd=column===0||column===2?84:91;
    const part=y<65?'head':y<leftEnd&&x<leftEdge?'left':y<rightEnd&&x>rightEdge?'right':y<83?'body':x<joints.split?'legLeft':'legRight';
    layers[part].pixels.data.set(pixels.data.subarray(index,index+4),index);
  }
  for(const layer of Object.values(layers))layer.ctx.putImageData(layer.pixels,0,0);
  return {layers,joints};
}

function drawPart(ctx,image,[x,y],angle=0,dx=0,dy=0){
  ctx.save();ctx.translate(x+dx,y+dy);ctx.rotate(angle*Math.PI/180);
  ctx.drawImage(image,-x,-y);ctx.restore();
}

export function createRobotDance(standing){
  const rigs=standing.map(rig);
  return function dance(column,step){
    const {layers,joints}=rigs[column],beat=BEATS[step],output=canvas(),ctx=output.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    const facing=column===1||column===3?-1:1;
    const sway=beat.sway*facing;
    // The rear arm is behind the torso; the near arm crosses in front of it.
    const rear=facing===1?'right':'left',near=facing===1?'left':'right';
    drawPart(ctx,layers[rear].image,joints[rear],beat[rear],sway,beat.bob);
    drawPart(ctx,layers.legLeft.image,[joints.hips[0],83],beat.kick,sway,beat.kick<0?-1:0);
    drawPart(ctx,layers.legRight.image,[joints.hips[1],83],-beat.kick,sway,beat.kick>0?-1:0);
    // Small overlaps cover the joint seams when a limb swings away.
    ctx.fillStyle='#252525';ctx.fillRect(joints.left[0]+2+sway,67+beat.bob,joints.right[0]-joints.left[0]-3,16);
    drawPart(ctx,layers.body.image,[48,82],0,sway,beat.bob);
    drawPart(ctx,layers[near].image,joints[near],beat[near],sway,beat.bob);
    drawPart(ctx,layers.head.image,[48,64],0,sway+beat.head*facing,beat.bob);
    return output;
  };
}

export function robotFloorPose(direction,step){
  // Match regular users: two turns, then an eight-frame freeze facing home.
  return {direction:step<8?(direction+2*step)%8:direction,bob:14+(step<8?step%2*2:BOUNCE[step-8])};
}
