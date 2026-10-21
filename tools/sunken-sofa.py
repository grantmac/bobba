"""Fit the sunken sofa artwork to the lounge pit.
Maps the artwork's stone rim corners onto the pit's 6 by 4 tile diamond at twice room
resolution, trims the wooden plinth below the rim (the pit is sunken, so that part is
underground), and writes public/assets/lounge/sunken-sofa.png. The rim's far corner lands
at (256, 40) in the output, i.e. 128 px right of and 20 px below the sprite's top-left at
room scale, which is where src/main.js anchors it on the pit's origin tile.
"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'tools/sunken-sofa-source.png').convert('RGBA')
# Rim corners in the artwork: far apex, right, near apex, left, found from the light stone rim.
pixels = source.load()
def stone(p):
    r, g, b, a = p
    return a > 200 and 185 <= r <= 240 and 180 <= g <= 230 and 160 <= b <= 220 and abs(r - g) < 20 and r - b < 45
rim = [(x, y) for y in range(source.height) for x in range(source.width) if stone(pixels[x, y])]
src = [min(rim, key=lambda p: p[1]), max(rim, key=lambda p: p[0]), max(rim, key=lambda p: p[1]), min(rim, key=lambda p: p[0])]
print('rim corners', src)
D, PAD = 2, 40
width, depth = 6, 4
point = lambda x, z: ((x - z) * 32 + depth * 32, (x + z) * 16)
dst = [point(0, 0), point(width, 0), point(width, depth), point(0, depth)]
dst = [(x * D, y * D + PAD) for x, y in dst]
out_w, out_h = (width + depth) * 32 * D, (width + depth) * 16 * D + PAD + 8


def coefficients(target, origin):
    # Solve for the projective map taking output coordinates to input coordinates.
    rows, rhs = [], []
    for (x, y), (u, v) in zip(target, origin):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
    n = 8
    m = [row + [r] for row, r in zip(rows, rhs)]
    for i in range(n):
        pivot = max(range(i, n), key=lambda k: abs(m[k][i])); m[i], m[pivot] = m[pivot], m[i]
        for k in range(n):
            if k != i:
                f = m[k][i] / m[i][i]
                m[k] = [a - f * b for a, b in zip(m[k], m[i])]
    return [m[i][n] / m[i][i] for i in range(n)]


fitted = source.transform((out_w, out_h), Image.PERSPECTIVE, coefficients(dst, src), Image.BICUBIC)
# Keep only what sits on or above the near rim edges; the plinth below is underground.
keep = Image.new('L', (out_w, out_h), 0)
draw = ImageDraw.Draw(keep)
L, B, R = dst[3], dst[2], dst[1]
draw.polygon([(0, 0), (out_w, 0), (out_w, R[1]), R, B, L, (0, L[1])], fill=255)
alpha = fitted.getchannel('A').point(lambda a: a)
alpha.paste(0, mask=keep.point(lambda v: 255 - v))
fitted.putalpha(alpha)
out = root / 'public/assets/lounge/sunken-sofa.png'
fitted.save(out, optimize=True)
print('wrote', out.name, fitted.size)
