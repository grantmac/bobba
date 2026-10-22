import {describe,it,expect} from 'vitest';
import {randomAppearance} from '../src/random-appearance.js';
import {pinchView,installTouchNavigation} from '../src/touch-navigation.js';
import {displayScaleForZoom} from '../src/view-scale.js';
import {validateLook,validateFurniture,DEFAULT_ROOM} from '../convex/lib/rules.js';
import catalog from '../public/assets/appearance/catalog.json';
import furniture from '../public/assets/furniture/catalog.json';
import {roomLayout,tileAtPoint,tileDrop,walkingDrop,DANCE_ROWS,STEP_DOWN} from '../shared/room-layout.js';
import {shapes} from '../convex/lib/catalog.js';
import {findPath,wallTileSet} from '../convex/lib/rules.js';
import {wallExists} from '../shared/stickies.js';
describe('lower dance floor',()=>{
  it('extends the terrace to ten full-width rows, preserving the original five and the wall in every shape',()=>{
    expect(DANCE_ROWS).toBe(10);
    for(const [shape,main] of Object.entries(shapes)){
      const layout=roomLayout(main),room={options:{...DEFAULT_ROOM,shape},furniture:[]};
      expect(layout.tiles.slice(0,main.length)).toEqual(main);
      expect(layout.danceTiles).toHaveLength(layout.width*10);
      const original=Array.from({length:layout.width*5},(_,i)=>[i%layout.width,layout.danceStart+Math.floor(i/layout.width)]);
      expect(layout.danceTiles.slice(0,original.length)).toEqual(original);
      const [x,z]=main[0];
      const path=findPath(room,{x:x+.5,z:z+.5},{x:layout.width-1,z:layout.depth-1});
      expect(path,shape).not.toBeNull();
      const walls=wallTileSet(room.options);
      expect(wallExists({x:0,z:layout.depth-1,side:'left'},walls),shape).toBe(true);
      expect(wallExists({x:0,z:layout.depth,side:'left'},walls),shape).toBe(false);
      expect(()=>validateFurniture([{id:'cone',type:'custom_traffic_cone',rotation:2,x:1,z:layout.depth-1}],room.options)).not.toThrow();
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
  it('keeps distant spaces under moving fingers through snapped zoom steps and limits',()=>{
    for(const pixelRatio of [1,2,3]){
      const scaleForZoom=zoom=>displayScaleForZoom(zoom,1,pixelRatio),origin={x:195,y:422};
      let view={zoom:1,panX:-8000,panY:-4000},previous={x:180,y:350,distance:100};
      const world={x:(previous.x-origin.x-view.panX)/scaleForZoom(view.zoom),y:(previous.y-origin.y-view.panY)/scaleForZoom(view.zoom)};
      // Small moves within one render step, crossings in both directions, then both limits.
      for(const distance of [102,110,125,150,200,350,500,300,175,120,100,80,50,40]){
        const next={x:previous.x+3,y:previous.y-2,distance};
        view=pinchView(view,previous,next,origin,scaleForZoom);
        expect(origin.x+view.panX+world.x*scaleForZoom(view.zoom)).toBeCloseTo(next.x,8);
        expect(origin.y+view.panY+world.y*scaleForZoom(view.zoom)).toBeCloseTo(next.y,8);
        previous=next;
      }
    }
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

import {createRoomRadio,POOLSUITE_STREAM} from '../src/room-radio.js';
describe('shared deck radio',()=>{
  function setup(play=async()=>{}){
    const audio={src:'',volume:1,paused:false,readyState:4,plays:0,pauses:0,play(){this.plays++;return play();},pause(){this.pauses++;},load(){},removeAttribute(){this.src='';},addEventListener(){}};
    let state;const radio=createRoomRadio({audio,onState:value=>state=value});return {audio,radio,state:()=>state};
  }
  it('waits for room entry, keeps one stream for repeated power signals and stops when power ends',async()=>{
    const {audio,radio,state}=setup();radio.receive(true,false);expect(audio.plays).toBe(0);
    radio.receive(true,true);await radio.unlock();await Promise.resolve();expect(audio.src).toBe(POOLSUITE_STREAM);expect(state().playing).toBe(true);
    radio.receive(true,true);expect(audio.plays).toBe(1);
    radio.receive(false,true);expect(audio.src).toBe('');expect(state().active).toBe(false);
    radio.receive(true,true);await Promise.resolve();radio.receive(false,true);expect(audio.src).toBe('');
  });
  it('retries blocked playback on a gesture and keeps local mute across power changes',async()=>{
    let blocked=true;const {audio,radio,state}=setup(async()=>{if(blocked)throw Error('autoplay');});
    radio.receive(true,true);await Promise.resolve();expect(state().playing).toBe(false);
    blocked=false;await radio.unlock();expect(state().playing).toBe(true);
    radio.setMuted(true);radio.receive(false,true);radio.receive(true,true);await radio.unlock();expect(audio.plays).toBe(2);expect(audio.src).toBe('');
    radio.setMuted(false);await Promise.resolve();expect(state().playing).toBe(true);
    radio.setVolume(.12);expect(audio.volume).toBe(.12);
  });
  it('silences zero volume even when iOS ignores volume writes, without overriding explicit mute',async()=>{
    const {audio,radio}=setup();
    Object.defineProperty(audio,'volume',{get:()=>1,set:()=>{}});
    radio.receive(true,true);await Promise.resolve();
    radio.setVolume(0);radio.setMuted(false);
    expect(audio.volume).toBe(1);expect(audio.muted).toBe(true);expect(radio.audible).toBe(false);
    radio.setVolume(.5);expect(audio.muted).toBe(false);expect(radio.audible).toBe(true);
    radio.setMuted(true);radio.setVolume(.8);expect(audio.muted).toBe(true);expect(audio.src).toBe('');
    await radio.unlock();expect(audio.src).toBe('');
    radio.setMuted(false);await Promise.resolve();expect(audio.muted).toBe(false);expect(radio.audible).toBe(true);
    radio.restore({muted:false,volume:0});expect(audio.muted).toBe(true);
    radio.restore({muted:true,volume:.5});expect(audio.muted).toBe(true);
    radio.restore({muted:false,volume:.5});expect(audio.muted).toBe(false);
  });
  it('reports audible playback only while the stream can actually play sound',async()=>{
    const {audio,radio}=setup();expect(radio.audible).toBe(false);
    radio.receive(true,true);await Promise.resolve();expect(radio.audible).toBe(true);
    audio.readyState=2;expect(radio.audible).toBe(false);
    audio.readyState=4;audio.paused=true;expect(radio.audible).toBe(false);
    audio.paused=false;radio.setVolume(0);expect(radio.audible).toBe(false);
    radio.setVolume(.5);expect(radio.audible).toBe(true);
    radio.setMuted(true);expect(radio.audible).toBe(false);
    radio.setMuted(false);await Promise.resolve();expect(radio.audible).toBe(true);
    radio.close();expect(radio.audible).toBe(false);
  });
  it('ducks the music while someone else talks and eases back after a hold',()=>{
    vi.useFakeTimers();
    try{
      const frames=[];const audio={src:'',volume:1,play(){return Promise.resolve();},pause(){},load(){},removeAttribute(){},addEventListener(){}};
      const radio=createRoomRadio({audio,schedule:fn=>frames.push(fn)});
      const drain=()=>{while(frames.length)frames.shift()();};
      radio.setVolume(.8);expect(audio.volume).toBeCloseTo(.8);
      radio.duck(true);drain();expect(radio.ducked).toBe(true);expect(audio.volume).toBeCloseTo(.8*.08,5);
      radio.duck(false);drain();expect(radio.ducked).toBe(true);
      vi.advanceTimersByTime(950);drain();expect(radio.ducked).toBe(false);expect(audio.volume).toBeCloseTo(.8,5);
      radio.duck(true);radio.duck(false);radio.duck(true);vi.advanceTimersByTime(2000);drain();expect(radio.ducked).toBe(true);
      radio.setVolume(.5);expect(audio.volume).toBeCloseTo(.5*.08,5);
    }finally{vi.useRealTimers();}
  });
  it('ignores a late play result after the room switches off',async()=>{
    let resolve;const {radio,state,audio}=setup(()=>new Promise(done=>resolve=done));
    radio.receive(true,true);radio.receive(false,true);resolve();await Promise.resolve();expect(state().playing).toBe(false);expect(audio.src).toBe('');
  });
});

import {vi} from 'vitest';
describe('right-hand jacuzzi and parking deck',()=>{
 it('keeps the water clear, connects the surround in every room shape and preserves existing tiles',()=>{
  for(const [shape,main] of Object.entries(shapes)){
   const layout=roomLayout(main),room={options:{...DEFAULT_ROOM,shape},furniture:[]},tiles=new Set(layout.tiles.map(cell=>cell.join(','))),start={x:main[0][0]+.5,z:main[0][1]+.5};
   expect(layout.pool.x).toBe(layout.width);expect(layout.tiles.slice(0,main.length)).toEqual(main);
   for(const [x,z] of layout.waterTiles){expect(tiles.has(`${x},${z}`)).toBe(true);expect(findPath(room,start,{x,z})).not.toBeNull();expect(wallExists({x,z,side:'left'},wallTileSet(room.options))).toBe(false);}
   for(const [x,z] of layout.poolDeckTiles){expect(findPath(room,start,{x,z}),shape).not.toBeNull();expect(tileAtPoint(layout,(x-z)*32,(x+z+1)*16,0)).toEqual({x,z});}
  }
 });
});

 it('parks the Porsche in every orientation and keeps furniture out of the hot tub',()=>{
  const layout=roomLayout(shapes.square),parking=layout.parking;
  for(const rotation of [0,2,4,6])expect(()=>validateFurniture([{id:'car',type:'custom_porsche',rotation,x:parking.x,z:parking.z}],DEFAULT_ROOM)).not.toThrow();
  const [x,z]=layout.waterTiles[0];expect(()=>validateFurniture([{id:'chair',type:'small_chair_armas',rotation:0,x,z}],DEFAULT_ROOM)).toThrow();
 });
