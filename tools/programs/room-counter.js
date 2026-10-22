// Live Room Counter artwork: screen corners measured in each trimmed wall view.
export default function counter(api) {
  api.on('tick', () => {
    const people = api.room.people;
    api.setVisual({display: {
      text: people === null ? '---' : String(Math.min(999999, people)).padStart(3, '0'),
      color: '#ffbe55',
      corners: api.item.direction === 4
        ? [.13, .32, .75, .63, .13, .50]
        : [.25, .63, .85, .33, .25, .79],
    }});
  });
}
