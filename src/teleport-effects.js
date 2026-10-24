import * as THREE from 'three';

const DEPART_MS=280,ARRIVE_MS=420;

// Effects use the same world pixels and depth ordering as the avatar sprites.
export function createTeleportEffects({scene,project,centerY}){
  const transitions=new Map(),bursts=new Set();
  function burst(point,phase,now){
    const group=new THREE.Group(),geometry=new THREE.PlaneGeometry(3,3);
    const material=new THREE.MeshBasicMaterial({color:'#c5fff0',transparent:true,depthTest:false,depthWrite:false});
    for(let i=0;i<18;i++)group.add(new THREE.Mesh(geometry,material));
    const ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-27,0,0),new THREE.Vector3(0,13,0),new THREE.Vector3(27,0,0),new THREE.Vector3(0,-13,0)
    ]),new THREE.LineBasicMaterial({color:'#a4ffe8',transparent:true,depthTest:false,depthWrite:false}));
    group.add(ring);scene.add(group);
    bursts.add({group,geometry,material,ring,point:{...point},phase,start:now});
  }
  function cancel(mesh){
    const state=transitions.get(mesh);
    if(!state)return;
    transitions.delete(mesh);mesh.scale.set(1,1,1);mesh.material.opacity=1;state.resolve();
  }
  function start(mesh,{from=null,to,reducedMotion=false,onArrive=()=>{}}){
    cancel(mesh);
    const now=performance.now(),departure=from&&!reducedMotion?DEPART_MS:0;
    return new Promise(resolve=>{
      transitions.set(mesh,{from,to,start:now,departure,duration:reducedMotion?140:ARRIVE_MS,reducedMotion,onArrive,arrived:false,resolve});
      if(departure)burst(from,'out',now);
    });
  }
  function sample(mesh,fallback,now){
    const state=transitions.get(mesh);
    if(!state)return fallback;
    if(now-state.start<state.departure)return {...state.from,moving:false};
    if(!state.arrived){
      state.arrived=true;state.onArrive();
      if(!state.reducedMotion)burst(state.to,'in',now);
    }
    return fallback;
  }
  function apply(mesh,now){
    const state=transitions.get(mesh);
    if(!state)return;
    const age=now-state.start,leaving=age<state.departure;
    const progress=Math.min(1,Math.max(0,(age-state.departure)/state.duration));
    if(!leaving&&progress===1){cancel(mesh);return;}
    const amount=leaving?1-age/state.departure:1-(1-progress)**3;
    mesh.material.opacity=amount;
    if(!state.reducedMotion){
      const sx=.15+.85*amount,sy=1+.18*(1-amount);
      mesh.scale.set(sx,sy,1);
      // Keep the feet anchored while the figure stretches into the beam.
      mesh.position.y+=45*(sy-1);
    }
  }
  function update(now){
    for(const effect of bursts){
      const {group,geometry,material,ring,point,phase,start}=effect;
      const t=Math.min(1,(now-start)/500);
      if(t===1){scene.remove(group);geometry.dispose();material.dispose();ring.geometry.dispose();ring.material.dispose();bursts.delete(effect);continue;}
      const p=project(point.x,point.z),order=300+(point.x+point.z-1)*10+9.6;
      group.position.set(Math.round(p.x),centerY()-Math.round(p.y),0);
      material.opacity=(1-t)*.9;ring.material.opacity=(1-t)*.8;
      ring.scale.setScalar(.6+t*.9);ring.renderOrder=order;
      for(let i=0;i<18;i++){
        const angle=i*2.39996,radius=10+(i%4)*4+(phase==='out'?t:1-t)*13;
        const height=(i%6)*11+(phase==='out'?t:1-t)*22;
        group.children[i].position.set(Math.round(Math.cos(angle)*radius),Math.round(height+Math.sin(angle)*radius*.4),0);
        group.children[i].renderOrder=order;
      }
    }
  }
  return {start,sample,apply,update,cancel,
    depart(point,reducedMotion){if(!reducedMotion)burst(point,'out',performance.now());},
    active:mesh=>transitions.has(mesh)};
}
