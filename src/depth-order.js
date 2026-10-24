export function depthOrder(entries){
  const nodes=[...entries].sort((a,b)=>a.order-b.order||a.key.localeCompare(b.key));
  const edges=nodes.map(()=>[]),incoming=new Uint32Array(nodes.length);
  const sweep=nodes.map((node,index)=>({node,index})).sort((a,b)=>a.node.screen.left-b.node.screen.left);
  for(let i=0;i<sweep.length;i++){
    const {node:a,index:ai}=sweep[i];
    for(let j=i+1;j<sweep.length&&sweep[j].node.screen.left<a.screen.right;j++){
      const {node:b,index:bi}=sweep[j];
      if(a.screen.bottom<=b.screen.top||b.screen.bottom<=a.screen.top)continue;
      let direction=0;
      if(a.group!==b.group&&a.root===b.group)direction=1;
      else if(a.group!==b.group&&b.root===a.group)direction=-1;
      else if(a.group===b.group||a.seat===b.group||b.seat===a.group){
        direction=ai<bi?-1:1;
      }else{
        const ab=a.bounds.maxX<=b.bounds.minX||a.bounds.maxZ<=b.bounds.minZ;
        const ba=b.bounds.maxX<=a.bounds.minX||b.bounds.maxZ<=a.bounds.minZ;
        if(ab!==ba)direction=ab?-1:1;
      }
      if(direction){const from=direction<0?ai:bi,to=direction<0?bi:ai;edges[from].push(to);incoming[to]++;}
    }
  }
  const ready=[];
  function push(value){
    let i=ready.length;ready.push(value);
    while(i){
      const parent=(i-1)>>1;
      if(ready[parent]<=value)break;
      ready[i]=ready[parent];i=parent;
    }
    ready[i]=value;
  }
  function pop(){
    const value=ready[0],last=ready.pop();
    if(ready.length){
      let i=0;
      while(i*2+1<ready.length){
        let child=i*2+1;
        if(child+1<ready.length&&ready[child+1]<ready[child])child++;
        if(ready[child]>=last)break;
        ready[i]=ready[child];i=child;
      }
      ready[i]=last;
    }
    return value;
  }
  incoming.forEach((count,i)=>{if(!count)push(i);});
  const drawn=new Uint8Array(nodes.length),result=[];
  while(result.length<nodes.length){
    if(!ready.length)push(drawn.findIndex(value=>!value));
    const i=pop();if(drawn[i])continue;
    drawn[i]=1;result.push(nodes[i]);
    for(const next of edges[i])if(--incoming[next]===0&&!drawn[next])push(next);
  }
  return result;
}

export function footprintBounds(cells){
  return {minX:Math.min(...cells.map(c=>c[0])),maxX:Math.max(...cells.map(c=>c[0]))+1,
    minZ:Math.min(...cells.map(c=>c[1])),maxZ:Math.max(...cells.map(c=>c[1]))+1};
}
