"""Make the Porsche's window glass translucent so a seated avatar shows through it.
Run once against the sprite sheet (path as the first argument, default custom_porsche.png); glass pixels are the blue-grey tint inside the cabin.
"""
import sys
from pathlib import Path
from PIL import Image

GLASS_ALPHA = 0.5
MIN_PANE = 300  # ignore stray blue-tinted highlights on the bodywork
path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'public/assets/furniture/custom_porsche.png'
image = Image.open(path).convert('RGBA')
pixels = image.load()
width, height = image.size
glass = {(x, y) for y in range(height) for x in range(width)
         if (lambda r, g, b, a: a > 100 and b - r >= 12 and b >= 50 and r <= 140)(*pixels[x, y])}
seen = set()
for start in list(glass):
    if start in seen:
        continue
    pane, queue = [], [start]
    seen.add(start)
    while queue:
        x, y = queue.pop()
        pane.append((x, y))
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n in glass and n not in seen:
                seen.add(n)
                queue.append(n)
    if len(pane) < MIN_PANE:
        continue
    for x, y in pane:
        r, g, b, a = pixels[x, y]
        pixels[x, y] = (r, g, b, round(a * GLASS_ALPHA))
image.save(path)
print('glass pixels made translucent:', sum(1 for p in seen if pixels[p][3] < 200))
