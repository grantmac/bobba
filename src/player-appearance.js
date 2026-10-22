// Presence updates omit the look. Keep one appearance source for every pose of
// this player/version, including drink poses requested after later movement updates.
export function createPlayerFrames(player,{fetchLook,frames,robotFrames}){
  if(player.kind==='bot')return ()=>robotFrames();
  const look=player.look?Promise.resolve(player.look):fetchLook(player.id,player.lookVersion);
  return (carry=false)=>look.then(value=>frames(value,carry));
}
