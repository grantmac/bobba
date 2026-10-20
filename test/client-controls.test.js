import {describe,it,expect} from 'vitest';
import {randomAppearance} from '../src/random-appearance.js';
import {pinchView,installTouchNavigation} from '../src/touch-navigation.js';
import {validateLook,validateFurniture,DEFAULT_ROOM} from '../convex/lib/rules.js';
import catalog from '../public/assets/appearance/catalog.json';
import furniture from '../public/assets/furniture/catalog.json';
describe('visitor and touch controls',()=>{
  it('generates varied complete appearances accepted by the server',()=>{
    const seen=new Set();for(let i=0;i<100;i++){const look=randomAppearance(catalog);expect(()=>validateLook(look)).not.toThrow();seen.add(JSON.stringify(look));}expect(seen.size).toBeGreaterThan(90);
  });
  it('keeps the world point beneath the pinch centre and bounds zoom',()=>{
    const view={zoom:1,panX:10,panY:20},origin={x:200,y:300},before={x:250,y:350,distance:100},after={x:270,y:370,distance:200};
    const result=pinchView(view,before,after,origin);expect(result).toEqual({zoom:2,panX:-10,panY:10});
    expect((after.x-origin.x-result.panX)/result.zoom).toBe((before.x-origin.x-view.panX)/view.zoom);
    expect(pinchView(view,before,{...after,distance:10000},origin).zoom).toBe(4);
    expect(pinchView(view,before,{...after,distance:1},origin).zoom).toBe(.75);
  });
  it('suppresses walking after dragging and pinching but preserves a tap',()=>{
    const handlers={},element={addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:400,height:600})};let view={zoom:1,panX:0,panY:0},cancelled=0;
    installTouchNavigation(element,{getView:()=>view,setView:v=>view=v,cancelTap:()=>cancelled++});
    const event=(type,id,x,y)=>({type,pointerType:'touch',pointerId:id,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}});
    handlers.pointerdown(event('pointerdown',1,100,100));let up=event('pointerup',1,100,100);handlers.pointerup(up);expect(up.stopped).toBeUndefined();
    handlers.pointerdown(event('pointerdown',1,100,100));handlers.pointermove(event('pointermove',1,130,110));up=event('pointerup',1,130,110);handlers.pointerup(up);expect(up.stopped).toBe(true);expect(view.panX).toBe(30);
    handlers.pointerdown(event('pointerdown',1,100,100));handlers.pointerdown(event('pointerdown',2,200,100));handlers.pointermove(event('pointermove',2,250,100));expect(view.zoom).toBe(1.5);
    handlers.pointerup(event('pointerup',2,250,100));up=event('pointerup',1,100,100);handlers.pointerup(up);expect(up.stopped).toBe(true);expect(cancelled).toBeGreaterThan(0);
  });
  it('provides a mirrored Macintosh view and permits both orientations on a table',()=>{
    const mac=furniture.find(d=>d.id==='custom_macintosh');expect(mac.views).toEqual([{direction:2,source:2,mirror:false},{direction:4,source:2,mirror:true}]);
    for(const rotation of [2,4])expect(()=>validateFurniture([{id:'table',type:'small_table_armas',rotation:0,x:2,z:2},{id:'mac',type:mac.id,rotation,x:2,z:2,supportId:'table'}],DEFAULT_ROOM)).not.toThrow();
  });
});
