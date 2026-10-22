const SHEET='/assets/bot/tnarg-robot-v3.png';
const COLUMNS=[3,0,0,1,1,2,2,3];
let loading;

// Return the same pose keys and 96×112 cells as the clothing renderer.
// One cached sheet serves every bot; each player still owns its GPU atlas.
export function robotFrames(){
  if(!loading)loading=new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{
      const frames=new Map();
      function pose(direction,row,{bob=0,stride=0}={}){
        const canvas=document.createElement('canvas');canvas.width=96;canvas.height=112;
        const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
        const x=COLUMNS[direction]*96,y=row*112;
        if(stride){
          ctx.drawImage(image,x,y,96,85,0,bob,96,85);
          ctx.drawImage(image,x,y+85,48,27,0,85+stride,48,27);
          ctx.drawImage(image,x+48,y+85,48,27,48,85-stride,48,27);
        }else ctx.drawImage(image,x,y,96,112,0,bob,96,112);
        return canvas;
      }
      for(let direction=0;direction<8;direction++){
        frames.set(`${direction}:-1`,pose(direction,0));
        frames.set(`${direction}:sit`,pose(direction,2));
        for(let step=0;step<4;step++)frames.set(`${direction}:${step}`,pose(direction,0,{bob:step%2?-1:0,stride:[0,-1,0,1][step]}));
        for(let step=0;step<2;step++){
          frames.set(`${direction}:wave:${step}`,pose(direction,step===0?1:0));
          frames.set(`${direction}:sit-wave:${step}`,pose(direction,2,{bob:step?-1:0}));
        }
        for(let step=0;step<8;step++)frames.set(`${direction}:dance:${step}`,pose(direction,step%2,{bob:step%2?-2:0}));
        for(let step=0;step<16;step++)frames.set(`${direction}:breakdance:${step}`,pose((direction+2*step)%8,2,{bob:14}));
      }
      resolve(frames);
    };
    image.onerror=()=>{loading=null;reject(new Error('Tnarg’s robot avatar could not be loaded.'));};
    image.src=SHEET;
  });
  return loading;
}
