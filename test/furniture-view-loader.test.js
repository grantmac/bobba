import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFurnitureViewLoader} from '../src/furniture-view-loader.js';
const def={id:'chair',parts:[{direction:2,file:'front'},{direction:2,file:'foreground',foreground:true},{direction:0,file:'back'}],views:[{direction:2,source:2},{direction:4,source:2,mirror:true},{direction:0,source:0},{direction:6,source:0,mirror:true}]};
test('loads only requested sources, shares mirrored views and keeps foreground layers',async()=>{
  const calls=[],load=createFurnitureViewLoader(async(_def,parts,views)=>calls.push({parts,views}));
  await Promise.all([load(def,2),load(def,4),load(def,2)]);
  assert.equal(calls.length,1);assert.deepEqual(calls[0].parts.map(p=>p.file),['front','foreground']);
  assert.deepEqual(calls[0].views.map(v=>v.direction),[2,4]);
  await load(def,6);assert.equal(calls.length,2);assert.deepEqual(calls[1].parts.map(p=>p.file),['back']);
  await load(def,0);assert.equal(calls.length,2);
});
test('failed loads can retry, and different furniture types do not share layers',async()=>{
  let count=0;const load=createFurnitureViewLoader(async()=>{if(++count===1)throw Error('offline');});
  await assert.rejects(load(def,2),/offline/);await load(def,2);
  await load({...def,id:'other'},2);assert.equal(count,3);
});
