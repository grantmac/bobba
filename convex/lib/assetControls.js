import {v} from 'convex/values';

export const controlsArg=v.object({
  use:v.union(v.string(),v.null()),
  power:v.union(v.object({onLabel:v.string(),offLabel:v.string()}),v.null()),
});

export function validateControls(controls,asset){
  const label=value=>{
    const text=value.normalize('NFKC').trim();
    if(!text||text.length>24||/[\u0000-\u001f\u007f]/.test(text))throw new Error('Button labels must be 1 to 24 characters without control characters.');
    return text;
  };
  if(controls.use&&!asset.program)throw new Error('Attach a program before adding an interaction button.');
  if(controls.power&&!asset.program&&!asset.switchable)throw new Error('A power button needs a program or a switchable animation.');
  return {use:controls.use===null?null:label(controls.use),power:controls.power===null?null:{onLabel:label(controls.power.onLabel),offLabel:label(controls.power.offLabel)}};
}
