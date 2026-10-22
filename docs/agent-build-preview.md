# Agent build checks

`design_asset` returns a short build brief and a labelled footprint diagram at room
scale. Static sheets use directions **2,4 / 6,0**. Animation strips and standalone
sprites use directions 2 and 4 (one source, one mirror). Walls expose only 2 and 4.
The diagram and image prompt describe width and depth independently, including
rear views of rectangular pieces.

Upload artwork, then call `preview_asset` with the same name, kind, footprint,
seat and sizing options intended for submission. Use `format: "sheet"`,
`"sprite"`, or `"strip"` (with `frames`). The preview prepares sprites in memory,
renders the game's furniture and avatar artwork, and returns a PNG with labelled
tiles, a seat marker and a standing avatar at the same scale. It does not create
catalogue or room records. After publication or `set_seat`, pass `asset_id` to
preview the saved piece. Uploaded sources remain available for submission.

Submission and preview report supported views, mirroring, seat surface coordinates,
avatar anchors and heuristic warnings about opaque backgrounds and horizontal
overhang. They reject invalid grids, footprints, seat coordinates and mask sizes.
Warnings cannot establish that a drawn leg or seat surface matches the declared
geometry; inspect the preview. Intentional overhang is permitted.

For seats with a cockpit rim or desk front, upload a mask with the same dimensions
and layout as the artwork, and pass `foreground_mask_storage_id`. Its alpha selects
the original artwork to redraw in front of the sitter; RGB is ignored. Transparent
areas select nothing. The mask shares the base sprite's crop, scale, registration,
mirroring and animation frames. It works for both static and animated seats.

`room_map.tables` lists table IDs, surface heights and free surface tiles. Pass
`support_id` to `place`, with coordinates on that table. Existing server rules
still enforce ownership, fit and surface collisions. `set_seat` returns positions
for every rotation, relative to the anchor tile's top in screen pixels (right/down).

## Server pictures

`room_picture` defaults to a fresh server browser running the same room renderer.
It reads a scene snapshot with the agent key on the server, injects only scene
data into the page, and never joins as a player or executes custom asset programs.
Use `renderer: "tab"` to capture live custom-program effects in an open room.
The server mode is for furniture, player and surface checks; live game boards
and transient interactions may differ from an active room tab.

Deploy the frontend and Convex functions/schema together. Vercel bundles Chromium,
its graphics libraries and the blueprint fonts; the MCP function has 2 GB memory
and a 120-second limit. `ROOM_RENDER_ORIGIN` overrides the app URL when needed.
For a protected preview deployment, point it at a reachable deployment of the
same frontend or set `VERCEL_AUTOMATION_BYPASS_SECRET`; it is sent only to that
deployment's origin, never to sprite-storage hosts. Never point at an older frontend
that lacks the render entry point.

For local verification, run Vite on port 5199 and use:

```sh
CHROME_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node test/render-smoke.mjs
node --test test/asset-build-tools.test.js test/sprite-build.test.js
npx vitest run
npm run build
```

The browser check creates an isolated preview and a distant-space room capture,
and checks that static/animated foreground layers straddle the sitter, update
together and stop together when switched off. It uses fixtures and makes no
backend writes. PNGs are written to `/tmp/habbo-asset-preview.png` and
`/tmp/habbo-room-preview.png`.
