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
  properties:{item:'{id,type,x,z,direction,on}: authoritative placement and power; read-only',occupants:'[{id,direction}]: players who have arrived and are sitting on this piece',state:'A copy of this instance’s shared JSON state',isHost:'True on the elected online human client responsible for shared state writes',time:'Synchronized room time in milliseconds; use this for matching animation phases across viewers',reducedMotion:'Whether this viewer requests less motion'},
  methods:{
    'on(event, callback)':'Returns unsubscribe. Events: tick({time,delta}) at up to 20 Hz; sit/stand({id,direction}); power({on}); interact({playerId,at,serial}) from clicks or Use; state(newState); host({isHost}); dispose({}) best-effort. Callbacks may be async. Initial occupants generate sit and initial power generates power. Interactions before mounting are not replayed.',
    'setVisual(patch)':'Merge fields: direction (one of the asset’s sprite view directions), carryOccupants (boolean), animation (boolean; false freezes animated art on its first frame), offsetX/offsetY (-64..64 screen pixels), opacity (0.15..1). These are visual effects only; placement and collisions stay authoritative. Power off always freezes sprite animation. Reduced-motion viewers suppress direction/offset/carry and sprite animation.',
    'resetVisual()':'Clear all visual overrides.',
    'await saveState(json)':'Host only; persist this copy’s JSON state (8 KiB, depth 16). Await each save; at most once per second. Catch failures (rate limit, version conflict, lost host, disconnect). Only successful saves update api.state. All viewers receive state. Do not save every animation frame; keep temporary variables in the module closure.'
  },
  multiplayer:'Programs render on each viewer. Only api.isHost may save state; server checks host, program version and state revision. New viewers reconstruct from state/current occupants, not past interaction replay. Programs pause when no room is open. These browser programs are for furniture behaviour, not trusted server game rules. Shared state is public room data; never put secrets in it.',
  examples:{spinningChair:spinningChairProgram},
  spinningChairRequirements:'A 1×1 seat with four views at 0,2,4,6. Use set_seat to align the seated avatar. The default power switch is available on all programmed pieces.',
};
