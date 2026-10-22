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
| `offsetX`, `offsetY` | Screen offset, −64 to 64 pixels |
| `opacity` | 0.15 to 1 |

`api.resetVisual()` clears overrides. Effects do not change placement,
collisions, ownership, or actual player records. Power off always freezes
sprite animation; custom behaviour should check `api.item.on`. Reduced-motion
viewers suppress direction, offset, occupant carry and sprite animation.

`await api.saveState(json)` persists a placed copy's state. Only `api.isHost`
may write. Await saves, catch failures, and save at most once per second.
Successful saves update `api.state` and reach the other viewers. State is
public JSON, limited to 8 KiB and 16 nested levels. Use closure variables for
temporary calculations; do not save each animation frame. A copied asset's
instances start independently from its defaults. Inventory pickup preserves
the instance's state; deleting a copy discards it.

## Runtime and multiplayer

### Live room counter

`api.room.people` is a read-only count of distinct connected humans throughout
the shared room, including off-screen spaces and the viewer. Duplicate tabs
count once; bots are excluded. `null` means the count is not loaded or unavailable.
Clean departures update immediately; lost connections expire after the existing
lease (up to 90 seconds). A shared `room.population` subscription reads connection
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
occupancy, interactions, power and shared state; sound, arbitrary spawning,
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
