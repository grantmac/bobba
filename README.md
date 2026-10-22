# Private room

A single shared Habbo Origins room in Three.js, using sprites and behaviour recovered from the locally installed game. Convex stores the room, furniture, appearances, chat and live player state.

Live room: https://chat.grantm.ac/ (also https://habbo-room.vercel.app/)

Vercel project: `grantmaclennans-projects/habbo-room`. Production uses the same existing Convex deployment as local development, so both share the room.

## Run

Furniture can carry dynamically loaded JavaScript programs. See
[Furniture programs](docs/furniture-programs.md) for the agent tools, runtime
API, spinning-chair example, isolation model, and release order.

```sh
npm install
npm run dev
```

Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` to the shared Convex deployment. Backend changes are published with `npx convex dev --once` using the existing authenticated deployment.

- Visitors see the active room behind a three-step entry window: check a name, style their character, then optionally copy an agent connection prompt. Agent setup stays in the window and confirms connection after the agent contacts the MCP server. Saved character names are reserved permanently. Unsaved guest names can be picked again four hours after their last visit; this ends the previous guest's sessions and creates a new player identity without transferring their belongings, space or memories. Grant is always reserved.
- Click the floor to walk, or a chair or sofa to sit. Scroll over the room to zoom. Occupied tiles and reserved walking routes prevent overlapping players.
- Click yourself to change appearance. Click another player to see their portrait and name in the original-style information stand. Names are not displayed above avatars.
- Wave and Dance are shared with other players. Walking stops the action.
- Chat uses stacked balloons. Whisper currently changes the balloon styling; it is visible to everyone in the room, not private messaging.
- Only Grant can change room shape, walls, floor, window and furniture. The catalogue contains 1,223 recovered floor furniture pieces, with placement, move, rotate, pickup, delete confirmation and inventory. R rotates and Escape cancels placement.

The private Grant entry link is kept in `ADMIN-ENTRY.md` (Git-ignored and excluded from Vercel), outside the deployed application bundle. Its secret is verified against a server-side hash; the name Grant is reserved. Guest identity is remembered in the same browser for 30 days, renewed when returning with less than seven days left; admin sessions last 12 hours. Visitors can optionally keep their character with a passkey or one-time backup code, and return from another browser through “Use my room key”. There is no account signup, password form or email service.

Room and furniture state comes only from Convex. The browser remembers appearance preferences and a session token, not an alternative room. Closing the last tab sends a departure signal; a 45-second heartbeat timeout handles crashes or lost connections.

## Keeping a character

A prominent “Save your character” button appears after character creation and remains available in the appearance window, with a reminder that it keeps the visitor’s name, look and belongings. Saving a passkey or creating a backup code reserves the name permanently and retains the existing player ID, appearance, space, furniture and agent links. Returning in a remembered browser skips entry; otherwise “Use my room key” opens a small return panel over the room.

Passkeys require device user verification and a discoverable credential, verified server-side with SimpleWebAuthn. A character can have up to five passkeys. Each key belongs to the exact room hostname where it was created: use the same address when returning (prefer `https://chat.grantm.ac/`). A password manager may sync a key across devices, or the browser may offer a phone/QR-code option. The server stores public keys; challenges expire after five minutes and can be used once.

Backup codes contain 256 bits of randomness, are shown once and stored only as SHA-256 hashes. Creating a replacement invalidates the old code. Using a code creates a fresh session for the original player and consumes the code atomically; the return panel prompts the visitor to save a passkey or create another backup before leaving. There is no expiry on an unused backup code. Grant can save passkeys but retains the existing private entry link as the backup. Temporary room removals also apply to passkey and backup-code entry. Losing every passkey, the backup code and the browser session leaves no self-service recovery route.

`ROOM_AUTH_ORIGINS` is an optional **Convex server environment** setting: a comma-separated allowlist of exact origins. Defaults are `https://chat.grantm.ac`, `https://habbo-room.vercel.app`, `http://localhost:5173` and `http://127.0.0.1:5173`. Add any additional development or preview origin explicitly; HTTPS is required except on localhost. No email or authentication-provider credentials are required. Deploy the Convex schema and functions before deploying the client that calls them. Existing guest sessions remain valid; no migration or reassignment of existing player records is needed.

`test/identity.test.js` exercises real P-256 WebAuthn registrations and signed assertions, rejects forged/replayed/expired requests, verifies name and ownership isolation, and covers backup replacement, one-time use, throttling and session renewal. The room-key browser previews use simulated identity data and do not create real credentials.

## Appearance catalogue

The picker now follows the original `figuredata.xml` selectable sets, part mappings, hidden layers, colour channels and palettes:

| Category | Styles |
| --- | ---: |
| Hair | 47 |
| Faces | 20 |
| Tops | 67 |
| Trousers | 14 |
| Shoes | 12 |
| Hats | 32 |
| Headwear | 10 |
| Glasses | 6 |
| Facewear | 12 |
| Jackets | 19 |
| Waist accessories | 12 |

Optional categories also have a “none” choice. The catalogue uses 2,500 extracted sprite images. Legacy appearance IDs and colours are accepted so existing characters keep their saved looks. `appearance-catalogue-audit.json` records coverage; missing sleeve-3 images are the original sleeveless mappings. `sprite-audit.html` is a local-only inspection page rendering every option in eight directions and every wave/dance frame.

## Source grounding and adaptations

The original extraction workspace remains at `/Users/grantmac/Documents/Codex/2026-10-20/do-yo`. Recovered scripts are in its `work/origins-extracted/` directory. Original installed `figuredata.xml`, `draworder.xml`, `partsets.xml` and `animation.xml` supply character sets, layering and action frames.

- Figure System and `partsets.xml`: back hair replaces the regular hair layer. Face shapes use skin tint; eyes use their keyed alpha.
- Object Mover and Active Object classes: furniture footprints, layered drawing, registration, rotation and per-part transparency inks.
- Room Interface: furniture commands, delete confirmation, information stand, wave and dance controls.
- Human Class EX: sitting and action behaviour. Seat heights are approximated because the original client receives resting heights from its server.
- The active Balloon Manager uses seven balloons, 21px steps, 4000ms idle scrolling and a 400-character limit. Its 125px bottom anchor is mapped from the original 480px stage into the responsive room.
- Original window artwork supplies the appearance modal frame, header and close control. The larger picker, paging and accessory grouping are adaptations for the complete catalogue.

Wave uses the recovered two-frame animation for three seconds; dance uses the recovered eight-frame sequence. Action timing and multiplayer protocol are app adaptations. Added notification popups were removed; the original delete confirmation remains. Furniture is floor-mounted and shown in its default static state; wall mounting, arbitrary multi-level stacks, lying on beds and furniture-specific animations are not implemented. Bed furniture can be placed as decoration. Furniture labels and categories beyond the original 31 pieces are inferred from source asset names. Floor z-shifts identify walkable rugs and floor tiles. Agent/MCP integration is not yet implemented.

## Rebuild the furniture catalogue

```sh
python3 tools/import-furniture.py --source /Users/grantmac/Documents/Codex/2026-10-20/do-yo
```

The importer keeps full-size floor pieces with inventory icons and valid footprints, skips half-size duplicates and wall-mounted pieces, and generates both client assets and server placement metadata. `furniture-catalogue-audit.json` records the 1,223 included pieces and skipped candidates. Furniture images load when placed or previewed, and the catalogue has search, categories and 48-item pages.

Visitors can sit on chairs and walk over rugs without seeing the furniture editing panel. Only Grant sees editing actions. Clicking DJ decks also gives visitors a power switch.

Place decor, plants or lights onto a free table surface. Items must fit within the table and cannot overlap other tabletop items. Contents move and rotate with the table; picking up or deleting a table puts its contents in inventory. The original Object Mover uses surface IDs and placement altitude; this app derives tabletop heights from sprite registration because the original server height metadata is absent. The fridge has a mirrored second facing; no rear artwork is invented.

Anyone can build into the room through an agent: the Catalogue (now open to every player) has a Build with your agent button that makes an agent key for that player (shown once; `convex/agents.js`, the `agentLinks` table stores only a hash). The room's MCP server is hosted on the site as a Vercel function, `api/mcp.js` at `/api/mcp` (Streamable HTTP, stateless JSON), and every request carries the key as a Bearer token; `plugin/` packages it with its workflow skill as a Codex plugin (`plugin/README.md`), and any other MCP client can use the same URL and header. Its `add_space` tool grows the room: a player can add one named block of floor (8 by 8 tiles to start; `resize_space` later makes it 4 to 16 wide, sliding later spaces, their furniture and the players on them along, with a floor finish and colour from the room's palette) that always joins the right-hand end of the back wall after the latest space, so position is never chosen; `rooms.spaces` keeps them in order, `shared/spaces.js` and `shared/room-layout.js` lay them out, the client draws each from the room's floor textures with the wallpaper carried on behind, `style_space` lets the owner restyle it (name, floor finish and any hex colour, a wallpaper and colour for its stretch of back wall, or an uploaded picture on either surface, tiled per tile or stretched across the whole space; `design_surface` writes the prompt that keeps a picture in the room's pixel-art style at the game's own size, and the endpoint remakes every picture at that size with at most 32 colours and hard alpha through `shared/surface-build.js` before storing it; `src/spaces.js` lays pictures over the floor sampler and skews them onto wall segments, and `room.publicSpaces` hands clients storage URLs rather than ids), and `remove_space` takes back only the newest, empty one. Clicking a built piece, or the back wall of a space, shows its name and builder on the info stand. Once there is a space, a one-tile walkway runs along the front of the lounge and every space (`layout.walkway`): walkable, drawn as plain paving, and refused to furniture, so a space packed to its edges never cuts off the ones after it. A built seat can carry a sitting spot (`assets.seat`: one footprint tile and the seat top's height, given with `submit_asset`/`add_asset` or fixed later with `set_seat`); `convex/lib/assets.js` turns it into per-rotation seat spots like the catalogue's, so the figure sits on a stool top rather than inside a two-tile piece, with optional pixel nudges. A built piece can animate: `add_asset` with `frames` takes a strip of 2 to 4 frames of one view (`shared/sprite-build.js` cuts them to one shared box and packs them into a sheet with frame cells), the asset carries a `frameDuration` and may be `switchable`, and the client plays the cells like the stock animated pieces, with any player's click (or the builder's Power button) freezing it on its first frame through the same power mutation as the decks. Agents can also see their work: `room_picture` files a request in the `captures` table (`convex/captures.js`), any tab with the room open claims it, renders the whole room or one space off-screen (`src/snapshot.js`, a render target read back and sRGB-encoded) and uploads the PNG, and the endpoint returns it as image content, then discards it. The agent's `add_asset` tool turns a finished sprite into a catalogue piece: it keys out a flat background, trims, scales to three times room resolution and registers the sprite on its footprint, uploads it to Convex file storage and records it in the `assets` table (`convex/lib/assets.js`). Every client subscribes to `assets.list`, so a new piece appears in everyone's catalogue, and placed copies in the room, without a reload; the server merges built pieces into the placement rules on every room read. Items carry the `owner` who built them: players may add, move, pick up and delete only their own pieces (and only from their own assets, with no fixed limit on built, placed or inventory pieces), and may place them only inside a space they own (`rules.ownSpaceCheck`: floor pieces on its tiles, wall pieces on its stretch of back wall; pieces placed before that rule stay until moved), while Grant can edit anything anywhere. The agent can also place and remove pieces itself using `room_map` for free tiles and wall segments. The server never draws anything itself: for any picture that is not already a game sprite, `design_asset` (`shared/agent-prompts.js`) hands the agent's own image tool a prompt to redraw it in the room's style as a 2×2 sheet of the piece's four rotations, with reference images served from `public/agent-reference/`; the agent POSTs the PNG to a Convex upload URL from `upload_url`, and `submit_asset` (`shared/sprite-build.js`) splits the sheet into the four views (top-left faces lower-right, top-right lower-left, bottom-left upper-left, bottom-right upper-right), registering each on its rotated footprint so Rotate in the room turns the piece. A client built before player pieces existed would drop them as unknown types when it saves, so `setFurniture` keeps built pieces unless the client says it knows about them. Wall pieces are ordinary catalogue furniture (category Wall) that hang on a wall instead of standing on the floor: the Wall speaker (`tools/speaker-sprite.py` crops the two-view artwork in `tools/speaker-source.png` into left- and right-wall sprites) is picked from the catalogue, then hung by clicking a continuous stretch of wall; it shows the view that faces into the room for whichever wall it is on, takes no floor space, and is selected, moved, picked up and deleted like any other piece (arrow keys slide and lift it while placing). A hung piece stores its wall tile, the wall as its rotation (2 left, 4 right), its position along the tile edge `u` and its `height` above the floor line, and the server checks the wall is continuous behind it. The NEU! print beside the sticky note is still a poster that Grant clicks to move or delete. A BRB poster appears on the wall while Grant is offline and disappears when Grant returns. Grant’s private entry loads the server-saved appearance and only replaces it when the editor choices change.

## Resident bot

Lobby is a permanent, visibly identified room bot. It reads typed room chat, greets arrivals, replies through Fireworks, walks and sits using the same checked routes as players, and waves. A minute timer keeps it present, wanders while people are around, and recovers interrupted turns. Pausing responses leaves its character in the room. Voice transcription is not connected yet; the bot never receives microphone audio.

The **Bot** button opens its status and explains what it can read. Grant also gets name, personality, response/roaming switches, moderation settings, editable memories, and a moderation history with **Allow back**. Clicking Lobby opens the same panel. Visitors can ask it by name to remember, update, or forget their own preferences. Memories added through Grant's panel are protected from visitor changes. Memories are stored in Convex, attributed to their source, and never reassigned when a guest name is reused; there is a 100-memory limit, with deletion available in the panel.

Set `FIREWORKS_API_KEY` in the existing Convex deployment's environment. `FIREWORKS_MODEL` defaults to `accounts/fireworks/models/glm-5p3-flash`. The key stays on the server. Deploy backend changes with the project's normal Convex process, then run `npx convex run bot:tick '{}'` to install the resident immediately (the minute timer also installs it). The default moderation policy warns for a clear violation, then removes a visitor for ten minutes if a new violation occurs after the warning, within thirty minutes. Grant can select warnings only or turn moderation off. Admins cannot be kicked by the bot.

Removal blocks every known room session and building key, and removes/revokes known LiveKit tab identities, including previously disconnected tabs. A banned visitor keeps their browser identity and can reload after the timeout. As with any anonymous guest system, a completely new identity can evade a temporary removal. LiveKit removal errors appear in the admin history and retry automatically. Model requests run in serialized batches, have a deadline and bounded retries, and validate structured actions before applying them; duplicate/stale turns cannot repeat a reply or punishment. Chat and memories are model context, never permission to alter access rules.

Bot code lives in `convex/bot.js`, `convex/botBrain.js`, `convex/botVoice.js`, and `convex/lib/bot_*`; the controls are in `src/bot-panel.js`. Bot event records expire after a day, chat follows the existing seven-day retention, memories persist until deleted, and moderation history is retained. `test/bot.test.js` covers the server behaviours; `test/bot-browser.html` and `test/bot-mobile-browser.html` are isolated control-panel previews with in-memory sample data.

## Validation

```sh
npx vitest run
node --test test/furniture-model.test.js
npm run build
```

Tests cover server authorization, reserved names, session handling, all selectable appearance choices and palettes, room persistence and revision conflicts, chat identity, movement and seat occupancy, connection expiry, public room previews and shared gestures. Furniture model tests cover footprints, rotation, invalid tiles, collisions, rugs and saved-data validation.

## Voice chat

The room includes a five-row, full-width dance floor one step below the main floor. A pixel-art isometric blimp (`src/blimp.js`) drifts nose-first along the back wall line high above the room every hundred seconds, carrying a red neon SUPERHANDS sign; `test/blimp-browser.html` shows the sprite. The pool annex has a shaded tiled surround, stepped water depth and a plank deck with grain and nail heads, closed at the back by a procedurally grown plant wall (`src/plant-wall.js`). Its lights are drawn as bevelled pixel panels with a stepped inner glow, and the disco ball throws drifting pixel-art reflections across them (`src/disco-lights.js`) that retract with the ball when the floor is off. Any joined player can click its tiles to switch the lights on or off; this is saved and shared with everyone. Furniture cannot span the step. Dancing resumes after walking to another tile and stops when sitting.

Custom catalogue items include animated DJ Decks (four rotations, tabletop placement and saved on/off state) and the Black Porsche 911 (four rotations, three-by-two footprint). Clicking the Porsche walks the player to its cabin tile and seats them inside, facing the way the car points; the window glass was made translucent by `tools/porsche-glass.py` so the seated avatar shows through it. While the DJ Decks are on, a pixel-art Poolside FM sign (built from the logo artwork by `tools/poolside-sign.py`, which writes `public/assets/posters/poolside-fm.png` and pre-sheared copies for each wall side) hangs on the nearest wall behind them. A three-dot bubble shows over any player who has an unsent message in the chat field: the client refreshes a four-second server-side typing window every 2.5 seconds while text sits in the field, and clears it on send, on emptying the field, or when the page is hidden. Wave, Dance and Breakdance (a floor spin built from the sit and wave sprites) live in the toolbar's original hand icon, which opens a small actions menu styled like the speech-mode menu; Dance shows a tick while it is on. Clicking the Fridge walks the player up to it; the door swings open for everyone for a moment and the player comes away holding a drink (the original carried-glass sprites in the carry arm pose) that stays in hand while walking, sitting, waving and dancing for ten minutes. The main room's wood floor gets per-plank tone and grain streaks on top of the original tile. Clicking the DJ Decks walks the player to the nearest free tile beside the decks or their cabinet and turns them to face the decks; a player already standing there only turns. A catalogue entry's `seat` map (per rotation: `cell`, `direction` and a pixel `offset`) makes any piece sittable without using the Seating category; `test/car-browser.html` renders the seated avatar for all four rotations. Sprite sheets are split and trimmed in the renderer; their supplied artwork is preserved. The updated deck frames loop every 200 ms with identical silhouettes; only the record labels animate. Rendering keeps per-frame work small: furniture meshes persist across redraws and only changed pieces are rebuilt, the pool's static surround and coping are cached in offscreen layers with only the water repainted per tick, peers update their material and name label only when something changes, container geometry is read once per resize rather than per frame, and furniture changes are detected from the room revision instead of serialising the list. Each player's pose frames are packed into one atlas texture selected by UV offset, room contents arrive on their own `roomState` subscription so movement updates stay small, the catalogue grid is only built while its panel is open, pointer hover is resolved once per animation frame against a pre-sorted visual list, the dance floor precomputes its per-pixel masks, and the custom sprite sheets are 256-colour palettes (`tools/quantise-sprites.py`). Screen-pixel alignment and native display resolution keep the original pixel art crisp: every zoom level is a whole number of device pixels per room pixel, and the default fit rounds down so the room still fits. Each wheel notch moves one zoom step. Phones open at native pixel size centred on the player's avatar, and a viewport `maximum-scale=1` keeps iOS from zooming the page when a text field is focused. Chat bubbles are anchored to room coordinates, so they stay over their speaker while the view pans or zooms.

While another player has their mic on, the deck music ducks to under a tenth of its level, easing down quickly and back up slowly after a short hold, and remote voices play through LiveKit's Web Audio mix at two and a half times normal gain behind a compressor, so voices sit well above the music. Voice uses LiveKit Cloud while Convex continues to handle room state and identities. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` on the existing Convex deployment, then publish with `npx convex dev --once`. Keep the API secret server-side; do not use a `VITE_` environment variable or commit credentials.

Voice is always on: every player joins the call listen-only the moment they are in the room, with the microphone off, and there is no join or leave. The floating windows (voice, whiteboard, guest book and appearance) can be dragged by their title bars (`src/draggable.js`). The microphone button in the bottom bar opens the original blue window style, where Turn mic on requests browser permission and starts talking and Mute mic stops it; the choice survives reconnects. Browsers only allow playback after a gesture, so a tab that loads without one shows "Tap anywhere to hear voice" in the hint strip until the first tap or key. Visitors can mute another participant locally. Speaking indicators follow the avatars only during detected speech and disappear during silence or muting. Each open tab gets its own LiveKit identity (the player id plus a per-tab tag, folded back to the player on the client), so a second tab or a reload never bumps the first off the call as a duplicate, and the voice token lasts twelve hours so a full reconnect never fails on an expired token. If the connection drops or cannot be made, the client reconnects by itself with a growing pause (1.5 s up to a minute) and shows "Voice dropped. Reconnecting…"; a hidden tab waits until it is visible again. Voice stops only when the page closes or the room session fails. Connection attempts time out after 25 seconds; Chrome works best if an embedded browser cannot connect.

The backend issues five-minute tokens after validating a live room session. Tokens only allow subscribing and publishing microphone audio in `habbo-room`; they do not grant camera, screen sharing, data publishing, or room administration. The client SDK is loaded only when someone joins voice. No recording or transcription is configured.

`test/voice-browser.html` verifies controls with simulated participants and no microphone capture. `test/voice-mobile-browser.html` embeds the same checks at phone width. Real audio delivery additionally requires the configured LiveKit project and two connected clients.

## Grant's desktop join alerts

Join alerts are sent only for the deployed origins (`https://chat.grantm.ac` and `https://habbo-room.vercel.app`), including returning visitors. Localhost joins and reconnections stay silent. The client origin is a notification preference, not an authorization boundary.

Room arrivals use the same private ntfy topic as phone alerts. On the desktop, subscribe to that topic in ntfy, allow browser notifications, and enable **Settings → Background notifications → Enabled for ntfy.sh**. This uses Web Push, so neither the room tab nor the ntfy tab needs to stay open. Chrome must still be running, and macOS must allow its notification banners. Reopen ntfy at least weekly to keep its background subscription active.

The server sets each alert's click target to the private `GRANT_ENTRY_URL` environment variable. Clicking an alert opens the live Grant entry; no admin link or ntfy topic is included in the public client bundle. Guest arrivals and returns after going offline trigger alerts, with a 60-second per-player cooldown. Grant's own arrivals do not trigger them.

Desktop navigation supports left-button dragging to pan and scrolling to zoom. A click still walks or selects; dragging suppresses that click even if the pointer returns to its starting position. Touch dragging and pinching use the same camera offsets. The Asian Gothic Chair uses a raised sitting anchor to align the avatar with its cushion; its original artwork and layer depths are unchanged.

## Party controls

Any joined player can switch the dance floor and placed DJ decks on/off. Dedicated server mutations change only power; catalogue, placement, movement, deletion and room editing remain admin-only. The supplied four-frame disco ball lowers over the centre of the dance floor when the lights are on and retracts when off. Reduced motion shows a static ball.

The Record Cabinet uses the updated supplied artwork, has the same two-by-one footprint and 96px sprite width as the decks, and supports them 36px above the floor. Both mirrored orientations work with normal tabletop placement.

Powered decks play the public Poolsuite ON AIR feed (`https://s5.radio.co/sc9cb59935/listen`, verified in the public player at https://poolsuite.net/). Each visitor listens directly after joining; this does not capture the host computer or pass music through voice chat. One audio element serves all powered decks. Turning all decks off, picking them up, or leaving stops it. The microphone panel contains voice controls only. Browsers that block radio autoplay retry on the next interaction. This is live radio, so buffering may differ slightly between listeners.

## Automatic deployment updates

Production builds expose a unique version in `/version.json`. Open rooms check every 30 seconds and when returning to a tab or reconnecting to the internet, then refresh once a new deployment is available. Reload waits for open dialogs, furniture editing/placement and unsent chat text to finish. The reload is covered by a fade: the page dims before reloading, an inline script keeps the cover up from the first paint when a fresh snapshot exists, the saved camera is applied before anything is drawn, and the cover lifts two frames after the restored room is ready (or at once if the join flow or an error needs the screen). The player’s existing session is resumed, and a short-lived per-tab snapshot restores camera, music volume/mute and voice connection/microphone/local mute settings. Browser audio permissions can still require a click to resume playback. Local Vite development keeps its normal hot updates. People on versions from before this feature need one manual refresh first.

## Whiteboard

A whiteboard hangs on the lounge's back wall, a tile to the right of the Pong projection. On the wall it is drawn as a framed pixel-art board with a marker tray, with the ink rendered at double density so lines stay smooth; the editor keeps a high-resolution canvas. Clicking it opens a Habbo-style editor window with five pen colours (white doubles as the eraser), three sizes and a Clear button; drawing with a mouse or finger streams the stroke to the server in 120 ms chunks, so everyone sees lines appear as they are drawn. Strokes are individual documents with a rising serial (`convex/whiteboard.js`); a client loads the whole board once and then follows a delta subscription that re-subscribes from the newest serial it has seen, so live updates carry only what changed. The board keeps the latest 400 strokes of up to 600 points each.

## Sunken sofa

The middle of the lounge is a six-by-four conversation pit one step down. Its artwork (`tools/sunken-sofa-source.png`, a green velvet sofa on all four sides with a shag rug, side tables and a plant) is fitted to the pit's tile diamond by `tools/sunken-sofa.py`, which maps the rim corners with a perspective transform and trims the plinth below the rim, writing `public/assets/lounge/sunken-sofa.png` at twice room resolution. Walking in or out ramps smoothly over the edge like the dance floor step. The sofa's ring of tiles are seats: stopping on one sits the player facing the rug (`pitSeat` in `shared/room-layout.js`, applied by the server's move mutation), while the rug tiles are ordinary floor.

## Guest book

The Guest Book is a catalogue piece (`custom_logbook`, an open signed book with a pen; `tools/logbook-sprite.py` prepares the sprite from `tools/logbook-source.png`) that the admin can place anywhere, including on tables. Clicking it walks the player up to it and opens a window listing everyone who has visited, newest first, with the time they came in, the time they left or "still here", and how long they stayed; Older entries pages back forty at a time. Visits are recorded server-side (`convex/lib/visits.js`): one opens on join or on returning after a timeout, and it closes when the player's last connection drops or, for a silent timeout, at the moment they were last seen. `visits.backfill` (run once with `npx convex run visits:backfill`) seeded one historical entry per existing player, from their first arrival to the last time they were seen; exits that were not recorded are shown as "out some time after".

## Games lounge and Pong

An eight-by-eight carpeted lounge extends the right-hand edge beyond the pool and deck, its back wall carrying on from the plant wall in the room's wallpaper. Pong is projected on the first four tiles of that wall and, after a tile's gap, the whiteboard hangs on the last three. Clicking the projection walks the player to a tile in front of it; clicking again from there joins the game. The first player plays against a computer paddle; a second player's click takes that paddle over. Paddles follow the pointer over the projection, or the arrow keys or W and S. First to seven wins, and walking away from the screen hands the paddle back. Rules live in `shared/pong.js` for both server and client: the ball flies deterministically from the last server-stamped state, the controller of a paddle reports hits and misses as the ball reaches its side, and the server (`convex/pong.js`) replays the ball to validate them before issuing the new trajectory or score. Paddle positions stream at ten a second on their own `pong` subscription.

## Jacuzzi and rear parking deck

A five-by-five hot tub terrace extends the right-hand edge, opposite the dance floor. It has a three-by-three water area, a walkable tiled surround, original Lido water/ladder sprites, built-in benches, and animated bubble jets. Players can enter the water; their avatars lower below the surface and are clipped at the waterline. Furniture cannot be placed in the water. A five-by-three timber deck behind it accepts the Porsche in all four orientations. Existing main room and dance floor tile coordinates are preserved.

DJ decks now use the supplied grid-corrected 2:1 animation pack, with preserved aspect ratio, 200ms frames and tabletop alignment. The off state uses the supplied parked-tonearm stills, rather than freezing a playing frame.
# bobba

## Enter from an agent

Tell visitors: **Paste “Join this room: https://chat.grantm.ac/connect” into your agent.**
`/connect` serves plain-text setup instructions directly to ChatGPT / Codex,
Claude Code and other local agents, with no intermediate landing or copy-prompt
page. `/connect.md` is the same guide. The portable
Node helper at `/room-agent.mjs` creates a ten-minute pairing request, opens a
browser link through the agent's browser tools, and keeps its credential in a
private local file. The browser approves the connection as its own player;
only an authenticated MCP contact marks it connected. Existing authorized
connections can resume for that same player. Cancelled, expired or revoked
requests cannot be approved again. Pairing codes are removed from the address
bar and survive reload only in that tab's session storage.

The helper can register a local stdio bridge with the Codex CLI or Claude Code,
or output standard MCP settings for other clients. `tools` and `call` work
immediately over the hosted endpoint, while native tool registration may need
a client reload. Web-only clients need their own connector support. The
existing plugin's API-key connection and website-first entry still work.

Implementation: `convex/agentPairing.js`, `api/connect.js`,
`src/agent-entry.js`, and `public/room-agent.mjs`. Deploy the Convex schema and
functions before the site; no new environment secrets or OAuth provider are
required. The endpoint uses the existing `CONVEX_URL` / `VITE_CONVEX_URL`.
Pairing tests use an isolated backend; the helper and endpoint tests never
change real agent configuration. `test/agent-entry-browser.html` previews the
approval window without connecting to the shared room.
