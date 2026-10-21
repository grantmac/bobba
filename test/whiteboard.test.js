import test from 'node:test';
import assert from 'node:assert/strict';
import {applyUpdate} from '../shared/whiteboard.js';
test('updates append new strokes, replace known ones and honour a newer clear',()=>{
  const s1={id:'a',serial:1,points:[0,0,1,1]},s1b={id:'a',serial:3,points:[0,0,1,1,2,2]},s2={id:'b',serial:2,points:[5,5,6,6]};
  let state=applyUpdate([],{serial:2,clearedSerial:0,strokes:[s1,s2]});
  assert.deepEqual(state.strokes.map(s=>s.id),['a','b']);assert.equal(state.serial,2);
  state=applyUpdate(state.strokes,{serial:3,clearedSerial:0,strokes:[s1b]},state);
  assert.deepEqual(state.strokes.map(s=>s.serial),[2,3]);assert.equal(state.strokes[1].points.length,6);
  state=applyUpdate(state.strokes,{serial:4,clearedSerial:4,strokes:[]},state);
  assert.deepEqual(state.strokes,[]);assert.equal(state.clearedSerial,4);
  state=applyUpdate(state.strokes,{serial:5,clearedSerial:4,strokes:[{id:'c',serial:5,points:[1,1,2,2]}]},state);
  assert.deepEqual(state.strokes.map(s=>s.id),['c']);
});
