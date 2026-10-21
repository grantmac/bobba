// Pong rules shared by the server and every client, so a ball state stamped with a
// server time plays out identically everywhere until a paddle event changes it.
export const WIDTH=128,HEIGHT=72,PADDLE_X=5,PADDLE_HEIGHT=16,PADDLE_WIDTH=2,BALL=1.5,WIN_SCORE=7;
export const SERVE_DELAY=1000,OVER_DELAY=4000,SPEED=55,SPEED_STEP=4,MAX_SPEED=120;

// Ball position at a time. x is linear; y reflects off the top and bottom walls.
export function advance(ball,now){
  const t=Math.max(0,now-ball.at)/1000,x=ball.x+ball.vx*t;
  const span=HEIGHT-BALL*2;let y=ball.y-BALL+ball.vy*t,vy=ball.vy;
  if(span>0){
    const period=span*2;y=((y%period)+period)%period;
    if(y>span){y=period-y;vy=-vy;}
  }
  return {x,y:y+BALL,vx:ball.vx,vy};
}
export function serve(now,towards='b'){
  const angle=(Math.random()*.6-.3)*Math.PI/2,direction=towards==='a'?-1:1;
  return {x:WIDTH/2,y:HEIGHT/2,vx:Math.cos(angle)*SPEED*direction,vy:Math.sin(angle)*SPEED,at:now+SERVE_DELAY,serial:0};
}
// Plane the ball must reach on a side, and whether it is heading there.
export const planeX=side=>side==='a'?PADDLE_X+PADDLE_WIDTH:WIDTH-PADDLE_X-PADDLE_WIDTH;
export const heading=(ball,side)=>side==='a'?ball.vx<0:ball.vx>0;
// Time at which the ball reaches a side's paddle plane, or null if it is moving away.
export function arrival(ball,side){
  if(!heading(ball,side)||ball.vx===0)return null;
  const dx=planeX(side)-ball.x;
  return ball.at+dx/ball.vx*1000;
}
export function hits(ball,side,paddleY){
  const when=arrival(ball,side);if(when===null)return false;
  const y=advance(ball,when).y;
  return Math.abs(y-paddleY)<=PADDLE_HEIGHT/2+BALL;
}
// New trajectory after a paddle hit: angle from where it struck the paddle, slightly faster.
export function bounce(ball,side,paddleY,now){
  const when=arrival(ball,side)??now,pos=advance(ball,when);
  const offset=Math.max(-1,Math.min(1,(pos.y-paddleY)/(PADDLE_HEIGHT/2)));
  const speed=Math.min(MAX_SPEED,Math.hypot(ball.vx,ball.vy)+SPEED_STEP),angle=offset*Math.PI/3;
  const direction=side==='a'?1:-1;
  return {x:planeX(side),y:pos.y,vx:Math.cos(angle)*speed*direction,vy:Math.sin(angle)*speed,at:when,serial:(ball.serial??0)+1};
}
// Has the ball gone past a side's goal line by the given time?
export function missed(ball,side,now){
  const pos=advance(ball,now);
  return side==='a'?pos.x<-BALL:pos.x>WIDTH+BALL;
}
// Who controls each paddle: its own player when present and online, otherwise the
// other side's player runs it (solo play against the computer paddle).
export function controllers(game){
  const human=side=>game[side]&&game[side].online!==false?game[side].id:null;
  const a=human('a'),b=human('b');
  return {a:a??b,b:b??a,soloA:!a&&!!b,soloB:!b&&!!a};
}
// Computer paddle: chases the ball's predicted arrival with limited speed, so it can lose.
export function computerTarget(ball,side,now){
  const when=arrival(ball,side);
  if(when===null||when<now)return HEIGHT/2;
  return advance(ball,when).y;
}
export function stepTowards(y,target,dt,speed=70){
  const limit=speed*dt;const d=target-y;
  const next=Math.abs(d)<=limit?target:y+Math.sign(d)*limit;
  return Math.max(PADDLE_HEIGHT/2,Math.min(HEIGHT-PADDLE_HEIGHT/2,next));
}
export const clampPaddle=y=>Math.max(PADDLE_HEIGHT/2,Math.min(HEIGHT-PADDLE_HEIGHT/2,y));
