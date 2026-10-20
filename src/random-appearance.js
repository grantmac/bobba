export function randomAppearance(catalog,random=Math.random){
  const pick=values=>values[Math.floor(random()*values.length)];
  return Object.fromEntries(Object.keys(catalog.choices).map(group=>{
    const optional=catalog.choices[group].includes('none');
    const model=optional&&random()<.7?'none':pick(catalog.choices[group]);
    return [group,{model,color:pick(catalog.colors[group]),color2:pick(catalog.colors[group])}];
  }));
}
