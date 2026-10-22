export default function beerStack(api) {
  api.on('tick', () => {
    const people = api.room.people ?? 0;
    // Artwork: one, three, six, then ten cans. This is a crowd level, not an exact can-per-person tally.
    const frame = people >= 7 ? 3 : people >= 4 ? 2 : people >= 2 ? 1 : 0;
    api.setVisual({frame, animation: false});
  });
}
