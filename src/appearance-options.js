export function appearanceChoices(catalog,group,gender){
  return catalog.choices[group].filter(model=>{
    const type=catalog.sets[group][model].gender;
    return !type||type==='U'||type===gender;
  });
}
export function appearanceGender(catalog,look,fallback='M'){
  for(const group of ['top','skin','bottom','hair']){
    const model=catalog.aliases[group]?.[look?.[group]?.model]??look?.[group]?.model;
    const gender=catalog.sets[group]?.[model]?.gender;
    if(gender==='M'||gender==='F')return gender;
  }
  return fallback;
}
export function changeAppearanceGender(catalog,look,gender){
  return Object.fromEntries(Object.entries(look).map(([group,part])=>{
    const choices=appearanceChoices(catalog,group,gender);
    const model=catalog.aliases[group]?.[part.model]??part.model;
    return [group,{...part,model:choices.includes(model)?model:choices[0]}];
  }));
}
