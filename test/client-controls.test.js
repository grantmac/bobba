import {describe,it,expect} from 'vitest';
import {randomAppearance} from '../src/random-appearance.js';
import {pinchView,installTouchNavigation} from '../src/touch-navigation.js';
import {validateLook,validateFurniture,DEFAULT_ROOM} from '../convex/lib/rules.js';
import catalog from '../public/assets/appearance/catalog.json';
import furniture from '../public/assets/furniture/catalog.json';
import {roomLayout,tileAtPoint,tileDrop,walkingDrop,DANCE_ROWS,STEP_DOWN} from '../shared/room-layout.js';
import {shapes} from '../convex/lib/catalog.js';
import {findPath,wallTileSet} from '../convex/lib/rules.js';
import {wallExists} from '../shared/stickies.js';
describe('lower dance floor',()=>{
  it('adds five full-width rows without moving existing tiles, with connected paths in every shape',()=>{
    expect(DANCE_ROWS).toBe(5);
    for(const [shape,main] of Object.entries(shapes)){
      const layout=roomLayout(main),room={options:{...DEFAULT_ROOM,shape},furniture:[]};
      expect(layout.tiles.slice(0,main.length)).toEqual(main);
      expect(layout.danceTiles).toHaveLength(layout.width*5);
      const [x,z]=main[0];
      const path=findPath(room,{x:x+.5,z:z+.5},{x:layout.width-1,z:layout.depth-1});
      expect(path,shape).not.toBeNull();
    }
  });
  it('picks tiles on both levels and smoothly moves avatars over the step',()=>{
    const layout=roomLayout(shapes.square);
    for(const [x,z] of layout.tiles){
      const px=(x-z)*32,py=(x+z+1)*16+tileDrop(layout,x,z);
      expect(tileAtPoint(layout,px,py,0)).toEqual({x,z});
    }
    expect(walkingDrop(layout,layout.danceStart-.5)).toBe(0);
    expect(walkingDrop(layout,layout.danceStart)).toBe(STEP_DOWN/2);
    expect(walkingDrop(layout,layout.danceStart+.5)).toBe(STEP_DOWN);
  });
  it('reserves occupied lower tiles and prevents furniture crossing the step',()=>{
    const layout=roomLayout(shapes.square),room={options:DEFAULT_ROOM,furniture:[]};
    expect(findPath(room,{x:1.5,z:1.5},{x:2,z:layout.danceStart},null,new Set([`2,${layout.danceStart}`]))).toBeNull();
    const item={id:'dj',type:'custom_dj_decks',rotation:2,x:2,z:layout.danceStart};
    expect(()=>validateFurniture([item],DEFAULT_ROOM)).not.toThrow();
    expect(()=>validateFurniture([{...item,z:layout.danceStart-1}],DEFAULT_ROOM)).toThrow('straddle');
    expect(wallExists({x:0,z:layout.danceStart,side:'left'},wallTileSet(DEFAULT_ROOM))).toBe(true);
    expect(wallExists({x:2,z:layout.danceStart,side:'right'},wallTileSet(DEFAULT_ROOM))).toBe(false);
  });
});
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
  it('pans with the left mouse button, preserves clicks and cancels a lost drag',()=>{
    const handlers={},element={style:{},addEventListener:(type,fn)=>handlers[type]=fn,setPointerCapture(){}};let view={zoom:1,panX:0,panY:0},cancelled=0;
    installTouchNavigation(element,{getView:()=>view,setView:v=>view=v,cancelTap:()=>cancelled++});
    const event=(type,x,y,button=0)=>({type,pointerType:'mouse',pointerId:1,button,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}});
    handlers.pointerdown(event('pointerdown',100,100));let up=event('pointerup',102,101);handlers.pointerup(up);expect(up.stopped).toBeUndefined();expect(cancelled).toBe(0);
    handlers.pointerdown(event('pointerdown',100,100));handlers.pointermove(event('pointermove',104,100));handlers.pointermove(event('pointermove',130,115));expect(view).toEqual({zoom:1,panX:30,panY:15});expect(element.style.cursor).toBe('grabbing');
    handlers.pointermove(event('pointermove',100,100));up=event('pointerup',100,100);handlers.pointerup(up);expect(up.stopped).toBe(true);expect(element.style.cursor).toBe('');
    handlers.pointerdown(event('pointerdown',100,100,2));handlers.pointermove(event('pointermove',200,200,2));expect(view.panX).toBe(0);
    handlers.pointerdown(event('pointerdown',100,100));handlers.pointermove(event('pointermove',120,100));handlers.lostpointercapture(event('lostpointercapture',120,100));handlers.pointermove(event('pointermove',200,100));expect(view.panX).toBe(20);
  });
});

import {appearanceChoices,appearanceGender,changeAppearanceGender} from '../src/appearance-options.js';
describe('Man/Woman appearance switch',()=>{
  it('includes every matching top and unisex jackets in both choices',()=>{
    expect(appearanceChoices(catalog,'top','M')).toHaveLength(28);
    expect(appearanceChoices(catalog,'top','F')).toHaveLength(40);
    expect(appearanceChoices(catalog,'jackets','M')).toEqual(appearanceChoices(catalog,'jackets','F'));
    for(const group of Object.keys(catalog.choices))for(const gender of ['M','F'])expect(appearanceChoices(catalog,group,gender).length).toBeGreaterThan(0);
  });
  it('changes incompatible styles, keeps colours and leaves the saved look untouched',()=>{
    const original=randomAppearance(catalog,()=>.1),saved=structuredClone(original);
    const next=changeAppearanceGender(catalog,original,'F');
    expect(original).toEqual(saved);expect(()=>validateLook(next)).not.toThrow();
    for(const group of Object.keys(next)){expect(appearanceChoices(catalog,group,'F')).toContain(next[group].model);expect(next[group].color).toBe(original[group].color);}
    expect(appearanceGender(catalog,next)).toBe('F');
  });
  it('randomizes new visitors within one style category',()=>{
    for(let i=0;i<50;i++){
      const look=randomAppearance(catalog),genders=new Set(Object.entries(look).map(([group,p])=>catalog.sets[group][p.model].gender).filter(g=>g==='M'||g==='F'));
      expect(genders.size).toBeLessThanOrEqual(1);
    }
  });
});
