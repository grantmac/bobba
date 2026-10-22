// A program alone does not imply a clickable action or a power button.
export function furnitureControls(def){
  if(def?.controls)return def.controls;
  // Preserve the switch explicitly requested by older animation-building agents.
  return {use:null,power:def?.switchable||def?.id==='custom_dj_decks'?{onLabel:'Turn on',offLabel:'Turn off'}:null};
}
