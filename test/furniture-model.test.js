import test from 'node:test';
import assert from 'node:assert/strict';
import {footprint,canPlace,blocksTile,restoreItems,moveWithContents,pickupWithContents,surfaceHeight,seatFor,approachFor,canHang,wallAnchor} from '../src/furniture-model.js';
const definitions=new Map([
  ['sofa',{width:2,depth:1,category:'Seating',views:[{direction:0},{direction:2},{direction:4},{direction:6}]}],
  ['rug',{width:3,depth:2,category:'Rugs',views:[{direction:0}]}]
]);
const sofa={id:'a',type:'sofa',rotation:0,x:2,z:2};
const room=(x,z)=>x>=0&&z>=0&&x<8&&z<8&&!(x<2&&z<2);
test('rotation changes occupied tiles',()=>{
 assert.deepEqual(footprint(sofa,definitions.get('sofa')),[[2,2],[3,2]]);
 assert.deepEqual(footprint({...sofa,rotation:2},definitions.get('sofa')),[[2,2],[2,3]]);
});
test('placement rejects room edges, cutouts, other furniture and avatar',()=>{
 assert.equal(canPlace({...sofa,x:7},[],definitions,room),false);
 assert.equal(canPlace({...sofa,x:0,z:0},[],definitions,room),false);
 assert.equal(canPlace({...sofa,id:'b'},[sofa],definitions,room),false);
 assert.equal(canPlace(sofa,[],definitions,room,{x:3.5,z:2.5}),false);
 assert.equal(canPlace(sofa,[sofa],definitions,room,{x:4.5,z:4.5}),true);
});
test('rugs can sit beneath furniture and remain walkable',()=>{
 const rug={id:'r',type:'rug',rotation:0,x:2,z:2};
 assert.equal(canPlace(rug,[sofa],definitions,room,{x:2.5,z:2.5}),true);
 assert.equal(blocksTile(2,2,[rug],definitions),false);
 assert.equal(blocksTile(3,2,[rug,sofa],definitions),true);
 assert.equal(blocksTile(3,2,[{...sofa,x:null,z:null}],definitions),false);
});
test('saved items reject duplicate ids, unknown types and invalid coordinates',()=>{
 assert.deepEqual(restoreItems([sofa,sofa,{...sofa,id:'b',type:'missing'},{...sofa,id:'c',rotation:9},{...sofa,id:'d',x:NaN},{...sofa,id:'e',x:null,z:null}],definitions),[sofa,{...sofa,id:'e',x:null,z:null}]);
 assert.deepEqual(restoreItems({},definitions),[]);
});
const stackDefinitions=new Map([...definitions,
 ['table',{width:2,depth:1,category:'Tables',surfaceHeight:29,views:[{direction:0},{direction:2},{direction:4},{direction:6}]}],
 ['duck',{width:1,depth:1,category:'Decor',views:[{direction:0}]}]
]);
const table={id:'table',type:'table',x:2,z:3,rotation:0};
const duck={id:'duck',type:'duck',x:3,z:3,rotation:0,supportId:'table'};
test('tabletop placement requires support, containment and free surface space',()=>{
 assert.equal(canPlace(duck,[table,duck],stackDefinitions,room),true);
 assert.equal(surfaceHeight(duck,[table,duck],stackDefinitions),29);
 assert.equal(canPlace({...duck,supportId:'missing'},[table],stackDefinitions,room),false);
 assert.equal(canPlace({...duck,x:4},[table],stackDefinitions,room),false);
 assert.equal(canPlace({...duck,id:'second'},[table,duck],stackDefinitions,room),false);
 assert.equal(canPlace({...duck,supportId:undefined},[table],stackDefinitions,room),false);
 assert.equal(canPlace({...sofa,supportId:'table'},[table],stackDefinitions,room),false);
 assert.deepEqual(restoreItems([table,duck],stackDefinitions),[table,duck]);
});
test('moving and rotating a table carries contents inside the new footprint',()=>{
 const moved=moveWithContents([table,duck],{...table,x:4,z:4,rotation:2},stackDefinitions);
 assert.deepEqual(moved[1],{...duck,x:4,z:5});
 assert.equal(canPlace(moved[1],moved,stackDefinitions,room),true);
 const turned=moveWithContents(moved,{...moved[0],rotation:4},stackDefinitions);
 assert.deepEqual(turned[1],{...duck,x:4,z:4});
});
test('picking up or deleting a table returns its contents to inventory',()=>{
 const expected={id:'duck',type:'duck',x:null,z:null,rotation:0};
 assert.deepEqual(pickupWithContents([table,duck],'table',true),[expected]);
 assert.deepEqual(pickupWithContents([table,duck],'table'),[{...table,x:null,z:null},expected]);
});
test('seats come from Seating footprints or a per-rotation vehicle seat',()=>{
 const car={width:3,depth:2,category:'Vehicles',views:[{direction:0},{direction:2}],seat:{2:{cell:[1,1],direction:4,offset:[-8,6]}}};
 assert.deepEqual(seatFor(sofa,definitions.get('sofa')),{cells:[[2,2],[3,2]],direction:0,offsetX:0,offsetY:undefined});
 assert.deepEqual(seatFor({id:'c',type:'car',rotation:2,x:4,z:3},car),{cells:[[5,4]],direction:4,offsetX:-8,offsetY:6});
 assert.equal(seatFor({id:'c',type:'car',rotation:0,x:4,z:3},car),null);
 assert.equal(seatFor({id:'c',type:'car',rotation:2,x:null,z:null},car),null);
 assert.equal(seatFor({id:'r',type:'rug',rotation:0,x:0,z:0},definitions.get('rug')),null);
});
test('a bar exposes only its three stools and resolves the chosen stool offset',()=>{
 const item={id:'bar',type:'custom_bar',x:4,z:10,rotation:2};
 const def={category:'Seating',width:4,depth:3,seat:{2:{cells:[[2,1],[2,2],[2,3]],direction:6,offsets:[[4,-10],[0,-10],[-4,-10]]}}};
 const seat=seatFor(item,def,{x:6.5,z:13.5});
 assert.deepEqual(seat.cells,[[6,11],[6,12],[6,13]]);
 assert.equal(seat.direction,6);assert.equal(seat.offsetX,-4);assert.equal(seat.offsetY,-10);
});
test('using a piece picks the nearest free tile beside it or its table and faces the piece',()=>{
 const defs=new Map([...definitions,['table',{width:2,depth:1,category:'Tables',surfaceHeight:30,views:[{direction:0}]}],['decks',{width:1,depth:1,category:'Decor',views:[{direction:0}]}]]);
 const items=[{id:'t',type:'table',rotation:0,x:0,z:3},{id:'d',type:'decks',rotation:0,x:1,z:3,supportId:'t'}];
 const free=(x,z)=>room(x,z)&&!blocksTile(x,z,items,defs);
 assert.deepEqual(approachFor(items[1],items,defs,{x:4.5,z:3.5},free),{x:2,z:3,direction:6});
 assert.deepEqual(approachFor(items[1],items,defs,{x:1.5,z:4.5},free),{x:1,z:4,direction:0});
 assert.deepEqual(approachFor(items[1],items,defs,{x:0.5,z:2.5},free),{x:0,z:2,direction:4});
 assert.equal(approachFor(items[1],items,defs,{x:4.5,z:3.5},()=>false),null);
});

test('wall pieces hang on continuous wall, never block the floor and keep their wall position',()=>{
 const defs=new Map([...definitions,['speaker',{width:1,depth:1,category:'Wall',wallWidth:48,views:[{direction:2},{direction:4}]}]]);
 const hasWall=(x,z,side)=>room(x,z)&&(side==='left'?!room(x-1,z):!room(x,z-1));
 const speaker={id:'s',type:'speaker',rotation:2,x:0,z:3,u:.5,height:60};
 assert.equal(canHang(speaker,defs.get('speaker'),hasWall),true);
 assert.equal(canHang({...speaker,z:2},defs.get('speaker'),hasWall),false,'the cutout corner breaks the wall above');
 assert.equal(canHang({...speaker,x:3},defs.get('speaker'),hasWall),false);
 assert.equal(canHang({...speaker,rotation:4},defs.get('speaker'),hasWall),false);
 assert.equal(canHang({...speaker,height:100},defs.get('speaker'),hasWall),false);
 assert.equal(canPlace(speaker,[],defs,room,undefined,()=>0,hasWall),true);
 assert.equal(canPlace({...sofa,x:0,z:3},[speaker],defs,room),true,'furniture can stand under a hung piece');
 assert.equal(blocksTile(0,3,[speaker],defs),false);
 assert.deepEqual(wallAnchor(speaker),{x:-16,y:-52});
 assert.deepEqual(wallAnchor({...speaker,rotation:4}),{x:16,y:-52});
 assert.deepEqual(restoreItems([speaker,{...speaker,id:'t',u:undefined},{...sofa,u:.5,height:3}],defs),[speaker]);
 assert.deepEqual(pickupWithContents([speaker],'s'),[{id:'s',type:'speaker',rotation:2,x:null,z:null}]);
});
test('items keep the player who built them',()=>{
 const built={...sofa,owner:'p1'};
 assert.deepEqual(restoreItems([built,{...sofa,id:'b',owner:7}],definitions),[built]);
 assert.deepEqual(pickupWithContents([built],'a')[0].owner,'p1');
});
