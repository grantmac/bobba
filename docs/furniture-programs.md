# Furniture programs

An asset can carry a self-contained JavaScript ES module alongside its sprites.
The existing live catalogue subscription delivers code changes to open rooms.
Each placed copy imports its module once, keeps its closure alive, and owns a
separate shared JSON state record. No app rebuild or room reload is needed to
add or edit a program after this runtime has been deployed.

## Agent workflow

1. Build the sprite asset normally with `submit_asset` or `add_asset`.
2. Read `program_api` for the versioned API and working example.
3. Call `get_program` before editing an existing program.
4. Call `set_program` with `asset_id`, JavaScript `source`, optional
   `initial_state`, and `expected_revision` from `get_program`.
5. Call `set_controls` with `asset_id`, `use` (an action label or `null`), and
   `power` (`{onLabel, offLabel}` or `null`). Labels must describe behaviour the
   program implements, such as `Drive`, `Start spinning`, or `Stop spinning`.
   Both fields are required; `null` hides that control. A program alone adds no
   buttons. Older animations created with `switchable: true` keep their default
   power labels until explicitly configured.
6. Place the asset normally. Selecting it opens its card; the configured action
   button sends `interact`, and the configured power button changes `item.on`.
   Seating still works by clicking the chair.

`set_controls` is restricted to the builder or Grant and updates every open room
without resetting program state. Read the current settings from `my_assets` or
`status`. For a spinning chair, use:

```json
{"asset_id":"YOUR_ASSET_ID","use":null,"power":{"onLabel":"Start spinning","offLabel":"Stop spinning"}}
```

`set_program` is restricted to the asset's builder or Grant. Passing
`source: null` removes the program. Every replacement increments its revision
and resets existing copies to the new defaults. Keep `initial_state` explicit
when replacing a program that needs defaults.

## Spinning chair

Use a 1×1 seat with four sprite views and configure its sitting height with
`set_seat`. Attach this source:

```js
export default function chair(api) {
  api.on('tick', ({ time }) => {
    const spinning = api.item.on && api.occupants.length > 0 && !api.reducedMotion;
    api.setVisual({
      direction: spinning ? [2, 4, 6, 0][Math.floor(time / 250) % 4] : api.item.direction,
      carryOccupants: true,
      animation: api.item.on
    });
  });
}
```

This cycles available isometric views and turns the seated avatar with them.
It does not rotate a flat image in screen space or move the chair's footprint.
Use the synchronized `time` to keep viewers at the same animation phase.

## API v1

The default export receives `api`. Read-only snapshots include `item`
(`id`, `type`, `x`, `z`, `direction`, `on`), `occupants` (`id`, `direction`),
`state`, `time`, `isHost`, and `reducedMotion`.

`api.on(event, callback)` returns an unsubscribe function. Callbacks may be
async. Events are `tick({time,delta})`, `sit(player)`, `stand(player)`,
`power({on})`, `interact({playerId,at,serial})`, `state(newState)`,
`host({isHost})`, and best-effort `dispose({})`. Ticks run at up to 20 Hz;
initial occupants and power generate their corresponding events. A new viewer
does not replay clicks from before the module mounted.

`api.setVisual(patch)` merges any of these effects:

| Field | Meaning |
| --- | --- |
| `direction` | One of the asset's available sprite directions |
| `carryOccupants` | Apply the direction and offsets to seated avatars |
| `animation` | False freezes animated sprites on their first frame |
| `frame` | Hold an existing zero-based animation frame; null resumes normal animation |
| `offsetX`, `offsetY` | Screen offset, −64 to 64 pixels |
| `opacity` | 0.15 to 1 |

`api.resetVisual()` clears overrides. Effects do not change placement,
collisions, ownership, or actual player records. Power off always freezes
sprite animation; custom behaviour should check `api.item.on`. Reduced-motion
viewers suppress direction, offset, occupant carry and sprite animation.
An explicit `frame` selection takes precedence over `animation:false`, including
with reduced motion: it represents a state rather than continuous movement.
Power off still shows the off/first frame. Frame selection is independent per copy
and never alters another copy's animation or the catalogue thumbnail. The bridge
rejects negative, fractional and out-of-range indices.

`await api.saveState(json)` persists a placed copy's state. Only `api.isHost`
may write. Await saves, catch failures, and save at most once per second.
Successful saves update `api.state` and reach the other viewers. State is
public JSON, limited to 8 KiB and 16 nested levels. Use closure variables for
temporary calculations; do not save each animation frame. A copied asset's
instances start independently from its defaults. Inventory pickup preserves
the instance's state; deleting a copy discards it.

## Runtime and multiplayer

### Connected items

Connections belong to **placed copies**, not catalogue assets. Use `room_map` to
find their IDs, read `get_connections({item_id})`, then replace the source's
outgoing links with:

```json
{"item_id":"SENSOR_COPY_ID","connections":[{"name":"occupied","target_item_id":"LIGHT_COPY_ID"}]}
```

Call `set_connections` with that object. Both ends must have programs, be placed
in the same space, and belong to the configuring player (Grant can configure
either owner's pieces). There are at most eight incoming and eight outgoing
links per copy. A name may connect to multiple targets. Names contain 1–32
letters, digits, underscores or hyphens. Pass an empty array to disconnect all
outputs. `get_connections` and `set_connections` are agent tools; there is no
browser wiring editor yet.

`await api.sendSignal(name, data = null)` publishes JSON to active connections
with that name and returns `{delivered}`. Only the elected source host can send.
Await each call and catch failures. Payloads are limited to 1 KiB and 16 levels;
the source can send once per second across all names. The server checks host,
program version, signal revision, placement, and space. As with saved state,
when the source space and lobby have no humans, online viewers may act as the
fallback host; competing viewers are serialized by the signal revision.
Duplicate host tabs
cannot both publish using the same revision. Inactive receivers are skipped;
a send with no active receivers fails.

`api.connections` contains `{name,targetId,active,data?}` for outgoing links.
`data` is present only when a retained value matches both current program
versions. Compare it before sending: an unchanged sensor needs no writes.
`api.signals` contains the latest active incoming values as
`{id,sourceId,name,data,revision,at}`. These are retained values, **not a queued
event stream**: rapid changes can coalesce while a viewer is busy or suspended.
Use them for switches, occupancy, and other current conditions.

`api.on('signal', callback)` receives those fields plus `initial` and `removed`.
A retained value generates `initial:true` when first observed, including on
mount. A later revision generates `initial:false`. A value that disappears
generates `removed:true,data:null`. The current `api.signals` snapshot already
reflects the change during the callback. Use `removed` to distinguish removal
from an intentionally published null.

Links survive program replacement and inventory pickup. Replacing either
program invalidates its old signal values until the source republishes.
Pickup or moving across spaces suspends delivery and hides retained values;
returning to the same space restores still-valid values. Deleting either copy
or its asset deletes the links. Signals do not alter power, collisions, placement,
or player records: the receiving program decides its own visual response.

### Proximity

`api.setProximityRadius(tiles)` accepts 0–8 (default 2).
`api.nearbyPlayers` contains `{id,direction,distance}` for humans in the same
space, including the viewer and seated players, excluding bots. Distance is
Euclidean floor-tile distance to the item's rotated footprint rectangle, not
its sprite or a line-of-sight test. Radius zero detects players on its footprint.
No player names, credentials, or chat are exposed.

`proximityEnter(player)` and `proximityLeave(player)` fire when membership
changes. Initial nearby players generate enter. Movement, a radius change, or
a disappearance from presence can generate leave. Power does not suppress these
events automatically; use `api.item.on` in the program. Existing interpolated
player updates drive detection, with no new subscription, polling, or writes.
Different viewers may observe a boundary at slightly different times. Only the
elected host should publish shared effects; this is not server-validated gameplay.

The `program_api` reference includes executable `proximitySensor` and
`connectedLight` examples: attach them to two assets, place both in one space,
and connect `occupied` from the sensor to the light. The sensor compares retained
output values and publishes only changes (including newly connected or edited
receivers). The light derives its opacity and animation from incoming values.
Proximity enter/leave events also work independently, without any connections.

Connections and values travel on the existing per-zone program subscription.
No timer runs on the server. Programs still execute only on clients with the
items loaded; an empty or unwatched space does not keep simulating. A late
viewer receives retained signals immediately, and an active sensor host updates
them to the current condition. Signals and proximity do not grant networking,
sound, arbitrary spawning, or authoritative movement.

### Live room counter

`api.room.people` is a read-only count of distinct connected humans throughout
the shared room, including off-screen spaces and the viewer. Duplicate tabs
count once; bots are excluded. `null` means the count is not loaded or unavailable.
Clean departures update immediately; lost connections expire after the existing
lease (up to fifteen minutes, including away visitors). A shared `room.population` subscription reads connection
leases rather than player records, so walking and appearance changes do not
invalidate it. It performs no extra writes and exposes no identities to programs.

Static wall sprites can use `setVisual({display:{text,color,corners}})`. `text`
contains 1–6 digits or hyphens; `color` is a six-digit hex color. `corners` contains
the normalized x/y pairs of the top-left, top-right and bottom-left of the screen
within the trimmed sprite. All four corners must stay within that sprite. Supply
the appropriate coordinates for each wall direction. The host draws pixel digits
in that parallelogram, without mirroring their text. Set `display:null` to clear it.
Power off hides the display; reduced motion preserves it. Animated sprites and
non-wall furniture do not support the display. Each copy has its own composited
sprite; source artwork and catalogue thumbnails are unchanged.

Read `api.room.people` on `tick`, format it with `String(count).padStart(3,'0')`,
and show `---` when it is null. No shared-state writes or host election are needed.
The `program_api` tool includes a complete example; fit its screen corners to
your own artwork. Server-rendered room pictures do not run programs; use a live
tab picture to inspect the changing digits.

Arbitrary JavaScript runs inside a dedicated worker created by a sandboxed,
opaque-origin iframe. Programs import from an in-memory blob. The frame's CSP
blocks network requests and remote modules; programs never receive the DOM,
session tokens, game objects, or game-origin storage. The bridge validates
visual fields and state size, caps output messages, and stops unresponsive
instances. Worker termination disposes timers and listeners even if code fails.
These are browser isolation and watchdog protections, not a hard memory quota.

Programs execute locally on each viewer. The online human with the lowest
player ID hosts state writes; the server independently checks this, the code
version, and an optimistic state revision. Bots never host. Duplicate tabs or
concurrent saves may conflict; handle save failures. Host changes do not
restart modules. No programs run when nobody has the room open. This runtime
does not provide trusted server game rules or general world mutations.

Program source is capped at 64 KiB. It must be self-contained; remote package
imports are not supported. New game capabilities can be added to the host API
without replacing this programming model. API v1 covers visual behaviour,
occupancy, proximity, connected signals, interactions, power and shared state; sound, arbitrary spawning,
and authoritative player movement are not exposed yet.

Browser foundations: [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
and [CSP in workers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers).

## Verification and release

Run `npx vitest run` and `npm run build`. Open
`/test/asset-program-browser.html` in the local dev server for real-browser
checks of import, lifecycle, state, isolation, and infinite-loop termination.

Deploy the Convex schema and functions before publishing the client and MCP
endpoint. Local development and production share a Convex deployment in this
repository; running backend deployment commands changes the live room.
