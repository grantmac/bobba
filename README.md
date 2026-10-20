# Private room

A single shared Habbo Origins room in Three.js, using sprites and behaviour recovered from the locally installed game. Convex stores the room, furniture, appearances, chat and live player state.

Live room: https://habbo-room.vercel.app/

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

Wave uses the recovered two-frame animation for three seconds; dance uses the recovered eight-frame sequence. Action timing and multiplayer protocol are app adaptations. Added notification popups were removed; the original delete confirmation remains. Furniture is floor-mounted and shown in its default static state; wall mounting, stacking, lying on beds and furniture-specific animations are not implemented. Bed furniture can be placed as decoration. Furniture labels and categories beyond the original 31 pieces are inferred from source asset names. Floor z-shifts identify walkable rugs and floor tiles. Agent/MCP integration is not yet implemented.

## Rebuild the furniture catalogue

```sh
python3 tools/import-furniture.py --source /Users/grantmac/Documents/Codex/2026-10-20/do-yo
```

The importer keeps full-size floor pieces with inventory icons and valid footprints, skips half-size duplicates and wall-mounted pieces, and generates both client assets and server placement metadata. `furniture-catalogue-audit.json` records the 1,223 included pieces and skipped candidates. Furniture images load when placed or previewed, and the catalogue has search, categories and 48-item pages.

Visitors can sit on chairs and walk over rugs without seeing the furniture editing panel. Only Grant sees that panel.

## Validation

```sh
npx vitest run
node --test test/furniture-model.test.js
npm run build
```

Tests cover server authorization, reserved names, session handling, all selectable appearance choices and palettes, room persistence and revision conflicts, chat identity, movement and seat occupancy, connection expiry, public room previews and shared gestures. Furniture model tests cover footprints, rotation, invalid tiles, collisions, rugs and saved-data validation.
