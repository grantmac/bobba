const LETTERS = [
  ['101','101','111','101','101'],
  ['000','111','111','100','111'],
  ['1','1','1','1','1'],
  ['1','1','1','1','1'],
  ['000','111','101','101','111'],
];

// Type, hold, clear, then repeat. The hold includes a blinking cursor.
export function macintoshScreenPhase(now) {
  return Math.floor(now / 300) % 16;
}

// Screen UI in the original sprite's 154 × 158 coordinate space.
export function drawMacintoshScreen(ctx, x, y, width, height, phase = 5, mirror = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / 154, height / 158);
  // The glass face slopes upward to the right, matching the cabinet.
  ctx.transform(1, -0.5, 0, 1, 64, 59);
  ctx.fillStyle = '#233624';
  ctx.fillRect(0, 0, 28, 32);
  // Counter the cabinet flip so the text reads normally in both rotations.
  if (mirror) { ctx.translate(28, 0); ctx.scale(-1, 1); }
  ctx.translate(2, 11);
  ctx.scale(1.35, 1.8);
  ctx.fillStyle = '#dcf5ab';
  const count = phase >= 14 ? 0 : Math.min(phase, 5);
  let column = 0;
  for (const letter of LETTERS.slice(0, count)) {
    letter.forEach((row, y) => [...row].forEach((pixel, x) => {
      if (pixel === '1') ctx.fillRect(column + x, y, 1, 1);
    }));
    column += letter[0].length + 1;
  }
  if (phase < 6 || phase % 2 === 0) ctx.fillRect(column, 5, 2, 1);
  ctx.restore();
}
