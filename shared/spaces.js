// Player-added rooms form one horizontal chain per tier. Coordinates are derived
// from tier and insertion order; existing rooms without a level stay in the middle.
export const SPACES_PER_PLAYER=1,SPACE_SIZE=8,SPACE_NAME_MAX=24;
// A space starts SPACE_SIZE wide and deep; its owner can later make it wider or narrower.
export const SPACE_MIN_WIDTH=4,SPACE_MAX_WIDTH=16;
export const SPACE_FLOORS=['plain','wood','tiles','carpet'],SPACE_WALLS=['plain','tiles','checks','stripes'];
// A space's floor and back wall can carry an uploaded picture: 'tile' repeats it on every tile or
// wall segment, 'cover' stretches one copy across the whole floor or wall.
export const SPACE_FITS=['tile','cover'],SPACE_IMAGE_MAX=2*1024*1024;
export const isHexColor=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
// Tiers use disjoint tile coordinates: equal x/z offsets keep their screen columns
// aligned, while elevation and setback leave every room visible in the isometric view.
export const SPACE_LEVELS=[-1,0,1],TIER_STRIDE=12,TIER_RISE=48;
export const levelName=level=>level===1?'Upper':level===-1?'Lower':'Middle';
export function placeSpaces(spaces,startX){
  const ends=new Map();
  return spaces.map(space=>{
    const level=space.level??0,z=0-level*TIER_STRIDE,x=ends.get(level)??startX+z;
    ends.set(level,x+space.width);
    return {...space,level,x,z};
  });
}
export const spaceTiles=space=>Array.from({length:space.width*space.depth},(_,i)=>[space.x+i%space.width,space.z+Math.floor(i/space.width)]);
