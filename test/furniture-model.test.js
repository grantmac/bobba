import test from 'node:test';
import assert from 'node:assert/strict';
import {footprint,canPlace,blocksTile,restoreItems} from '../src/furniture-model.js';
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
