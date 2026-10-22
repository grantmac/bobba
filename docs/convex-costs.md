# Convex running-cost audit

The room is personally funded. Cost is an implementation constraint, including development and agent tooling. This pass adds no services or paid dependencies.

## Dashboard baseline — 22 October 2026

Read from the [project usage report](https://dashboard.convex.dev/t/grant-1845a/settings/usage?projectSlug=grantmac), for the billing period beginning 22 October. These are rounded cumulative figures, not a controlled workload or a monthly forecast.

| Resource | Reported usage |
| --- | ---: |
| Function calls, summary | 37K |
| Database I/O | 217.85 MB |
| Data egress | 692.29 MB |
| File serving portion of egress | 690.93 MB (99.8%) |
| Action fetch portion of egress | 1.36 MB (0.2%) |

The named-function call breakdown displayed 28K, with presence 5.5K, Pong state 5.1K, heartbeat 2K, capture checks 1.9K, whiteboard updates 1.8K and program lists 1.1K. The dashboard summary and this breakdown have different totals; do not treat 28K as total billed calls.

The largest listed database I/O consumers were room movement (56.73 MB), agent placement (17.67 MB), the legacy room state query (13.43 MB), agent removal (12.38 MB), heartbeat (12.14 MB) and bot tick (9.56 MB).

The deployed app and local configuration share `perfect-peacock-308`, the cloud development deployment. The separate production deployment is unused. Development traffic therefore contributes to this project's usage.

## Changes and verified budgets

| Path | Before | After |
| --- | --- | --- |
| Periodic heartbeat | 240 calls per connected tab-hour | 120, plus initial connection and page restores |
| Connection crash timeout | 45 seconds | Away after 5 minutes, removed after 15; clean departures still immediate |
| Pong | Always subscribed; up to 10 paddle writes/second/paddle | Removed from the client: zero Pong subscriptions or gameplay calls |
| Slow heartbeat request | Further requests can queue | At most one in flight per connection |
| Session subscription | `session` and `me` both validate the same token | `me` remains; redundant `session` subscription removed |
| Capture checks, agent list, guest book | Also read the moving player document | Read the session and relevant records only |
| Live zone presence | Reads clock and temporary arrival range | Reads online players in that zone; clock comes from heartbeat |
| Legacy Pong endpoints | Read game and player records; write gameplay state | Constant idle state and inert mutations; no database access |
| Zone program subscriptions | Every visible zone | Only zones containing custom furniture; stop when the last custom piece leaves |
| Movement map read | Loads the room twice | Reuses the loaded room before loading zone furniture |

Session expiry and moderation checks remain server-side. Legacy endpoints remain available. New connections advertise the slower cadence only after the backend supports it; legacy expiry jobs use each row's recorded timeout. No data migration is required. Deploy backend before frontend; rolling back the backend alone requires restoring the previous frontend first and handling new connection leases.

Quiet tabs now transition to away before leaving. The same per-connection scheduled job checks the five-minute quiet deadline, then the fifteen-minute removal deadline; it does not add a polling loop. Normal heartbeats still update only the connection row. Player records change only on away/active/departed transitions, and sibling tabs are inspected only during those transitions. The simulated steady-hour regression checks 120 periodic heartbeat writes, at most 15 lease checks, one outstanding follow-up job, and no player writes. These are operation counts for the tested path, not a billing estimate.

`test/network-cost.test.js` exercises the real client scheduling with a mocked transport, including old-backend fallback, slow requests, shutdown, absence of Pong subscriptions and the lifecycle of furniture-program subscriptions. `test/multiplayer.test.js` covers database dependencies, authorization, lease upgrades, mixed old/new connections, idle presence, disconnect, crash expiry and inert legacy Pong handlers. These tests verify request budgets and behavior, not dollar savings or Convex production cache-hit rates.

Pong was removed at the owner's request after the initial throttling pass. Its 5.1K historical state calls were approximately 18% of the 28K named-function breakdown (14% of the 37K summary), before counting gameplay mutations. This describes historical usage, not a promised percentage reduction in the bill. The old table is retained without reads or writes to avoid a destructive data migration. Compatibility endpoints let already-open tabs stop playing without subscription errors; those tabs can still make initial or user-triggered calls until refreshed.

## Agent checks and images — follow-up

Routine agent checks now use `room_overview`: one authenticated query returns current players, spaces and furniture as text. It does not resolve storage URLs, download images, launch Chromium or create a capture. Mutation replies confirm edits; MCP instructions, follow-up hints and the bundled plugin skill no longer instruct agents to take a picture after every change. `room_picture` and `preview_asset` still explicitly request visual inspection. Existing installed plugin copies need the updated skill, and existing agent conversations may retain old instructions until refreshed.

Focused server pictures now resolve surface image URLs only for the requested space, retain the other spaces' dimensions for positioning, and draw only the selected zones. Previously the renderer initialized every space and could download distant floor/wall pictures even for a focused picture. Scene preparation also avoids loading custom asset geometry before reading the same assets again for their sprites.

The public asset catalogue contained 130 custom pieces and 404 distinct image URLs during this check. HEAD requests for three images returned `Cache-Control: private, max-age=2592000` (30 days) and `cf-cache-status: DYNAMIC`. Browser caching is already enabled; these responses do not provide a shared CDN cache. The renderer still starts with a fresh browser cache for explicitly requested pictures. The usage dashboard does not attribute file serving to players versus renders.

Six existing first-part images were downloaded once for a lossless PNG compression comparison:

| Sample | Stored bytes | Re-encoded bytes |
| --- | ---: | ---: |
| Bondi iMac G3 | 19,521 | 19,406 |
| Black iPod Classic | 4,812 | 4,762 |
| Neon Karaoke Machine | 36,791 | 36,776 |
| Lone Poolside Weed | 18,455 | 17,512 |
| Empty Swimming Pool | 198,553 | 173,571 |
| Mechanical Bucking Bull | 608,275 | 397,903 |

Combined: 886,407 → 649,930 bytes, a 26.7% reduction in this small sample (not a catalogue-wide or bill forecast). New sprite, animation, foreground and surface uploads now try the existing PNG encoding and standard deflate compression, keeping the smaller. Pixel dimensions, RGBA values and appearance remain identical. This adds one encoding pass at upload time, no new dependency or per-download transformation. Existing stored images have not been rewritten; they need a separate migration to benefit.

Next image options: re-encode existing large sprites once, then measure remaining picture traffic before adding a shared cache. A shared CDN could serve cold visitors and fresh renderer browsers from one cached copy, but would shift delivery traffic to that provider. A bounded warm-process renderer cache would avoid some repeated downloads without another service, but cold starts would still miss. Neither has been added in this pass.

## Thumbnails, rotations and bot idle checks

- New custom assets get a separate PNG icon, at most 72×72 pixels for the 36px catalogue card. Animated icons contain the first frame only; seat foregrounds are composited into it. The original room sprites remain unchanged. This saves file-serving bandwidth while browsing, but adds one small upload per new asset; it is not a reduction in database function calls by itself.
- Furniture loads only the source for its current rotation. Mirrored views share a source and loaded sources are retained for later rotations. Foreground layers, animation and powered-off images load together. The previous angle remains visible until a new angle is ready. Explicit asset previews still render every requested view. This avoids image requests/bytes for unused angles, not room synchronization calls.
- Bot maintenance now runs every 15 minutes: 96 scheduled invocations/day instead of 1,440 (1,344 fewer, 93.3% lower for the fixed maintenance timer). Arrivals and zone changes can wake roaming; it reschedules only while humans are in the bot's zone. Reply scheduling and active leases install durable recovery checks. Retired jobs are ignored. A final queued check may run after the last human leaves. Active conversations and roaming still incur calls, so this is not a prediction for total app savings. Maintenance retains installation, legacy-job recovery and bounded cleanup.

### Existing icon rollout

Deploy backend first, then frontend/MCP. Existing sprite URLs and old clients remain valid. The thumbnail migration is internal/admin-only, processes ten assets at a time, and compares the previous icon before replacing it. It never deletes a sprite still used in the room; a concurrent replacement discards only the newly generated unused thumbnail. Already converted assets are skipped on reruns.

After deployment, inventory candidates without downloading or modifying images:

```sh
node tools/backfill-thumbnails.mjs --deployment-name perfect-peacock-308
```

Then convert the same deployment with `--apply`. The runner reports source-icon bytes versus new thumbnail bytes per batch and totals. It can be restarted after failure; finished batches are retained and skipped. The conversion is a one-time storage/read/write cost. Existing full-size sprite recompression remains separate.

Rollout on 22 October 2026: deployed the schema and functions to `perfect-peacock-308`, confirmed as the backend used by the live website. The inventory found 152 candidates and the migration converted all 152. The original files used as icons totaled 12,045,107 bytes; their new thumbnails total 919,187 bytes, 92.4% smaller for those catalogue images. This is not a reduction in total app traffic or the bill: original sprites remain available and still load when needed in the room. A fresh catalogue read found zero icons reusing a room sprite. Three sample thumbnails were at most 72 pixels on each side, and their original sprites still returned HTTP 200. Release validation passed 206 Vitest tests, 12 image/loader tests and the production build.

Validation includes PNG/animation/foreground tests; a migration integration test for dry-run, repeat-run and concurrent replacement; browser checks for rotation download counts, mirrored sharing, removal, animation, power states and program-driven rotations; and bot tests for empty-room stopping, arrival restart, lease recovery and obsolete timers.

## Remaining priorities

### Additional code audit — 22 October

- **Whiteboard limit check, implemented:** previously every new stroke read up to 401 full stroke records to enforce the 400-stroke limit. The board now keeps an atomic `strokeCount`. The limit check reads no stroke rows below capacity and only the oldest row at capacity; the normal stroke lookup and authentication remain. Legacy boards initialize the count once, on their next new stroke. Clear resets it. Tests cover initialization, eviction order, finished-stroke retries, extensions and clear/reuse. This reduces database reads, not the number of drawing mutations. If reverting to a backend that does not maintain this counter, remove the counter before upgrading again so it is recounted.
- **Catalogue thumbnails, implemented above:** all 141 custom pieces in the initial follow-up sample reused a full sprite as their icon. Small first-frame icons now serve catalogue cards; original sprites remain for room rendering. Compare combined icon + sprite traffic for pieces actually placed.
- **Load only needed rotations, implemented above:** furniture now loads its displayed rotation first and shares promises for views that use the same source. Foreground layers, animation and preview-all-views behavior are preserved.
- **Bot idle work, implemented above:** the fixed maintenance timer now runs every 15 minutes, with visitor-driven roaming and durable recovery checks for interrupted AI turns.
- **Catalogue metadata:** the follow-up `assets:list` JSON was 189,182 bytes for 141 pieces, including 6,959 bytes of program source. All clients subscribe to the complete list. Separate lightweight catalogue metadata from detailed sprites/programs loaded for visible pieces; measure the extra requests against bytes saved. This is smaller than the file-serving problem, not the first priority.

These are code observations and one live catalogue sample, not measured monthly savings. No new cache service was added. The earlier image compression applies to new uploads only.

1. **File serving:** it dominates egress. Measure actual asset sizes, repeated downloads, browser cache behavior and fresh server-rendered screenshots. The renderer opens a fresh browser per picture, so it cannot reuse another render's browser cache. Establish how much it contributes before changing storage or adding a CDN.
2. **Walking and placement reads:** collision checks load zone furniture and the full custom-asset documents to extract small geometry definitions. Consider separate compact geometry records only if a measured workload justifies the additional write/migration complexity. Preserve server-side occupancy and ownership checks.
3. **Whiteboard:** each delta currently resubscribes at the newest serial, creating a follow-up query. Any batching change must preserve strokes, clear events and catch-up after disconnects; compare call savings against increased bytes.
4. **Bot recovery and roaming:** compare idle and active periods separately, and verify failed actions still recover after deployment.
5. **Cold data sharing:** authenticated map/furniture queries carry per-session arguments, limiting sharing across viewers. Do not remove access checks solely to improve cache hits.

Compare equivalent periods and activity after rollout: connected tab-hours, movements, builds and pictures. Verify that new clients make no Pong calls. Check call counts, I/O and file serving separately. Retain this baseline; no total bill reduction has been measured yet.

Convex's [realtime documentation](https://docs.convex.dev/realtime) explains automatic query caching, and its [best practices](https://docs.convex.dev/understanding/best-practices) cover changing clocks and broad query dependencies. Fewer subscriptions alone are not a reliable cost measure.
