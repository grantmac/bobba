---
name: habbo-room
description: Build furniture into the Habbo-style room at chat.grantm.ac from any picture. Use when the user pastes or names a picture and wants it in the room, asks what they have built, or wants pieces placed, moved or removed. Covers the full loop - design_asset prompt, drawing the four-view sprite sheet with the image generator, uploading it, submit_asset, place.
---

# Habbo Room

The `habbo-room` MCP server (https://chat.grantm.ac/api/mcp) builds catalogue
pieces for one player of the shared isometric room. It never draws anything
itself: you draw the sprite sheet with your image-generation tool, upload the
PNG, and the server cuts it into the piece.

## 1. The key

Every call needs the player's agent key as the plugin's API key (sent as a
Bearer token). If a tool answers "No agent key", ask the user to open the room,
go to **Catalogue → Build with your agent**, press **Create agent key** and
paste it when the plugin asks. `status` shows who you build for and what they
have.

## 2. Picture → piece (the normal path)

For any picture that is not already a finished game sprite (photos, logos,
concept art, screenshots, real objects):

1. Call `design_asset` with a short `name`, a one-sentence `description`, the
   `details` worth keeping (materials, colours, parts), the `kind` and the
   footprint (`width` tiles along the front, `depth` tiles back). Pick the kind
   carefully: `seat` lets avatars sit, `table` lets tabletop pieces stack on it,
   `tabletop` is a small object, `rug` lies flat, `wall` hangs on a wall,
   `plant`, `lamp`, otherwise `floor`. Pass the saved path of the user's picture
   as `reference_image_path` so it is listed among the images to attach.
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
5. Call `submit_asset` with that `storage_id`, the same `name`, `kind`, `width`
   and `depth`. The server keys, trims, splits and scales the four views and
   registers the piece for everyone in the room at once.
6. Tell the user the piece is in the Catalogue (and under which category). Only
   place it when they say where: `room_map` lists free tiles and wall segments,
   `place` takes `asset_id`, `x`, `z` and optionally `rotation` (0, 2, 4, 6);
   wall pieces also take `u` and `height`.

Never upload the user's picture with `add_asset`: it would appear in the room as
a photo. `add_asset` is only for art that is already a finished pixel-art
sprite on a transparent background in the room's style (upload it the same way
and pass `storage_id`).

## 3. Pieces without a picture

If the user describes a piece in words only, still call `design_asset`
without `reference_image_path`; the prompt then describes the piece instead of
redrawing a reference. Attach the room and sprite references it lists.

## 4. Housekeeping

- `my_assets` lists what this player built; `delete_asset` removes a piece and
  any placed copies.
- `remove` picks a placed item out of the room (item id from `status` or
  `room_map`).
- Players can also place, rotate and delete their own pieces from the room's
  Catalogue, so check `room_map` before assuming the floor is as you left it.
