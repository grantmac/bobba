import test from 'node:test';
import assert from 'node:assert/strict';
import {roomLayout,tileDrop,walkingDrop,inPit,pitSeat,tileAtPoint,backWallTiles,onWalkway,STEP_DOWN} from '../shared/room-layout.js';
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
test('added spaces chain onto the right of the lounge along the back wall',()=>{
  const spaces=[{id:'a',width:4,depth:5},{id:'b',width:3,depth:8}];
  const plain=roomLayout(main),layout=roomLayout(main,spaces);
  assert.deepEqual(plain.spaces,[]);assert.equal(plain.extentWidth,21);
  const [a,b]=layout.spaces;
  assert.equal(a.x,plain.lounge.x+plain.lounge.width);assert.equal(a.z,0);
  assert.equal(b.x,a.x+a.width);assert.equal(b.z,0);
  assert.equal(a.tiles.length,20);assert.equal(b.tiles.length,24);
  // A walk-only strip runs along the front of the lounge and the spaces once there is a space.
  assert.equal(plain.walkway,null);assert.deepEqual(plain.walkwayTiles,[]);
  assert.deepEqual(layout.walkway,{x:plain.lounge.x,z:8,width:plain.lounge.width+7,depth:1});
  assert.equal(layout.walkwayTiles.length,plain.lounge.width+7);
  assert.ok(onWalkway(layout,b.x+1,8));assert.ok(!onWalkway(layout,b.x+1,7));assert.ok(!onWalkway(plain,plain.lounge.x,8));
  assert.deepEqual(tileAtPoint(layout,(b.x-8)*32+16,(b.x+8)*16+8,0),{x:b.x,z:8});
  assert.equal(layout.spaceTiles.length,44);assert.equal(layout.tiles.length,plain.tiles.length+44+layout.walkway.width);
  assert.equal(layout.extentWidth,plain.extentWidth+7);assert.equal(layout.depth,plain.depth);
  assert.equal(tileDrop(layout,b.x+1,b.z+7),0);
  assert.deepEqual(tileAtPoint(layout,(a.x-b.z)*32+16,(a.x+a.z)*16+8,0),{x:a.x,z:a.z});
  assert.equal(backWallTiles(layout).length,plain.lounge.width+7);
  assert.ok(backWallTiles(layout).every(([,z])=>z===0));
});
