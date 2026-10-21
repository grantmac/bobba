"""Shrink the custom sprite sheets to 256-colour palettes.
They are drawn at three times display size, so palette quantisation is invisible on
screen but cuts each file by roughly two-thirds. Runs over every file the furniture
catalogue references for custom_* pieces plus the disco ball; safe to re-run.
"""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = root / 'public/assets'
files = {assets / 'disco-ball.png'}
for entry in json.loads((assets / 'furniture/catalog.json').read_text()):
    if entry['id'].startswith('custom_'):
        files.add(assets / 'furniture' / entry['icon'])
        files.update(assets / 'furniture' / part['file'] for part in entry['parts'])
before = after = 0
for path in sorted(files):
    if not path.exists():
        continue
    size = path.stat().st_size
    image = Image.open(path).convert('RGBA')
    if size < 100_000 or len(image.getcolors(257) or [0] * 300) <= 256:
        continue
    quantised = image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    quantised.save(path, optimize=True)
    before += size
    after += path.stat().st_size
    print(f'{path.name}: {size / 1e6:.2f} MB -> {path.stat().st_size / 1e6:.2f} MB')
print(f'total {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB')
