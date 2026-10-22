// Views can share one source (mirrored furniture). Build those views together, but
// never fetch another source until a placed copy actually needs that rotation.
export function createFurnitureViewLoader(build){
  const loading=new Map();
  const load=(definition,direction)=>{
    const view=definition.views.find(v=>v.direction===direction)??definition.views[0];
    const key=`${definition.id}:${view.source}`;
    if(!loading.has(key)){
      const promise=Promise.resolve().then(()=>build(definition,
        definition.parts.filter(p=>p.direction===view.source),
        definition.views.filter(v=>v.source===view.source)));
      loading.set(key,promise);
      promise.catch(()=>{if(loading.get(key)===promise)loading.delete(key);});
    }
    return loading.get(key);
  };
  load.delete=id=>{for(const key of loading.keys())if(key.startsWith(`${id}:`))loading.delete(key);};
  return load;
}
