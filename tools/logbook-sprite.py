"""Prepare the Guest Book catalogue sprite from the open-book artwork.
Crops the artwork to its solid pixels, scales it to a 48 px wide piece at three times
room resolution, and writes public/assets/furniture/custom_logbook.png.
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'tools/logbook-source.png').convert('RGBA')
solid = source.getchannel('A').point(lambda a: 255 if a > 40 else 0)
box = solid.getbbox()
book = source.crop(box)
DENSITY, WIDTH = 3, 48
height = round(book.height * WIDTH / book.width)
sprite = book.resize((WIDTH * DENSITY, height * DENSITY), Image.LANCZOS)
sprite.save(root / 'public/assets/furniture/custom_logbook.png', optimize=True)
print('display size', WIDTH, height, 'png', sprite.size)
