// Room pixels use screen coordinates: x right, y down, relative to the anchor tile's top.
export const isoPoint=(x,z)=>({x:(x-z)*32,y:(x+z)*16});
export function seatSpots(asset){
  if(!asset.seat)return undefined;
  const {x,z,height,offsetX=0,offsetY=0}=asset.seat,w=asset.width,d=asset.depth;
  const cell={2:[x,z],4:[z,x],6:[d-1-x,w-1-z],0:[w-1-z,d-1-x]},side={2:1,4:-1,6:-1,0:1};
  return Object.fromEntries(asset.views.map(({direction})=>[direction,{cell:cell[direction],direction,height,offset:[offsetX*side[direction]||0,26-height+offsetY]}]));
}
export function seatReport(asset){
  if(asset.category!=='Seating')return null;
  const spots=seatSpots(asset);
  return {coordinates:'Room pixels relative to the anchor tile top; x right, y down. Tile (0,0) is the top/back tile, not the front end. Avatar anchor is the game sprite anchor, not the seat surface.',
    rotations:asset.views.map(({direction})=>{
      const w=direction%4===2?asset.depth:asset.width,d=direction%4===2?asset.width:asset.depth;
      const cells=spots?[spots[direction].cell]:Array.from({length:w*d},(_,i)=>[i%w,Math.floor(i/w)]);
      const spot=spots?.[direction],height=spot?.height??10,offset=spot?.offset??[0,16];
      return {direction,seats:cells.map(([x,z])=>{const p=isoPoint(x+.5,z+.5);return {tile:[x,z],surface:{x:p.x+(offset[0]??0),y:p.y-height+(asset.seat?.offsetY??0)},avatar_anchor:{x:p.x+offset[0],y:p.y+offset[1]}};})};
    })};
}
export function designBrief({kind='floor',width=1,depth=1,frames,display_width}){
  return {scale:{tile_px:[64,32],avatar_height_px:95,display_width_px:display_width??(kind==='wall'?48:kind==='tabletop'?40:kind==='rug'?(width+depth)*32:Math.min(200,Math.round((width+depth)*32*.85))),units:'Room pixels; uploaded PNG resolution is separate.'},
    footprint:{width,depth,origin:'Tile (0,0) is the top/back tile. At rotation 2, +x goes down-right across depth and +z goes down-left along width. The footprint swaps axes at rotations 4 and 0.',projection:'screen x = (x-z)*32; screen y = (x+z)*16; tile centre adds (0,16).'},
    views:frames?[{direction:2,facing:'lower-right',source:2,mirror:false},{direction:4,facing:'lower-left',source:2,mirror:true}]:[{quadrant:'top-left',direction:2,facing:'lower-right'},{quadrant:'top-right',direction:4,facing:'lower-left'},{quadrant:'bottom-left',direction:6,facing:'upper-left'},{quadrant:'bottom-right',direction:0,facing:'upper-right'}],
    capabilities:{seating:kind==='seat',supports_items:kind==='table',can_use_table:['floor','tabletop','plant','lamp'].includes(kind),foreground:kind==='seat',wall_rotations:kind==='wall'?[2,4]:[]},
    checklist:['Match the drawn base to the footprint in every view; overhang is a visual warning, not automatically invalid.','Use real transparency or a solid key colour, never a painted checkerboard.','Upload then call preview_asset before publishing. Inspect all rotations, the labelled footprint and seated test avatar.','For seats, specify seat_x, seat_z and seat_height. A foreground mask can put a rim in front of the sitter.','For tabletop placement, use support_id from room_map.tables.','room_picture renders on the server by default; renderer tab explicitly uses an open room browser.']};
}
