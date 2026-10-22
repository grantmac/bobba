// This contract is shared by the server and the untrusted-program boundary.
export const PROGRAM_API_VERSION=1;
export const PROGRAM_SOURCE_MAX=64*1024,PROGRAM_STATE_MAX=8*1024;
export function programState(value){
  function check(v,depth=0){
    if(depth>16)throw new Error('Program state is nested too deeply.');
    if(v===null||typeof v==='boolean'||typeof v==='string')return;
    if(typeof v==='number'&&Number.isFinite(v))return;
    if(Array.isArray(v)){for(const entry of v)check(entry,depth+1);return;}
    if(v&&Object.getPrototypeOf(v)===Object.prototype){for(const entry of Object.values(v))check(entry,depth+1);return;}
    throw new Error('Program state must be JSON data.');
  }
  check(value);
  if(new TextEncoder().encode(JSON.stringify(value)).length>PROGRAM_STATE_MAX)throw new Error('Program state must fit in 8 KiB.');
  return value;
}
export function validateProgram({source,initialState={},apiVersion=1}){
  if(apiVersion!==PROGRAM_API_VERSION)throw new Error('Unsupported furniture program API version.');
  if(typeof source!=='string'||!source.trim()||new TextEncoder().encode(source).length>PROGRAM_SOURCE_MAX)throw new Error('Program source must be 1 to 65536 bytes.');
  return {apiVersion,source,initialState:programState(initialState)};
}
// Visual effects never change placement, collision, ownership, or the actual player record.
export function programVisual(value,views,frameCount=0){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid program visual.');
  const result={};
  for(const [key,v] of Object.entries(value)){
    if(key==='direction'){
      if(!views.includes(v))throw new Error('Program direction must be an available asset view.');
    }else if(key==='frame'){
      if(v!==null&&(!Number.isInteger(v)||v<0||v>=frameCount))throw new Error('Program frame must be an available animation frame.');
    }else if(key==='display'){
      if(v!==null){
        if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['text','color','corners'].includes(k)))throw new Error('Invalid program display.');
        if(typeof v.text!=='string'||!/^[-0-9]{1,6}$/.test(v.text)||typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color))throw new Error('Invalid program display text or color.');
        const p=v.corners;
        if(!Array.isArray(p)||p.length!==6||p.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Invalid program display corners.');
        const x=p[2]+p[4]-p[0],y=p[3]+p[5]-p[1];
        if(x<0||x>1||y<0||y>1||(p[2]-p[0])*(p[5]-p[1])-(p[3]-p[1])*(p[4]-p[0])<=.001)throw new Error('Invalid program display area.');
      }
    }else if(key==='animation'||key==='carryOccupants'){
      if(typeof v!=='boolean')throw new Error(`Invalid ${key}.`);
    }else{
      const ranges={offsetX:[-64,64],offsetY:[-64,64],opacity:[.15,1]},range=Object.hasOwn(ranges,key)?ranges[key]:null;
      if(!range||!Number.isFinite(v)||v<range[0]||v>range[1])throw new Error(`Invalid program visual field: ${key}.`);
    }
    result[key]=v;
  }
  return result;
}
export function programHost(players){return players.filter(p=>p.kind!=='bot').map(p=>p.id??p._id).sort()[0]??null;}
