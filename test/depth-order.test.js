import test from 'node:test';
import assert from 'node:assert/strict';
import {depthOrder,footprintBounds} from '../src/depth-order.js';
const node=(key,x,z,w=1,d=1,extra={})=>({key,group:key,order:x+z+w+d-2,
  bounds:{minX:x,maxX:x+w,minZ:z,maxZ:z+d},screen:{left:0,right:100,top:0,bottom:100},...extra});
const keys=entries=>depthOrder(entries).map(entry=>entry.key);

test('long furniture does not cover a neighbour beside its far end on either axis',()=>{
  for(const rotated of [false,true]){
    const table=rotated?node('table',2,2,5,1):node('table',2,2,1,5);
    const front=rotated?node('front',2,3):node('front',3,2);
    const back=rotated?node('back',2,1):node('back',1,2);
    for(const entries of [[table,front,back],[front,back,table],[back,table,front]])assert.deepEqual(keys(entries),['back','table','front']);
  }
});
test('continuous avatar positions cross the correct edge of a long piece',()=>{
  const table=node('table',2,2,1,5);
  for(const z of [2.1,3.5,6.9]){
    assert.deepEqual(keys([table,node('avatar',3.01,z,0,0)]),['table','avatar']);
    assert.deepEqual(keys([table,node('avatar',1.99,z,0,0)]),['avatar','table']);
  }
});
test('sitter is between authored seat back and foreground; contents stay above their support',()=>{
  const back=node('back',2,2,1,3,{group:'seat',order:4});
  const front=node('front',2,2,1,3,{group:'seat',order:7});
  const sitter=node('sitter',2.5,3.5,0,0,{seat:'seat',order:6});
  assert.deepEqual(keys([front,sitter,back]),['back','sitter','front']);
  assert.deepEqual(keys([node('cup',2,2,1,3,{root:'table',order:7}),node('table',2,2,1,3,{order:8})]),['table','cup']);
});
test('diagonally separated footprints and equal depth use stable keys',()=>{
  assert.deepEqual(keys([node('b',2,0),node('a',0,2)]),['a','b']);
  assert.deepEqual(keys([node('b',0,0),node('a',0,0)]),['a','b']);
});
test('screen-disjoint sprites do not force an unnecessary order',()=>{
  const table=node('table',2,2,1,5),front=node('front',3,2,1,1,{screen:{left:200,right:300,top:0,bottom:100}});
  assert.deepEqual(keys([table,front]),['front','table']);
});
test('cyclic custom geometry remains complete and deterministic',()=>{
  const a=node('a',0,0,1,4),b=node('b',1,0,3,1),c=node('c',1,1,1,3);
  // Authored parts can conflict with geometry; the solver must still terminate.
  b.group='a';b.order=-1;
  const first=keys([a,b,c]);assert.equal(new Set(first).size,3);assert.deepEqual(keys([c,b,a]),first);
});
test('footprint bounds use tile edges, including rotated and negative coordinates',()=>{
  assert.deepEqual(footprintBounds([[2,-4],[2,-3],[2,-2]]),{minX:2,maxX:3,minZ:-4,maxZ:-1});
});
