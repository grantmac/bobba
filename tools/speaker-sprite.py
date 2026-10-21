"""Prepare the Wall speaker catalogue sprites from the supplied two-view artwork.
The source shows the same speaker twice: on the left facing lower-right (hung on the room's
left wall, rotation 2) and on the right facing lower-left (right wall, rotation 4). Each view
is cropped to its solid pixels and scaled to 48 room pixels wide at three times room resolution.
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'tools/speaker-source.png').convert('RGBA')
alpha = source.getchannel('A')
gap = [x for x in range(source.width // 3, source.width * 2 // 3) if alpha.crop((x, 0, x + 1, source.height)).getbbox() is None]
split = (gap[0] + gap[-1]) // 2
WIDTH, DENSITY = 48, 3
views = {}
for side, box in (('left', (0, 0, split, source.height)), ('right', (split, 0, source.width, source.height))):
    view = source.crop(box)
    views[side] = view.crop(view.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox())
height = round(max(v.height * WIDTH / v.width for v in views.values()))
out = root / 'public/assets/furniture'
for side, view in views.items():
    view.resize((WIDTH * DENSITY, height * DENSITY), Image.LANCZOS).save(out / f'custom_speaker_{side}.png', optimize=True)
views['left'].resize((WIDTH * 2, height * 2), Image.LANCZOS).save(out / 'custom_speaker_icon.png', optimize=True)
print('display size', WIDTH, height)
