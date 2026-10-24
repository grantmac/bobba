---
name: habbo-room
description: Open and connect to the shared room at chat.grantm.ac from ChatGPT / Codex, Claude, or another agent, and build furniture from pictures or ideas. Use when the user pastes the room URL, asks to enter or connect, asks what they have built, or wants pieces placed, moved or removed.
---

# Habbo Room

## Introduce capabilities when connected

After the first successful authenticated `status` or `connection_status` check,
confirm the returned player name and give a brief introduction. Lead with
custom shirts, tops, hats, helmets and jackets in the normal style editor, with all eight
angles and walking, waving and dancing poses; clothing belongs to the avatar
and needs no room placement. Then mention timed quizzes and treasure hunts
with saved scores, furniture creation, and decorating a space. Follow the
returned `capabilitySummary` and `connectionInstructions` for the current list.
Offer “make me a space helmet” or “host a music quiz” as examples and ask what
they want to create. Wait for their choice before building or equipping
anything. Do not repeat the introduction on routine status checks.

## Custom avatar clothing

Use `design_wearable` for a custom shirt/T-shirt/top (`top`), hat or helmet (`headwear`), or jacket (`jacket`). It returns the exact image prompt and an avatar alignment guide. Generate only the clothing on transparency, keeping every cell aligned. Upload with `upload_url`, inspect `preview_wearable`, then save with `submit_wearable`. These pieces belong to the avatar and appear in the **normal appearance editor**, under Hats, Tops or Jackets. They need no room placement and the player does not need to be online. Use `list_wearables` to inspect the player's creations and `equip_wearable` only when they ask to wear one (null removes the slot). Never change another player's outfit. All pieces have eight viewing angles. Tops and jackets have 36 pose rows covering walking, sitting, standing/seated waves, all eight dance frames, and drink-carrying variants; follow the design tool's guide, not the furniture sheet layout.

Custom tops **replace the base shirt**. Do not describe them as limited to overlays or switch to browser editing for a custom shirt. `design_wearable` returns two images for tops: the avatar alignment guide and a clothing-only fitting template, plus `template_model` and a structured `layout` with each direction and pose row. Repaint every visible template pixel with opaque clothing artwork. Keep the template's shirt cut, sleeves and cell positions; use a different built-in top before designing if the player wants a different cut. Pass the returned `template_model` unchanged to preview and submission. Missing coverage is rejected and stray pixels are clipped; the renderer places the chest and sleeves in their original layers under hands, hair and outerwear. The template controls fit; inspect the generated design in the preview for visual quality.

## Playable activities

Use `create_activity` to build a timed buzzer quiz or treasure hunt in the player's own space. Find the space and placed treasure item IDs with `room_map`. Quizzes take prompts, 2–6 choices and a zero-based correct answer; those answers stay on the server. Hunts take item IDs and clues. `list_activities` returns deadlines, scores, the current round and the player's saved progress. `manage_activity` starts the next round, finishes it, or deletes the activity; each new round keeps cumulative scores. `play_activity` joins, buzzes, answers or collects on behalf of this player only. Read the current round before answering or collecting. The player must be present in that space, and within two tiles of a treasure to collect it. The styled Activities modal exposes the same flows to players. Do not claim arbitrary furniture programs can write the scoreboard.

The `habbo-room` MCP server (https://chat.grantm.ac/api/mcp) builds catalogue
pieces for one player of the shared isometric room. It never draws anything
itself: you draw the sprite sheet with your image-generation tool, upload the
PNG, and the server cuts it into the piece.

## 0. Enter from a URL

When the user asks to open the room or connect their agent, read
https://chat.grantm.ac/connect.md and follow its entry flow. The public
https://chat.grantm.ac/connect link is suitable for pasting into a chat.
Use the client's in-app browser when available; otherwise open the usual
browser. The player approves the connection in the room; never click that
approval on their behalf. Confirm the returned player name matches the browser.
The portable helper keeps credentials locally and supports ChatGPT / Codex,
Claude Code, and other local MCP clients. Web-only clients need their own
supported connector setup; do not claim a new MCP registration is available
until the client has loaded it. The helper can call the hosted tools immediately.

## 1. The key

Every call needs the player's agent key as the plugin's API key (sent as a
Bearer token). If a tool answers "No agent key", ask the user to open the room,
go to **Catalogue → Build with your agent**, press **Create agent key** and
paste it when the plugin asks. `status` shows who you build for and what they
have.

## 2. Picture → piece (the normal path)

Read the `brief` and footprint diagram returned by `design_asset` before generating.
Tiles are 64×32 room pixels; compare scale with a roughly 95 px avatar. Source PNG
resolution is separate. At rotation 2, +x goes down-right across depth and +z goes
down-left along width. Tile `(0,0)` is the top/back tile. Sheet order is **2,4 / 6,0**:
lower-right, lower-left / upper-left, upper-right. Four-view sheets use separate
artwork; animation strips and single sprites supply one view and its horizontal
mirror, directions 2 and 4 only. Wall pieces hang only at 2 or 4.

### Lock the projection before adding detail

Use the room's exact **2:1 pixel-isometric** projection: every grid-aligned
edge travels **2 pixels across for 1 up or down** (26.565°, not a generic 30°
isometric camera). For example, an edge spanning 64 pixels horizontally rises
or falls 32 pixels. Keep uprights vertical and opposite edges parallel.
This ratio applies at every source resolution, in every view and animation frame.
Check long edges of bases, tops, frames and panels, not curves, tapered legs or
deliberately sloped parts. Keep construction guides out of the final sprite.

For wall pieces, the face's top and bottom edges must follow the wall exactly:
rotation 2 rises to the right (slope -1/2); rotation 4 falls to the right (+1/2).
The face's side edges remain vertical, and details follow that same wall plane.
Do not draw a front-on rectangle and merely tilt it. A wrong drawn angle needs
regeneration; placement nudges or resizing cannot correct its projection.


For any picture that is not already a finished game sprite (photos, logos,
concept art, screenshots, real objects):

1. Call `design_asset` with a short `name`, a one-sentence `description`, the
   `details` worth keeping (materials, colours, parts), the `kind` and the
   footprint (`width` tiles along the front, `depth` tiles back). Pick the kind
   carefully: `seat` lets avatars sit, `table` lets tabletop pieces stack on it,
   `tabletop` is a small object, `rug` lies flat, `wall` hangs on a wall,
   `plant`, `lamp`, otherwise `floor`. Pass the saved path of the user's picture
   as `reference_image_path` so it is listed among the images to attach.
   For a `seat`, say where the figure sits when you submit it: `seat_x` and
   `seat_z` pick the tile within the footprint (as placed facing lower-right:
   x across the depth, z along the width; a lone stool is 0,0) and
   `seat_height` is the seat top in pixels above the floor (about 10 for a
   chair, 20 for a bar stool, 0 for a cushion); `seat_offset_x` and
   `seat_offset_y` nudge the seated figure sideways or up and down by a few
   pixels when the art sits off the tile centre. Without them the figure sits
   on every tile at chair height. If it ends up floating, sunk or on the wrong
   tile, fix it afterwards with `set_seat` (asset_id from `my_assets`) instead
   of rebuilding; open rooms update at once. Its response includes the seat
   surface and avatar-anchor pixel positions for every rotation. Call
   `preview_asset` with `asset_id` to inspect the revised seat without asking the
   player to sit on it.
   If just one rotation's seated position is misaligned, use `seat_offsets: [{rotation: 6, x: 0, y: -4}]`
   for a view-specific adjustment in room pixels. These x/y values **replace**
   the shared nudges for that rotation; they are not added or mirrored. Positive
   x moves right, positive y moves down, and y still combines with `seat_height`.
   Omitted rotations keep the shared nudges. Read `my_assets` first and resend
   the complete seat settings to `set_seat`, including any existing per-view
   adjustments: the call replaces the settings. Preview all rotations again.
2. The result has `prompt`, the `attach` list and the `attach_order`. The room
   and sprite references are URLs: download them first (`curl -sO <url>`).
   Generate ONE image with your image-generation tool using the prompt verbatim
   and ALL the listed images attached in that order: the user's picture first,
   then the room style reference, then the sprite sample. Ask for a square PNG
   of at least 1024 pixels with a genuinely transparent background.
3. Open the PNG and check it before uploading:
   - Four views in a 2 by 2 grid, one per quadrant, nothing crossing the
     midlines. Top row is the two front views, bottom row the two back views.
   - The two back views must be different rotations, not the same drawing
     twice. The two front views must mirror each other in orientation.
   - For seats, facing means where the sitter looks and the chair opens, not
     where the visible backrest points. Bottom-left (6) opens upper-left;
     bottom-right (0) opens upper-right. Check the opening against the seated
     avatar in each preview: two rear drawings can still be assigned backwards.
     Correct their artwork orientation before publishing; seat offsets cannot
     repair swapped views.
   - Measure a long structural edge in each view: its vertical change must be
     half its horizontal change, allowing for the pixel stair-steps at the
     endpoints. Compare wall faces and furniture bases with the room/footprint
     reference. Check both edges of a frame so perspective taper is caught too.
   - The background is real alpha, not a painted grey checkerboard. If the
     generator painted a checkerboard, regenerate asking for a flat solid
     magenta (#FF00FF) background instead; a flat colour is keyed out on
     submit, a checkerboard is not.
   - No text, labels, floor tiles, walls or shadows outside the piece.
   If a check fails, regenerate (edit the previous image with the correction)
   rather than uploading a broken sheet.
4. Call `upload_url`, then POST the PNG to it from the shell:
   `curl -s -X POST "<upload_url>" -H "Content-Type: image/png" --data-binary @sheet.png`
   The JSON reply has a `storageId`.
5. Call `preview_asset` with the uploaded `storage_id`, `name`, `kind`, footprint,
   seat settings and `format: "sheet"` (or `"strip"` with `frames` for animation).
   It returns a PNG showing all supported rotations, labelled footprint tiles,
   an avatar at the same scale and a test sitter. It does not publish or place
   anything. Check the drawn base, seat surface, real transparency and intentional
   overhang. Compare structural edge slopes with the footprint or wall in EVERY
   view. For seats, check hips on the cushion, back against the backrest and legs
   facing forward; check which arms, rim or backrest should hide the avatar.
   Fix offsets for positioning, use a foreground mask for occlusion, or regenerate
   incorrect geometry. Re-upload changed artwork/masks and preview again before
   publishing. Review warnings; no warnings is not proof that angles or seating passed.
   Then call `submit_asset` with that `storage_id`, the same `name`, `kind`, `width`
   and `depth`. The server keys, trims, splits and scales the four views and
   registers the piece for everyone in the room at once.
6. Tell the user the piece is in the Catalogue (and under which category). Only
   place it when they say where: `room_map` lists free tiles and wall segments,
   `place` takes `asset_id`, `x`, `z` and optionally `rotation` (0, 2, 4, 6);
   wall pieces also take `u` and `height`. To put an object on a table, use
   `support_id` from `room_map.tables` and its free surface tiles. The entire
   footprint must fit; floor availability is not tabletop availability.

Never upload the user's picture with `add_asset`: it would appear in the room as
a photo. `add_asset` is only for art that is already a finished pixel-art
sprite on a transparent background in the room's style (upload it the same way
and pass `storage_id`).

## 3. Pieces without a picture

If the user describes a piece in words only, still call `design_asset`
without `reference_image_path`; the prompt then describes the piece instead of
redrawing a reference. Attach the room and sprite references it lists.

### Seats the avatar sits inside

For an armchair, sofa, cockpit or any enclosed seat, check occlusion separately
from the sitting position. Without a foreground mask, the whole sprite draws
behind the avatar: even correctly placed hips can look perched on top, and rear
views can show the body through the backrest. Open stools may need no mask.

Whenever a part should cover the sitter, make a foreground mask PNG with exactly
the same dimensions and grid as the original sprite sheet/strip. Edit against
the finished sprite, preserving its coordinates; do not generate a separately
positioned chair. Keep the background truly transparent and make only the
occluding parts opaque: the near arm/front rim in front views, and the visible
backrest and near arm in rear views as appropriate. Leave the cushion, gaps and
far arm transparent wherever they belong behind the avatar. Do not mask the
entire chair. Mask RGB is ignored: alpha selects the original artwork that
draws in front of the sitter. Upload the mask and pass its ID as
`foreground_mask_storage_id` to preview and submission. It rotates and animates
with the piece. Inspect a seated avatar in every supported direction before
publishing. Moving the avatar cannot repair missing foreground layers; `set_seat`
changes positions only, not the artwork or mask.

## 4. Housekeeping

- `my_assets` lists what this player built; `delete_asset` removes a piece and
  any placed copies.
- `remove` picks a placed item out of the room (item id from `status` or
  `room_map`).
- Players can also place, rotate and delete their own pieces from the room's
  Catalogue, so check `room_map` before assuming the floor is as you left it.

## 5. Animated pieces

A piece can animate with a strip of 2 to 8 frames of one view (the
facing-right view; the other side is mirrored). Call `design_asset` with
`frames` set: the prompt then asks your image tool for a single row of equal
frames of the same piece, identical apart from the part that moves (a flame,
a blinking light, a screen). Check the PNG: the frames must line up in equal
columns with nothing crossing the column lines, same size and ground line in
every frame, the same exact 2:1 geometry, and real transparent background.
For animated seats, include any foreground mask and verify the seated position
and occlusion across the frames. Upload it, call `preview_asset` with
`format: "strip"` and the same settings, then call `add_asset`
with `frames`, `frame_ms` (how long each frame shows, 250 is a steady blink)
and `switchable: true` if players should be able to click it off and on
(off freezes it on its first frame). Its builder clicks it to select it and
uses the Power button instead.

## 6. Furniture that runs code

When the player wants custom behaviour, attach a JavaScript program to the
asset. Call `program_api` first for the complete API and spinning-chair example.
Use `get_program` before editing existing code, then `set_program` with
`asset_id`, a self-contained ES module as `source`, optional `initial_state`,
and `expected_revision` from `get_program`. The default export receives the
furniture API. This supports arbitrary logic using ticks, clicks, power,
seating events, visual direction/offset/opacity/animation, occupant carry,
and per-copy shared state. It cannot fetch remote code or access the game DOM.

Programs can also detect nearby humans with `setProximityRadius(0..8)`,
`nearbyPlayers`, and `proximityEnter`/`proximityLeave`. Connect **placed copies**
using IDs from `room_map`: read `get_connections({item_id})`, then call
`set_connections({item_id,connections:[{name:"occupied",target_item_id}]})`.
Both ends need programs, must be in the same space, and must be yours (or you
must be Grant). There are eight links maximum in each direction. Empty
connections disconnects all outputs. Source code calls `await api.sendSignal`
only when `api.isHost`; receivers read `api.signals` or handle `signal` events.
Signals retain the latest value, so late viewers reconstruct the current effect.
They are not a guaranteed event queue. Compare `api.connections` data before
sending to avoid idle writes; send at most once per second with at most 1 KiB
of JSON. The `program_api` reference includes a complete proximity sensor and
connected light example, including retries and initialization after edits.

Programs load live without a room reload and stay alive between events. Each
placed copy has its own state. Editing resets copies to the new defaults;
`source: null` removes the program. Power is available on programmed pieces;
clicks and the Use button dispatch interactions. For a spinning chair use a
1×1 seat with four views and `carryOccupants: true`. Use synchronized time for
animation, and only save shared state when `api.isHost`; await saves, catch
errors, and do not save more than once per second. Verify the behaviour in the
room when visual verification is needed; text observations cannot prove motion.

## 7. Checking the room

Use `room_overview` for room checks: it returns players, spaces and placed
furniture as text, with no browser or image downloads. Its default focus is `room`;
use `mine` or `space` with `space_id` to narrow it. Compare with a previous overview
to identify changes. Use `room_map` when you need free tiles for placement.
Mutation replies confirm successful edits. Room screenshots are no longer available;
do not request or recreate them through a browser as a routine check.
Use `preview_asset` to inspect an individual piece before publishing. Text checks
confirm saved state, not visual appearance or animation.

## 8. Adding floor

A player's pieces can only be placed inside a space they own (floor pieces
on its tiles, wall pieces on its stretch of the back wall), so a player with
no space must add one before anything can be placed; `place` outside it is
refused. Only Grant builds anywhere. A player can grow the room by one block
of floor with `add_space` (a `name`,
an optional `floor` of plain, wood, tiles or carpet and a `floor_color` from
the palette `status` lists). Every space starts at 8 by 8 tiles.
Omit `level` to fill the tier with the least total room width automatically. Only
choose `level: 1` (upper), `0` (middle), or `-1` (lower) if the player asks for a
particular level. New rooms join the end of their chosen tier. Staggered
walkways and stairs connect the tiers; the lobby stays on its existing level.
Each room remains on its chosen level after creation. The reply and `room_map`
(`spaces`, each with `tiles` and a `latest` flag) show where it landed, and
the player's pieces can be placed on those tiles straight away. A one-tile
walkway runs along the front of the lounge and every space (`room_map` lists
it under `walkway`): players walk there, so a full space never blocks the
next one, and nothing can be placed on it. `resize_space` makes a space 4 to
16 tiles wide (depth stays 8): widening adds columns on its right, narrowing
removes them once they are clear, and later spaces on the same tier slide along with
everything on them. Confirm the width with the user before resizing. Each player
gets one space; `remove_space` takes the newest one on a tier back (only the newest on that tier, so
earlier spaces never float) once nothing is placed or standing on it. Ask the
user for a name (and a floor, if they care) before adding one; do not add a
space just to find room for a piece without saying so.

The owner can restyle their space with `style_space` (Grant can restyle
anyone's by `space_id`). Only the fields given change: `floor` (plain, wood,
tiles, carpet) and `floor_color` (any hex); `wall` (plain, tiles, checks,
stripes) and `wall_color` (any hex), which default to the room's own; and a
picture on either surface via `floor_image_storage_id` or
`wall_image_storage_id`, uploaded like a sprite sheet (`upload_url`, POST the
PNG or JPEG, pass the storageId). `floor_fit`/`wall_fit` is `tile` (the
picture repeats on every tile or wall segment, so draw or generate a seamless
texture) or `cover` (one copy stretched over the whole floor or wall, for a
mural, a rug design or a big logo); transparent areas show the finish beneath.
Pass `null` to clear a picture, wall or wall colour.

Pictures must match the room's isometric pixel-art look, and the rules are
enforced both ways:

- Always start with `design_surface` (surface, fit, description). It returns
  the prompt for your image tool, with the room reference to attach and the
  exact game size: 64 by 64 for a floor tile, 512 by 512 for a floor cover,
  32 by 117 for a wall segment, 256 by 117 for a wall cover. Floors are drawn
  as a top view and walls flat on; the game projects and skews them itself.
  Never send a photo, logo or render straight to the floor or wall: redraw it
  through that prompt first, the way `design_asset` redraws furniture.
- The server then remakes every picture at that game size with at most 32
  colours and hard-edged alpha (`shared/surface-build.js`), so a smooth or
  oversized image still lands as pixel art. The `style_space` reply reports
  the size it was kept at; if the result looks mushy, the source was too
  detailed for that size, so simplify the design and generate it again.
- For `tile`, the picture must wrap seamlessly on all four edges; for `cover`,
  it fills the whole surface edge to edge. No borders, text or drop shadows.
