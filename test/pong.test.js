import test from 'node:test';
import assert from 'node:assert/strict';
import {advance,serve,arrival,hits,bounce,missed,controllers,computerTarget,stepTowards,planeX,WIDTH,HEIGHT,PADDLE_HEIGHT} from '../shared/pong.js';
test('the ball travels in a straight line and reflects off the top and bottom walls',()=>{
  const ball={x:64,y:36,vx:40,vy:40,at:0,serial:0};
  assert.deepEqual(advance(ball,500).x,84);
  const later=advance(ball,2000);assert.ok(later.y>=1.5&&later.y<=HEIGHT-1.5);
  assert.equal(advance(ball,0).y,36);
});
test('arrival, hit and miss agree on when the ball reaches a paddle plane',()=>{
  const ball={x:64,y:36,vx:-60,vy:0,at:1000,serial:3};
  const when=arrival(ball,'a');assert.ok(Math.abs(advance(ball,when).x-planeX('a'))<1e-9);
  assert.equal(arrival(ball,'b'),null);
  assert.equal(hits(ball,'a',36),true);assert.equal(hits(ball,'a',36+PADDLE_HEIGHT),false);
  assert.equal(missed(ball,'a',when),false);assert.equal(missed(ball,'a',when+1000),true);
});
test('a bounce sends the ball back faster at an angle set by where it struck the paddle',()=>{
  const ball={x:40,y:30,vx:-60,vy:0,at:0,serial:1},next=bounce(ball,'a',30+6,0);
  assert.ok(next.vx>0);assert.ok(next.vy<0);assert.equal(next.serial,2);
  assert.ok(Math.hypot(next.vx,next.vy)>Math.hypot(ball.vx,ball.vy));
  assert.equal(next.x,planeX('a'));
});
test('a serve starts from the centre after a delay towards the chosen side',()=>{
  const ball=serve(5000,'a');assert.equal(ball.x,WIDTH/2);assert.equal(ball.at,6000);assert.ok(ball.vx<0);
});
test('paddles fall to their players, or to the opponent when a side is empty or offline',()=>{
  assert.deepEqual(controllers({a:{id:'p1'},b:{id:'p2'}}),{a:'p1',b:'p2',soloA:false,soloB:false});
  assert.deepEqual(controllers({a:{id:'p1'},b:null}),{a:'p1',b:'p1',soloA:false,soloB:true});
  assert.deepEqual(controllers({a:{id:'p1',online:false},b:{id:'p2'}}),{a:'p2',b:'p2',soloA:true,soloB:false});
});
test('the computer paddle chases the predicted arrival at a capped speed',()=>{
  const ball={x:20,y:10,vx:60,vy:0,at:0,serial:0};
  assert.equal(computerTarget(ball,'b',0),10);
  assert.equal(stepTowards(36,10,.1,70),29);assert.equal(stepTowards(36,35,.1,70),35);
});
