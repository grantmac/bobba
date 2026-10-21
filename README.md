# Private room

A single shared Habbo Origins room in Three.js, using sprites and behaviour recovered from the locally installed game. Convex stores the room, furniture, appearances, chat and live player state.

Live room: https://chat.grantm.ac/ (also https://habbo-room.vercel.app/)

Vercel project: `grantmaclennans-projects/habbo-room`. Production uses the same existing Convex deployment as local development, so both share the room.

## Run

```sh
npm install
npm run dev
```

Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` to the shared Convex deployment. Backend changes are published with `npx convex dev --once` using the existing authenticated deployment.

- Visitors see the active room behind the entry modal, choose a unique name and style their character.
- Click the floor to walk, or a chair or sofa to sit. Scroll over the room to zoom. Occupied tiles and reserved walking routes prevent overlapping players.
- Click yourself to change appearance. Click another player to see their portrait and name in the original-style information stand. Names are not displayed above avatars.
- Wave and Dance are shared with other players. Walking stops the action.
- Chat uses stacked balloons. Whisper currently changes the balloon styling; it is visible to everyone in the room, not private messaging.
- Only Grant can change room shape, walls, floor, window and furniture. The catalogue contains 1,223 recovered floor furniture pieces, with placement, move, rotate, pickup, delete confirmation and inventory. R rotates and Escape cancels placement.

The private Grant entry link is kept in `ADMIN-ENTRY.md` (Git-ignored and excluded from Vercel), outside the deployed application bundle. Its secret is verified against a server-side hash; the name Grant is reserved. Guest identity is remembered in the same browser for 30 days; admin sessions last 12 hours. There is no account signup or cross-device guest recovery.

Room and furniture state comes only from Convex. The browser remembers appearance preferences and a session token, not an alternative room. Closing the last tab sends a departure signal; a 45-second heartbeat timeout handles crashes or lost connections.

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

A BRB poster appears on the wall while Grant is offline and disappears when Grant returns. Grant’s private entry loads the server-saved appearance and only replaces it when the editor choices change.

## Validation

```sh
npx vitest run
node --test test/furniture-model.test.js
npm run build
```

Tests cover server authorization, reserved names, session handling, all selectable appearance choices and palettes, room persistence and revision conflicts, chat identity, movement and seat occupancy, connection expiry, public room previews and shared gestures. Furniture model tests cover footprints, rotation, invalid tiles, collisions, rugs and saved-data validation.

## Voice chat

The room includes a five-row, full-width dance floor one step below the main floor. Any joined player can click its tiles to switch the lights on or off; this is saved and shared with everyone. Furniture cannot span the step. Dancing resumes after walking to another tile and stops when sitting.

Custom catalogue items include animated DJ Decks (four rotations, tabletop placement and saved on/off state) and the Black Porsche 911 (four rotations, three-by-two footprint). Sprite sheets are split and trimmed in the renderer; their supplied artwork is preserved. The updated deck frames loop every 200 ms with identical silhouettes; only the record labels animate. Screen-pixel alignment and native display resolution keep the original pixel art crisp.

Voice uses LiveKit Cloud while Convex continues to handle room state and identities. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` on the existing Convex deployment, then publish with `npx convex dev --once`. Keep the API secret server-side; do not use a `VITE_` environment variable or commit credentials.

The microphone button in the bottom bar opens the original blue window style. Guests see only this toolbar icon beside chat. Clicking Join voice enables the microphone, requesting browser permission if needed. Visitors can mute another participant locally or leave. Speaking indicators follow the avatars only during detected speech and disappear during silence or muting. Voice disconnects when the page closes or the room session fails. Each player has one LiveKit identity, so joining voice in another tab replaces their previous voice connection. Connection attempts time out after 25 seconds; use Chrome if an embedded browser cannot connect.

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

Production builds expose a unique version in `/version.json`. Open rooms check every 30 seconds and when returning to a tab or reconnecting to the internet, then refresh once a new deployment is available. Reload waits for open dialogs, furniture editing/placement and unsent chat text to finish. The player’s existing session is resumed, and a short-lived per-tab snapshot restores camera, music volume/mute and voice connection/microphone/local mute settings. Browser audio permissions can still require a click to resume playback. Local Vite development keeps its normal hot updates. People on versions from before this feature need one manual refresh first.
