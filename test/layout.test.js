import test from 'node:test';
import assert from 'node:assert/strict';
import {roomLayout,tileDrop,walkingDrop,inPit,pitSeat,STEP_DOWN} from '../shared/room-layout.js';
const main=Array.from({length:64},(_,i)=>[i%8,Math.floor(i/8)]);
test('the lounge has a sunken pit one step down with a walkway all round',()=>{
  const layout=roomLayout(main),p=layout.pit;
  assert.equal(p.width,6);assert.equal(p.depth,4);
  assert.ok(p.x>layout.lounge.x&&p.x+p.width<layout.lounge.x+layout.lounge.width);
  assert.ok(p.z>layout.lounge.z&&p.z+p.depth<layout.lounge.z+layout.lounge.depth);
  assert.equal(layout.pitTiles.length,24);
  assert.equal(tileDrop(layout,p.x,p.z),STEP_DOWN);assert.equal(tileDrop(layout,p.x-1,p.z),0);
  assert.equal(inPit(layout,p.x+2,p.z+1),true);assert.equal(inPit(layout,p.x+2,p.z+p.depth),false);
});
test('walking into the pit descends smoothly over the edge',()=>{
  const layout=roomLayout(main),p=layout.pit,mid=p.z+1.5;
  assert.equal(walkingDrop(layout,mid,p.x-.5),0);
  assert.ok(Math.abs(walkingDrop(layout,mid,p.x)-STEP_DOWN/2)<1e-9);
  assert.equal(walkingDrop(layout,mid,p.x+.5),STEP_DOWN);
  assert.equal(walkingDrop(layout,mid,p.x+p.width+.5),0);
});
test('the pit ring seats players facing the rug; the rug itself is floor',()=>{
  const layout=roomLayout(main),p=layout.pit;
  assert.deepEqual(pitSeat(layout,p.x+2,p.z),{direction:4});
  assert.deepEqual(pitSeat(layout,p.x+2,p.z+p.depth-1),{direction:0});
  assert.deepEqual(pitSeat(layout,p.x,p.z+1),{direction:2});
  assert.deepEqual(pitSeat(layout,p.x+p.width-1,p.z+1),{direction:6});
  assert.equal(pitSeat(layout,p.x+2,p.z+1),null);assert.equal(pitSeat(layout,p.x-1,p.z),null);
});
