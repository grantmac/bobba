import {WIDTH,HEIGHT,PADDLE_X,PADDLE_HEIGHT,PADDLE_WIDTH,BALL,WIN_SCORE,advance,arrival,heading,hits,bounce,missed,controllers,computerTarget,stepTowards,clampPaddle} from '../shared/pong.js';

// Pong projected on the lounge wall. The ball flies deterministically from the server's
// last stamped state; whoever controls a paddle reports hits and misses as the ball
// reaches their side, predicting the bounce locally so play feels immediate.
export function createPong({now,me,send,density=2}){
  const canvas=document.createElement('canvas');canvas.width=WIDTH*density;canvas.height=HEIGHT*density;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  let game={status:'idle'},predicted=null,reported={hit:-1,miss:-1},local={a:HEIGHT/2,b:HEIGHT/2},sent={a:{y:null,at:0},b:{y:null,at:0}};
  let pointerY=null,keys=0,lastTick=null,dirty=true,lastKey='';
  const ball=()=>predicted&&predicted.serial>(game.ball?.serial??-1)?predicted:game.ball;
  function receive(state){
    game=state??{status:'idle'};
    if(predicted&&(game.ball?.serial??-1)>=predicted.serial)predicted=null;
    dirty=true;
  }
  function mySides(){
    if(game.status!=='playing'||!me())return [];
    const who=controllers(game);return ['a','b'].filter(side=>who[side]===me());
  }
  const ownSide=()=>game.a?.id===me()?'a':game.b?.id===me()?'b':null;
  function update(time){
    const dt=lastTick===null?0:Math.min(.1,(time-lastTick)/1000);lastTick=time;
    const sides=mySides(),own=ownSide(),current=ball();
    for(const side of sides){
      if(side===own){
        if(pointerY!==null)local[side]=clampPaddle(pointerY);
        else if(keys)local[side]=clampPaddle(local[side]+keys*95*dt);
      }else local[side]=stepTowards(local[side],computerTarget(current,side,time-120),dt,62);
      // Stream the paddle at ten a second when it has moved.
      if(sent[side].y===null||Math.abs(sent[side].y-local[side])>.4){if(time-sent[side].at>=100){sent[side]={y:local[side],at:time};send.paddle(side,local[side]).catch(()=>{});}}
      if(current&&heading(current,side)){
        const when=arrival(current,side);
        if(when!==null&&time>=when){
          if(hits(current,side,local[side])){
            if(reported.hit!==current.serial){reported.hit=current.serial;predicted=bounce(current,side,local[side],time);send.hit(side,local[side],current.serial).catch(()=>{});}
          }else if(missed(current,side,time)&&reported.miss!==current.serial){reported.miss=current.serial;send.miss(side,current.serial).catch(()=>{});}
        }
      }
    }
    return draw(time);
  }
  const text=(string,x,y,size=7,color='#e8f0ff',align='center')=>{ctx.font=`bold ${size*density}px Verdana,sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(string,x*density,y*density);};
  const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x*density),Math.round(y*density),Math.round(w*density),Math.round(h*density));};
  function draw(time){
    const current=ball(),sides=mySides(),own=ownSide();
    const paddleY=side=>sides.includes(side)?local[side]:(game.paddles?.[side]?.y??HEIGHT/2);
    const pos=current&&game.status==='playing'&&time>=current.at?advance(current,time):null;
    const key=game.status==='idle'?`idle:${Math.floor(time/700)%2}`:`${game.status}:${Math.round(paddleY('a'))}:${Math.round(paddleY('b'))}:${pos?Math.round(pos.x)+','+Math.round(pos.y):'-'}:${game.scores?.a}:${game.scores?.b}:${Math.floor(time/500)%2}`;
    if(key===lastKey&&!dirty)return false;lastKey=key;dirty=false;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    rect(0,0,WIDTH,HEIGHT,'rgba(10,13,24,.82)');rect(0,0,WIDTH,1,'rgba(120,170,255,.35)');rect(0,HEIGHT-1,WIDTH,1,'rgba(120,170,255,.35)');
    if(game.status==='idle'){
      text('PONG',WIDTH/2,26,16,'#dbe8ff');
      text(Math.floor(time/700)%2?'WALK UP AND CLICK':'',WIDTH/2,48,6,'#9fb6e0');
      return true;
    }
    for(let y=2;y<HEIGHT;y+=6)rect(WIDTH/2-.5,y,1,3,'rgba(200,220,255,.45)');
    text(String(game.scores?.a??0),WIDTH/2-18,10,10,'#cfe0ff');text(String(game.scores?.b??0),WIDTH/2+18,10,10,'#cfe0ff');
    const nameA=game.a?.name??'',nameB=game.b?.name??'';
    text(nameA||'COMPUTER',4,HEIGHT-5,5,game.a&&game.a.online!==false?'#9fb6e0':'#6b7a99','left');
    text(nameB||'COMPUTER',WIDTH-4,HEIGHT-5,5,game.b&&game.b.online!==false?'#9fb6e0':'#6b7a99','right');
    // Advertise an open paddle so a second player knows they can take it.
    const openSide=game.status==='playing'&&(!game.b||game.b.online===false)?'b':game.status==='playing'&&(!game.a||game.a.online===false)?'a':null;
    if(openSide&&!own&&Math.floor(time/500)%2)text('CLICK TO JOIN',openSide==='b'?WIDTH-4:4,HEIGHT-13,5,'#ffe08a',openSide==='b'?'right':'left');
    rect(PADDLE_X,paddleY('a')-PADDLE_HEIGHT/2,PADDLE_WIDTH,PADDLE_HEIGHT,own==='a'?'#ffffff':'#d7e3ff');
    rect(WIDTH-PADDLE_X-PADDLE_WIDTH,paddleY('b')-PADDLE_HEIGHT/2,PADDLE_WIDTH,PADDLE_HEIGHT,own==='b'?'#ffffff':'#d7e3ff');
    if(pos&&pos.x>=-BALL&&pos.x<=WIDTH+BALL)rect(pos.x-BALL,pos.y-BALL,BALL*2,BALL*2,'#ffffff');
    if(game.status==='over'){const winner=game.winner==='a'?(nameA||'Computer'):(nameB||'Computer');text(`${winner} WINS`,WIDTH/2,HEIGHT/2,8,'#ffe08a');}
    else if(current&&time<current.at&&Math.floor(time/500)%2)text('READY',WIDTH/2,HEIGHT/2,7,'#9fb6e0');
    return true;
  }
  return {canvas,width:WIDTH,height:HEIGHT,receive,update,
    get playing(){return !!ownSide()&&game.status==='playing';},
    get joined(){return !!ownSide();},
    pointer(fraction){pointerY=fraction===null?null:fraction*HEIGHT;},
    keys(direction){keys=direction;if(direction)pointerY=null;},
    async toggle(){if(ownSide())await send.leave();else await send.join();},
  };
}
