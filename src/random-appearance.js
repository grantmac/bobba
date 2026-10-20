import {appearanceChoices} from './appearance-options.js';
export function randomAppearance(catalog,random=Math.random){
  const pick=values=>values[Math.floor(random()*values.length)];
  const gender=random()<.5?'M':'F';
  return Object.fromEntries(Object.keys(catalog.choices).map(group=>{
    const choices=appearanceChoices(catalog,group,gender),optional=choices.includes('none');
    const model=optional&&random()<.7?'none':pick(choices);
    return [group,{model,color:pick(catalog.colors[group]),color2:pick(catalog.colors[group])}];
  }));
}
