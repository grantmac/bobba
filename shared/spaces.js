// Player-added blocks of floor ("spaces"). Each one is a rectangle chained onto the right-hand
// end of the back wall: the first joins the lounge, every later one joins the space before it.
// Positions are never stored; they follow from the order the spaces were added in. Every space
// is the same fixed size, so the chain stays even and a player only chooses a name and a floor.
export const SPACE_LIMIT=8,SPACES_PER_PLAYER=1,SPACE_SIZE=8,SPACE_NAME_MAX=24;
export const SPACE_FLOORS=['plain','wood','tiles','carpet'],SPACE_WALLS=['plain','tiles','checks','stripes'];
// A space's floor and back wall can carry an uploaded picture: 'tile' repeats it on every tile or
// wall segment, 'cover' stretches one copy across the whole floor or wall.
export const SPACE_FITS=['tile','cover'],SPACE_IMAGE_MAX=2*1024*1024;
export const isHexColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
// Lay the spaces out from a starting corner: each sits flush against the previous one's right edge.
export function placeSpaces(spaces,startX){
  let x=startX;
  return spaces.map(space=>{const placed={...space,x,z:0};x+=space.width;return placed;});
}
export const spaceTiles=space=>Array.from({length:space.width*space.depth},(_,i)=>[space.x+i%space.width,space.z+Math.floor(i/space.width)]);
