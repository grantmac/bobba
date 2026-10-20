import test from 'node:test';
import assert from 'node:assert/strict';
import {footprint,canPlace,blocksTile,restoreItems,moveWithContents,pickupWithContents,surfaceHeight} from '../src/furniture-model.js';
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
