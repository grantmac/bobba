"""Import full-size floor furniture from the locally extracted Origins release.
Run with --source pointing to the original extraction workspace (not the game install).
Wall sprites and half-size duplicates are not floor-placeable catalogue entries.
"""
import argparse
import collections
import json
import re
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = args.source / 'outputs/habbo-origins-assets'
extracted = args.source / 'work/origins-extracted'
assets = json.loads((source / 'manifest.json').read_text())['assets']
graph = json.loads((args.source / 'work/origins-cast-graph.json').read_text())
out = root / 'public/assets/furniture'
old = {d['id']: d for d in json.loads((out / 'catalog.json').read_text())}
by_name = {a['memberName']: a for a in assets}
props = {}
for cast in graph['releases'][0]['casts']:
    if not cast['name'].startswith('hh_furni_') or any(s in cast['name'] for s in ['_s_assets', '_50', '_small']):
        continue
    chunks = extracted / cast['name'] / 'chunks'
    keys = {}
    for p in chunks.glob('KEY_*.json'):
        for section, member, kind in re.findall(r'"sectionID": (\d+),\s*"castID": (\d+),\s*"fourCC": "([^"]+)"', p.read_text()):
            if kind == 'STXT':
                keys[int(member)] = section
    for m in cast['members']:
        if not m.get('name', '').endswith('.props') or m['memberChunkId'] not in keys:
            continue
        data = (chunks / f"STXT-{keys[m['memberChunkId']]}.bin").read_bytes()
        props[m['name'][:-6]] = data[12:12 + int.from_bytes(data[4:8], 'big')].decode('latin1')

pattern = re.compile(r'([A-Za-z0-9_]+)_([a-z])_0_(\d+)_(\d+)_([0246])_0$')
candidates = collections.defaultdict(list)
for asset in assets:
    cast = asset['castName']
    if not cast.startswith('hh_furni_') or any(s in cast for s in ['_s_assets', '_50', '_small']):
        continue
    match = pattern.fullmatch(asset['memberName'])
    if match:
        candidates[match[1]].append((asset, match))

def category_for(id, text):
    if id in old:
        return old[id]['category']
    # The original negative floor z-shift identifies rugs, mats and floor tiles.
    shifts = [int(n) for block in re.findall(r'#zshift:\s*\[([^\]]+)\]', text) for n in re.findall(r'-?\d+', block)]
    if shifts and max(shifts) < -1000:
        return 'Rugs'
    if re.search(r'carpet|(?:^|_)(rug|doormat|tatami)(?:_|$)|_rug', id):
        return 'Rugs'
    if re.search(r'chair|sofa|bench|stool|throne|(?:^|_)seat|pillow|pllw|hc_chr|hcsohva', id):
        return 'Seating'
    if re.search(r'(?:^|_)bed|sleepingbag|mattress', id):
        return 'Beds'
    if re.search(r'table|(?:^|_)(tbl|bigtb|tetbl)|desk|hc_dsk', id):
        return 'Tables'
    if re.search(r'plant|tree|flower|cactus|bamboo|yukka|bonsai', id):
        return 'Plants'
    if re.search(r'lamp|light|candle|lantern|torch', id):
        return 'Lighting'
    if re.search(r'divider|screen|railing|fence|gate|(?:^|_)door', id):
        return 'Dividers'
    return 'Decor'

catalog, skipped = [], []
for id, entries in sorted(candidates.items()):
    icon_asset = by_name.get(id + '_small')
    dimensions = {(int(m[3]), int(m[4])) for _, m in entries}
    if not icon_asset or len(dimensions) != 1 or any(w < 1 or h < 1 or w > 16 or h > 16 for w, h in dimensions):
        skipped.append({'id': id, 'reason': 'No inventory icon or unsupported floor dimensions'})
        continue
    w, h = next(iter(dimensions))
    text = props.get(id, '')
    blocks = dict(re.findall(r'"([a-z])":\s*\[(.*?)(?=\],\s*"|\]\]$)', text, re.S))
    parts = []
    for a, m in entries:
        layer, direction = m[2], int(m[5])
        block = blocks.get(layer, '')
        z = re.search(r'#zshift:\s*\[([^\]]+)\]', block)
        zs = [int(n) for n in re.findall(r'-?\d+', z[1])] if z else [0]
        ink_match = re.search(r'#ink:\s*(\d+)', block)
        ink = int(ink_match[1]) if ink_match else 8
        asset_path = a.get('inkAssetPaths', {}).get(str(ink), a['pngPath'])
        file = a['memberName'] + '.png'
        shutil.copyfile(source / asset_path, out / file)
        parts.append({'file': file, 'layer': layer, 'direction': direction, 'reg': a['regPoint'], 'width': a['width'], 'height': a['height'], 'z': zs[min(direction, len(zs)-1)], 'ink': ink, 'alphaPrepared': asset_path != a['pngPath'] or a.get('alphaPolicy') == 'native-32-bit-alpha'})
    icon = id + '-icon.png'
    shutil.copyfile(source / icon_asset.get('inkAssetPaths', {}).get('36', icon_asset['pngPath']), out / icon)
    directions = sorted({p['direction'] for p in parts})
    views = [{'direction': d, 'source': d, 'mirror': False} for d in directions]
    if len(directions) > 1 or w != h or id == 'fridge':
        for d in directions:
            opposite = {0: 6, 2: 4, 4: 2, 6: 0}[d]
            if opposite not in directions:
                views.append({'direction': opposite, 'source': d, 'mirror': True})
    if id in old:
        name = old[id]['name']
    else:
        name = id.replace('_', ' ').title()
    surface_height = max(8, min(64, max(p['reg']['y'] for p in parts) - 16)) if category_for(id, text) == 'Tables' else 0
    catalog.append({'surfaceHeight': surface_height, 'id': id, 'name': name, 'category': category_for(id, text), 'width': w, 'depth': h, 'icon': icon, 'parts': parts, 'views': sorted(views, key=lambda v: v['direction'])})

# Keep the familiar pieces first, followed by the recovered full catalogue.
catalog.sort(key=lambda d: (d['id'] not in old, list(old).index(d['id']) if d['id'] in old else d['name']))
custom = root / 'tools/custom-furniture.json'
if custom.exists():
    catalog = json.loads(custom.read_text()) + catalog
(out / 'catalog.json').write_text(json.dumps(catalog, separators=(',', ':')) + '\n')
server = {d['id']: {k: d[k] for k in ['category', 'width', 'depth', 'views', 'surfaceHeight']} for d in catalog}
(root / 'convex/lib/furniture.js').write_text('// Generated by tools/import-furniture.py; shared placement rules.\nexport const furniture=' + json.dumps(server, separators=(',', ':')) + ';\n')
report = {'items': len(catalog), 'layers': sum(len(d['parts']) for d in catalog), 'categories': dict(collections.Counter(d['category'] for d in catalog)), 'skipped': skipped, 'scope': 'Full-size floor sprites, default state/frame. Wall-mounted sprites and half-size copies excluded. Labels and non-floor categories inferred from asset names; original 31 labels retained.'}
(root / 'furniture-catalogue-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
