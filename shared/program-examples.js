export const spinningChairProgram=`export default function chair(api) {
  api.on('tick', ({ time }) => {
    const spinning = api.item.on && api.occupants.length > 0 && !api.reducedMotion;
    api.setVisual({
      direction: spinning ? [2, 4, 6, 0][Math.floor(time / 250) % 4] : api.item.direction,
      carryOccupants: true,
      animation: api.item.on
    });
  });
}`;
export const programReference={
  apiVersion:1,
  format:'One self-contained JavaScript ES module: export default function(api) { ... }. No remote imports, fetch, DOM, game credentials, or origin storage. Source limit 64 KiB. Syntax and runtime errors stop that instance and are reported in the room.',
  lifecycle:'set_program attaches the module to an existing asset. It loads once per placed copy, remains alive between events, and is replaced live when edited. Pickup, deletion and room exit dispose it. Each new version resets all copies to initial_state. Removing a program restores ordinary furniture.',
  controls:'After set_program, call set_controls with asset_id, use (an interaction label or null), and power ({onLabel,offLabel} or null). Labels are 1–24 characters. Only expose actions the program implements. Selecting an item opens its card without invoking interact or changing power. Changes apply live without resetting program state.',
  properties:{item:'{id,type,x,z,direction,on}: authoritative placement and power; read-only',occupants:'[{id,direction}]: players who have arrived and are sitting on this piece',state:'A copy of this instance’s shared JSON state',isHost:'True on the elected online human client responsible for shared state writes',time:'Synchronized room time in milliseconds; use this for matching animation phases across viewers',reducedMotion:'Whether this viewer requests less motion'},
  methods:{
    'setProximityRadius(tiles)':'Choose a radius from 0 to 8 tiles (default 2), measured from the rotated footprint rectangle. api.nearbyPlayers contains {id,direction,distance} for humans in the same space, including the viewer; bots are excluded. Zero detects players on the footprint. proximityEnter(player) and proximityLeave(player) fire when membership changes. Initial nearby players generate enter. Disconnection, movement and radius changes can generate leave. This uses existing interpolated presence, is client-side and is not a trusted game rule.',
    'await sendSignal(name, data = null)':'Host only. Sends JSON through the named outgoing connections configured with set_connections. Names: 1–32 letters, digits, hyphens or underscores. Data: at most 1 KiB, depth 16. At most one send per second per source across all names. Await sends and catch failures; duplicate tabs, host handoff and program changes can conflict. Returns {delivered}. Only explicit connections can receive; both pieces must still be placed in the same space.',
    'on(event, callback)':'Returns unsubscribe. Events: tick({time,delta}) at up to 20 Hz; sit/stand({id,direction}); power({on}); interact({playerId,at,serial}) from the button configured by set_controls; state(newState); host({isHost}); dispose({}) best-effort. Callbacks may be async. Initial occupants generate sit and initial power generates power. Interactions before mounting are not replayed.',
    'setVisual(patch)':'Merge fields: direction (one of the asset’s sprite view directions), carryOccupants (boolean), animation (boolean; false freezes animated art on its first frame), offsetX/offsetY (-64..64 screen pixels), opacity (0.15..1). These are visual effects only; placement and collisions stay authoritative. Power off always freezes sprite animation. Reduced-motion viewers suppress direction/offset/carry and sprite animation.',
    'resetVisual()':'Clear all visual overrides.',
    'await saveState(json)':'Host only; persist this copy’s JSON state (8 KiB, depth 16). Await each save; at most once per second. Catch failures (rate limit, version conflict, lost host, disconnect). Only successful saves update api.state. All viewers receive state. Do not save every animation frame; keep temporary variables in the module closure.'
  },
  connections:'Use room_map for placed item IDs, get_connections to inspect, then set_connections({item_id,connections:[{name:"occupied",target_item_id}]}). Both pieces must have programs and be owned by the configuring player, or the player must be Grant. At most eight incoming and eight outgoing links per copy; a name can fan out to several targets. Empty connections removes all outputs. Links persist through program edits and pickup, and disappear on deletion. api.connections is [{name,targetId,active,data?}]: active means placed and programmed in the same space; data is present only for a value valid for both current program versions. Inactive targets are skipped on sends. Compare data before sending to avoid idle writes.',
  signals:'api.signals contains the latest published value of each active incoming connection: {id,sourceId,name,data,revision,at}. on("signal", callback) receives those fields plus initial and removed. Initial retained values generate an event with initial:true; later revisions use initial:false. Removed/inactive values generate removed:true,data:null. These are retained values, not a guaranteed event queue: quick changes may coalesce, and no code runs in unwatched spaces. Use api.signals on tick to derive visuals. Program edits invalidate old values until the source publishes again; moving to another space or pickup hides them. Connections cannot move pieces or players or change collisions.',
  multiplayer:'Programs render on each viewer. Only api.isHost may save state or send signals; server checks the host in the source space or lobby, program version and revision. When both spaces have no humans, online viewers may host using revision checks to serialize competing writes. New viewers reconstruct from state/current occupants and retained signals, not past interaction replay. Programs pause when no room is open. These browser programs are for furniture behaviour, not trusted server game rules. Shared state is public room data; never put secrets in it.',
  room:'api.room.people is the number of distinct present humans across ALL spaces, including the viewer and away visitors, excluding bots and duplicate tabs. Null means not loaded/unavailable. Departures without a clean disconnect expire after the existing connection lease (up to fifteen minutes). This read-only aggregate does not expose identities. Read it on tick; do not save a copy into shared state.',
  frame:'setVisual({frame:0}) holds a specific zero-based frame of an uploaded animation strip, independently for each placed copy. Only existing frames are accepted. A selected frame takes precedence over animation:false and remains visible with reduced motion. Power off still shows the off/first frame. Set frame:null to return to normal animation. Use this with api.room.people for crowd-dependent furniture states; no state saves are needed.',
  display:'setVisual({display:{text:"003",color:"#ffbe55",corners:[0.1,0.2,0.9,0.6,0.1,0.4]}}) draws a pixel numeric display on a STATIC WALL sprite. text is 1–6 digits or hyphens; corners are normalized top-left, top-right, bottom-left points on the trimmed sprite (six numbers 0..1); fourth corner must also be within the sprite. Use the correct corners for each direction. Text is drawn normally, never mirrored. Null clears the display; power off hides it; reduced motion keeps it visible. Other sprite kinds and animations do not support this display yet.',
  examples:{proximitySensor:`export default function sensor(api) {
  api.setProximityRadius(1.5);
  let busy = false, retryAt = 0;
  api.on('tick', async ({ time }) => {
    if (!api.isHost || busy || time < retryAt) return;
    const occupied = api.item.on && api.nearbyPlayers.length > 0;
    const links = api.connections.filter(link => link.name === 'occupied' && link.active);
    if (!links.length || links.every(link => link.data === occupied)) return;
    // Publish only changes, also initializing newly connected or edited receivers.
    busy = true; retryAt = time + 1100;
    try { await api.sendSignal('occupied', occupied); }
    catch { /* A new host or connection update can race this send. */ }
    finally { busy = false; }
  });
}`,connectedLight:`export default function light(api) {
  api.on('tick', () => {
    const occupied = api.signals.some(signal => signal.name === 'occupied' && signal.data === true);
    api.setVisual({ opacity: occupied ? 1 : 0.25, animation: occupied });
  });
}`,spinningChair:spinningChairProgram,peopleCounter:`export default function counter(api) {
  api.on('tick', () => api.setVisual({display: {
    text: api.room.people === null ? '---' : String(Math.min(999999, api.room.people)).padStart(3, '0'),
    color: '#ffbe55',
    corners: api.item.direction === 4 ? [0.1,0.2,0.9,0.6,0.1,0.4] : [0.1,0.6,0.9,0.2,0.1,0.8]
  }}));
}`},
  spinningChairRequirements:'A 1×1 seat with four views at 0,2,4,6. Use set_seat to align the seated avatar. Call set_controls with use:null and power:{onLabel:"Start spinning",offLabel:"Stop spinning"}. Programs do not automatically add buttons.',
};
