// Image-generation prompts for new pieces, in the shape that has produced good results:
// one standalone transparent sprite, the room's pixel-art style, strict 2:1 isometric
// geometry with the orientation spelled out, then the design, then what to leave out.
const STYLE=`Art direction: genuinely match the reference image's retro hand-drawn pixel-art furniture: crisp stair-step contours, thin near-black outlines, compact shading ramps and slightly chunky proportions. Upper-left light, subtle shading within the asset, no external cast shadows. It must look like it belongs beside the room's existing sofas, fridge and DJ booth, not a realistic miniature render. Avoid glossy gradients, smooth vector edges, antialiasing, blurry texture or excessive tiny detail; keep details readable at game scale.`;
const DELIVER=`Deliver the COMPLETE piece alone, fully visible, with ample transparent margins and genuine transparent alpha outside it and through any gaps. No room wall, ceiling, floor platform, floor tiles, signs, text, typography, people, other furniture, labels, borders or watermark. Do not recreate the room screenshot; output only the new placeable sprite.`;
const KIND_NOTES={
  floor:'a freestanding floor piece',tabletop:'a small object that can also sit on a tabletop',table:'a table whose top other small objects can sit on',
  seat:'a seat an avatar can sit on, with the sitting surface about ten pixels above the floor at game scale',plant:'a potted plant',lamp:'a floor or table lamp',
  rug:'a flat rug lying on the floor, drawn as the floor diamond itself with no height',wall:'a wall-mounted piece seen flat against the wall',
};
export function assetPrompt({description,kind='floor',width=1,depth=1,facing='right',details=''}){
  const long=depth>width?'lower-left to upper-right':width>depth?'upper-left to lower-right':null;
  const front=facing==='left'?'lower-left':'lower-right';
  const against=facing==='left'?'the right-hand wall, whose wall lines run from UPPER LEFT down to LOWER RIGHT':'the left-hand wall, whose wall lines rise from LOWER LEFT to UPPER RIGHT';
  const wrong=facing==='left'?'lower-left to upper-right':'upper-left to lower-right';
  const tiles=width===1&&depth===1?'one game tile':`${width} by ${depth} game tiles`;
  const geometry=kind==='wall'
    ?`Geometry: it hangs flat on ${against}, so its face is drawn in the plane of that wall, foreshortened 2 horizontal pixels for 1 vertical pixel, facing toward ${front}. Strict orthographic 2:1 isometric projection, no perspective convergence.`
    :`Geometry: it covers ${tiles} and stands against ${against}, with its front facing the viewer toward ${front}${long?`. Its LONG AXIS runs ${long} on screen with 2 horizontal pixels for 1 vertical pixel`:''}. All verticals vertical, strict orthographic 2:1 isometric projection, no perspective convergence.${long?` Do NOT orient it along the opposite ${wrong} wall.`:''}`;
  return [
    `Create ONE standalone transparent isometric pixel-art ${kind==='wall'?'WALL PIECE':'FURNITURE PIECE'} for the game shown in the reference image.`,
    `The reference image is authoritative for the game's pixel-art style, furniture scale and orientation. ${description.trim()} It is ${KIND_NOTES[kind]??KIND_NOTES.floor}.`,
    geometry,
    details.trim()?`Design: ${details.trim()}`:'',
    STYLE,DELIVER,
  ].filter(Boolean).join('\n');
}
// A redraw of a reference picture as one sheet holding all four rotations of the piece.
export function sheetPrompt({description,kind='floor',width=1,depth=1,details='',hasReference=true}){
  const front=width===1?'one tile wide':`${width} tiles long`;
  const sized=kind==='wall'?`Its face is ${front} along the wall.`:`Its front is ${front} and it is ${depth===1?'one tile':`${depth} tiles`} deep, at the scale of the furniture in the room reference.`;
  const views=kind==='wall'
    ?['TOP-LEFT: hanging on the left-hand wall, whose lines rise from lower left to upper right, its face foreshortened 2:1 and turned toward the lower-right.',
      'TOP-RIGHT: hanging on the right-hand wall, whose lines fall from upper left to lower right, its face turned toward the lower-left.',
      'BOTTOM-LEFT: the same as top-left.','BOTTOM-RIGHT: the same as top-right.']
    :['TOP-LEFT: front facing the lower-right, its long side running from lower left up to upper right (as if standing against the left-hand wall).',
      'TOP-RIGHT: front facing the lower-left, its long side running from upper left down to lower right (as if against the right-hand wall).',
      'BOTTOM-LEFT: seen from behind, front facing the upper-left, long side running upper left to lower right.',
      'BOTTOM-RIGHT: seen from behind, front facing the upper-right, long side running lower left to upper right.'];
  return [
    `${hasReference?'REDRAW the object in reference image 1':'Create the object described below'} as ONE transparent pixel-art SPRITE SHEET for the game shown in the room reference image. ${hasReference?'Reference image 1 is a design reference only: keep its shapes, colours and character, but do not copy its rendering, perspective or background.':''} The room reference is authoritative for the game's hand-drawn pixel-art style, furniture scale and 2:1 isometric projection.`,
    `The piece: ${description.trim()} It is ${KIND_NOTES[kind]??KIND_NOTES.floor}. ${sized}`,
    details.trim()?`Design: ${details.trim()}`:'',
    `Layout: a 2 by 2 grid of FOUR views of the SAME piece, one per quadrant, each centred in its quadrant with clear transparent space around it and nothing crossing the grid midlines. Same size, same colours, same ground level and consistent details in every view; only the rotation changes. All verticals vertical, strict orthographic 2:1 isometric projection, no perspective convergence.`,
    views.join('\n'),
    STYLE,DELIVER.replace('the COMPLETE piece alone','the complete sheet with the four views and nothing else'),
  ].filter(Boolean).join('\n');
}
// A floor or wall picture for a player's space: the same art direction as the sprites, drawn flat
// at the room's own pixel scale (the game projects floors and skews walls itself).
const STYLE_SURFACE=`Art direction: genuinely match the room reference's retro hand-drawn pixel art: flat colour areas, a small palette of about 8 to 24 colours, crisp stair-step edges, thin near-black outlines where the room's own furniture has them, compact shading ramps with the light from the upper left. It must look drawn for the room's existing floors, wallpapers and furniture, not a photo, a realistic render or a smooth vector illustration. No antialiasing, gradients, glow, blur, noise, grain, lens effects, depth of field, text, watermark or signature.`;
const DELIVER_SURFACE=`Deliver the picture alone, filling the whole canvas edge to edge: no transparent margins (transparency only where the floor or wall finish beneath should show through), no room, furniture, people, border, frame or drop shadow.`;
export function surfacePrompt({surface='floor',fit='tile',description='',details='',width,height}){
  const seamless=fit==='tile';
  const what=surface==='wall'
    ?(seamless?'ONE seamless pixel-art WALLPAPER TEXTURE seen flat on (a front view, not isometric: the game skews it onto the wall itself) that repeats on every one-tile-wide segment of the back wall'
      :'ONE pixel-art WALL MURAL seen flat on (a front view, not isometric: the game skews it onto the wall itself) covering the whole back wall of an 8-tile-wide block of floor as one picture')
    :(seamless?'ONE seamless pixel-art FLOOR TEXTURE seen straight down (a top view, not isometric: the game projects it onto the floor itself) that repeats on every floor tile of an 8 by 8 block'
      :'ONE pixel-art FLOOR DESIGN seen straight down (a top view, not isometric: the game projects it onto the floor itself) covering an 8 by 8 block of floor tiles as one picture, like a big rug or a painted floor');
  return [
    `Create ${what} for the game shown in the room reference image.`,
    `${description.trim()}${details.trim()?` Design: ${details.trim()}`:''}`.trim(),
    `Draw it for exactly ${width} by ${height} game pixels, one game pixel per drawn pixel (a larger canvas is fine only as an exact multiple, say ${width*8} by ${height*8}, with each game pixel a solid ${8} by ${8} block): every detail must be at least one game pixel, readable at that size.${seamless?' Make the edges wrap: the right edge must continue seamlessly into the left edge and the bottom into the top, with no border, frame or vignette.':''}`,
    STYLE_SURFACE,DELIVER_SURFACE,
  ].filter(Boolean).join('\n');
}
