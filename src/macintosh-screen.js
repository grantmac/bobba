// Static screen UI in the original sprite's 154 × 158 coordinate space.
export function drawMacintoshScreen(ctx, x, y, width, height) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / 154, height / 158);
  // The glass face slopes upward to the right, matching the cabinet.
  ctx.transform(1, -0.5, 0, 1, 64, 59);
  ctx.fillStyle = '#a9bb83';
  ctx.fillRect(0, 0, 28, 32);
  ctx.fillStyle = '#263321';
  // A tiny smiling computer, like a classic Macintosh startup screen.
  ctx.fillRect(8, 6, 13, 18);
  ctx.fillStyle = '#d5e1ad';
  ctx.fillRect(9, 7, 11, 16);
  ctx.fillStyle = '#263321';
  ctx.fillRect(10, 9, 9, 9);
  ctx.fillStyle = '#d5e1ad';
  ctx.fillRect(11, 10, 7, 7);
  ctx.fillStyle = '#263321';
  ctx.fillRect(12, 11, 1, 2);
  ctx.fillRect(16, 11, 1, 2);
  ctx.fillRect(12, 14, 1, 1);
  ctx.fillRect(13, 15, 3, 1);
  ctx.fillRect(16, 14, 1, 1);
  ctx.fillRect(15, 20, 4, 1);
  ctx.fillRect(10, 21, 1, 1);
  ctx.fillRect(7, 24, 15, 1);
  // Subtle CRT scanlines keep the display in the sprite's palette.
  ctx.fillStyle = '#34442718';
  for (let row = 1; row < 32; row += 2) ctx.fillRect(0, row, 28, 1);
  ctx.restore();
}
