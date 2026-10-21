"""Build the Poolside FM wall sign from the logo artwork.
Usage: python3 tools/poolside-sign.py path/to/poolside-logo.png
Lifts the pale pink lettering off the photo, renders it at sign size (at three
times the room's pixel density, with soft edges and a drop shadow), and writes the flat sign plus copies pre-sheared for the left
and right room walls into public/assets/posters/.
"""
import colorsys
import sys
from pathlib import Path
from PIL import Image

WIDTH, DENSITY = 118, 3  # on-screen width in room pixels; drawn at DENSITY times that for smoother edges
FILL, SHADOW = (255, 172, 216), (150, 40, 110)
src = Image.open(sys.argv[1]).convert('RGB')
pixels = src.load()
mask = Image.new('L', src.size, 0)
mp = mask.load()
for y in range(src.height):
    for x in range(src.width):
        hue, sat, val = colorsys.rgb_to_hsv(*(c / 255 for c in pixels[x, y]))
        if val > .72 and sat >= .11 and (hue > .84 or hue < .02):
            mp[x, y] = 255
box = mask.getbbox()
mask = mask.crop((box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2))
width = WIDTH * DENSITY
small = mask.resize((width, round(mask.height * width / mask.width)), Image.LANCZOS)
# Soft-edged coverage: boost the lettering, drop faint halo pixels.
alpha = small.point(lambda a: 0 if a < 40 else min(255, round(a * 1.7)))
sign = Image.new('RGBA', (small.width + DENSITY, small.height + DENSITY), (0, 0, 0, 0))
shadow = Image.new('RGBA', sign.size, SHADOW + (0,))
shadow.putalpha(Image.new('L', sign.size, 0))
shadow.paste(Image.new('RGBA', small.size, SHADOW + (255,)), (DENSITY, DENSITY), alpha)
letters = Image.new('RGBA', sign.size, (0, 0, 0, 0))
letters.paste(Image.new('RGBA', small.size, FILL + (255,)), (0, 0), alpha)
sign.alpha_composite(shadow)
sign.alpha_composite(letters)
out = Path(__file__).resolve().parents[1] / 'public/assets/posters'
sign.save(out / 'poolside-fm.png')
w, h = sign.size
for side in ('left', 'right'):
    sheared = Image.new('RGBA', (w, h + (w - 1) // 2 + 1), (0, 0, 0, 0))
    for c in range(w):
        shift = round((w - 1 - c) * .5) if side == 'left' else round(c * .5)
        column = sign.crop((c, 0, c + 1, h))
        sheared.paste(column, (c, shift), column)
    sheared.save(out / f'poolside-fm-{side}.png')
print('wrote sign', sign.size)
