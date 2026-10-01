"""Rhea sprite rig: segmentation into parts, occlusion fill, pivots, overlay."""
from PIL import Image
import json

import os
W = H = 128
SLIM = int(os.environ.get('RHEA_SLIM', '0'))     # columns removed from the coat/legs


def make_slim(src, d):
    """Narrow the figure: delete d columns from the coat body (rows 24-103, at x=65..)
    and from the trousers/back boot (rows 104-121, at x=74..); the head is untouched."""
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sp, op = src.load(), out.load()
    for y in range(H):
        cut = 65 if 24 <= y <= 103 else (74 if y >= 104 else None)
        for x in range(W):
            if cut is None or x < cut:
                op[x, y] = sp[x, y]
            elif x + d < W:
                op[x, y] = sp[x + d, y]
    return out


SRC = Image.open('rhea.png').convert('RGBA')
if SLIM:
    SRC = make_slim(SRC, SLIM)
    SRC.save('rhea_slim.png')
PX = SRC.load()


def orig_x(x, y):
    """Map a (slim) canvas x back to the original art's x for classification."""
    if SLIM and ((24 <= y <= 103 and x >= 65) or (y >= 104 and x >= 74)):
        return x + SLIM
    return x
PALETTE = set(PX[x, y][:3] for y in range(H) for x in range(W) if PX[x, y][3])
FX_TEAL = (0x3f, 0xd0, 0xc9)
FX_WHITE = (0xf1, 0xef, 0xe8)
ALLOWED = PALETTE | {FX_TEAL, FX_WHITE}


def opaque(x, y):
    return 0 <= x < W and 0 <= y < H and PX[x, y][3] > 0


def rgb(x, y):
    return PX[x, y][:3]


def is_skin(c):
    r, g, b = c
    return r >= 150 and r > g > b and r - b >= 40


def is_hair(c):
    r, g, b = c
    return min(r, g, b) >= 100 and not is_skin(c)


def is_coat(c):
    r, g, b = c
    return b >= 40 and r < 40 and g < 60 and b > r + 12 and not (r < 22 and g < 22 and b < 50)


def is_teal(c):
    r, g, b = c
    return g > 150 and b > 150 and r < 120


def row_extent(y):
    xs = [x for x in range(W) if opaque(x, y)]
    return (min(xs), max(xs)) if xs else None


# ---------------------------------------------------------------- part masks
# order = priority of assignment (first wins)
PART_ORDER = ['hair', 'head', 'baton', 'front_arm', 'back_arm', 'bag', 'strap',
              'legs', 'hem', 'torso']


def classify(x, y):
    c = rgb(x, y)
    x = orig_x(x, y)
    # ---- head / hair (rows 6..25)
    if 6 <= y <= 25 and x >= 58:
        if y <= 23 and is_hair(c) and not (x <= 63 and y >= 13 and is_skin(c)):
            return 'hair'
        if y <= 24 or (y == 25 and is_skin(c)):
            # neck/collar begins ~y24 at x>=67 with coat colours
            if is_coat(c) and y >= 22 and x >= 71:
                return 'torso'
            return 'head'
    # ---- baton (lower-left diagonal)
    if y >= 70 and x <= 57 - int((y - 70) * 0.6):
        return 'baton'
    # ---- front glove + sleeve (near-side arm)
    if 63 <= y <= 69 and x <= 59:
        return 'front_arm'
    if 44 <= y <= 62:
        ext = row_extent(y)
        if ext and x <= ext[0] + 5:
            return 'front_arm'
    # ---- back arm (far glove + cuff), between coat body and bag
    if 55 <= y <= 73 and 69 <= x <= 78 and not (y >= 74):
        r, g, b = c
        # glove greys / cuff purples, not coat blue
        if not is_coat(c) or y >= 62:
            return 'back_arm'
        if y >= 55 and x >= 70:
            return 'back_arm'
    # ---- bag body
    if 54 <= y <= 77 and x >= 78:
        return 'bag'
    if 74 <= y <= 77 and x >= 70 and not is_coat(c):
        return 'bag'
    # ---- straps
    if 27 <= y <= 53:
        ext = row_extent(y)
        if ext and x >= 77 and not is_coat(c) and not is_teal(c):
            return 'strap'
        if 67 <= x <= 73 and not is_coat(c):
            return 'strap'
        if y <= 29 and 72 <= x <= 78 and not is_coat(c):
            return 'strap'
    # ---- legs / boots
    if y >= 104:
        return 'legs'
    # ---- hem (lower coat)
    if y >= 88:
        return 'hem'
    return 'torso'


def build_masks():
    masks = {p: set() for p in PART_ORDER}
    for y in range(H):
        for x in range(W):
            if opaque(x, y):
                masks[classify(x, y)].add((x, y))
    return masks


MASKS = build_masks()

PIVOTS = {
    'hair': (68, 24), 'head': (68, 24), 'torso': (71, 60),
    'front_arm': (60, 33), 'baton': (55, 68), 'back_arm': (76, 33),
    'bag': (75, 30), 'strap': (75, 30), 'hem': (71, 88), 'legs': (73, 104),
}

OVERLAY_COLORS = {
    'hair': (255, 255, 255), 'head': (255, 210, 120), 'torso': (60, 120, 255),
    'front_arm': (255, 80, 80), 'baton': (255, 0, 200), 'back_arm': (255, 160, 0),
    'bag': (160, 100, 40), 'strap': (255, 240, 0), 'hem': (0, 200, 120),
    'legs': (140, 60, 220),
}


def part_image(name):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    p = im.load()
    for (x, y) in MASKS[name]:
        p[x, y] = PX[x, y]
    return im


def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


# ------------------------------------------------------------- occlusion fill
def fill_occluded(base_name, occluders, extra=None):
    """Return an image of base part with pixels under `occluders` filled by the
    nearest horizontal base pixel colour on the same row (pure palette copy)."""
    im = part_image(base_name)
    p = im.load()
    base = MASKS[base_name]
    holes = set()
    for o in occluders:
        holes |= MASKS[o]
    if extra:
        holes |= extra
    rows = {}
    for (x, y) in base:
        rows.setdefault(y, []).append(x)
    for (x, y) in sorted(holes, key=lambda t: (t[1], t[0])):
        if (x, y) in base:
            continue
        xs = rows.get(y)
        if not xs:
            # copy the nearest row that has base pixels
            for d in range(1, 8):
                for yy in (y - d, y + d):
                    if yy in rows:
                        xs = rows[yy]; break
                if xs:
                    break
            if not xs:
                continue
            src_y = yy
        else:
            src_y = y
        # nearest base x on that row, prefer interior (inward) pixels
        nx = min(xs, key=lambda xx: abs(xx - x))
        # step 2 px inward from the edge so we don't copy outline colours
        lo, hi = min(xs), max(xs)
        if nx == lo and lo + 2 <= hi:
            nx = lo + 2
        if nx == hi and hi - 2 >= lo:
            nx = hi - 2
        p[x, y] = PX[nx, src_y]
    return im


def build_parts():
    parts = {}
    # torso: fill under front arm, back arm, bag, straps, head/neck shadow
    torso_holes = set()
    # region behind the bag/back arm where the coat continues
    for y in range(54, 78):
        for x in range(60, 89):
            if opaque(x, y) and 69 <= orig_x(x, y) <= 88:
                torso_holes.add((x, y))
    # front sleeve region
    front_strap = {p for p in MASKS['strap'] if p[0] <= 79 or p[1] <= 30}
    parts['torso'] = fill_occluded('torso', ['front_arm', 'back_arm', 'bag'],
                                   extra=torso_holes | front_strap)
    # hem: fill under bag bottom (y 74-77) - none needed, but fill under legs? no
    parts['hem'] = fill_occluded('hem', ['bag'])
    # legs: extend trouser columns upward under the hem (y 88..103) using the
    # trouser rows 104-105 as source so legs can show when the coat lifts.
    legs = part_image('legs')
    lp = legs.load()
    for y in range(88, 104):
        for x in range(70, 78 - SLIM):
            lp[x, y] = PX[x, 104 if (y % 2 == 0) else 105]
        lp[69, y] = PX[70, 104]
    parts['legs'] = legs
    for n in ['hair', 'head', 'front_arm', 'baton', 'back_arm', 'bag', 'strap']:
        parts[n] = part_image(n)
    # head: fill under the fringe hair so hair can shift a pixel
    hp = parts['head'].load()
    for (x, y) in MASKS['hair']:
        if 12 <= y <= 23 and 62 <= x <= 76 and (x, y) not in MASKS['head']:
            # nearest skin pixel to the left/right in that row
            for d in range(1, 6):
                for xx in (x - d, x + d):
                    if (xx, y) in MASKS['head'] and is_skin(rgb(xx, y)):
                        hp[x, y] = PX[xx, y]; break
                else:
                    continue
                break
    # back arm: fill the sleeve area hidden by the bag strap
    parts['back_arm'] = fill_occluded('back_arm', ['strap'])
    return parts


PARTS = build_parts()


def overlay(scale=4):
    im = Image.new('RGBA', (W, H), (26, 28, 40, 255))
    p = im.load()
    for name, pts in MASKS.items():
        col = OVERLAY_COLORS[name]
        for (x, y) in pts:
            c = PX[x, y][:3]
            lum = (c[0] * 3 + c[1] * 6 + c[2]) // 10
            k = 0.45 + 0.55 * lum / 255
            p[x, y] = (int(col[0] * k), int(col[1] * k), int(col[2] * k), 255)
    for name, (px_, py_) in PIVOTS.items():
        p[px_, py_] = (255, 255, 255, 255)
    im = im.crop((28, 0, 100, 128)).resize((72 * scale, 128 * scale), Image.NEAREST)
    return im


if __name__ == '__main__':
    print('bbox', bbox(set().union(*MASKS.values())))
    print('palette size', len(PALETTE))
    for n in PART_ORDER:
        print(n, len(MASKS[n]), bbox(MASKS[n]) if MASKS[n] else None, 'pivot', PIVOTS[n])
    overlay().save('overlay_4x.png')
    # reconstruction check
    recon = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for n in ['strap', 'legs', 'hem', 'torso', 'bag', 'back_arm', 'head', 'hair', 'front_arm', 'baton']:
        recon.alpha_composite(part_image(n))
    diff = sum(1 for y in range(H) for x in range(W) if recon.getpixel((x, y)) != PX[x, y])
    print('reconstruction diff pixels:', diff)
    sheet = Image.new('RGBA', (128 * 10, 128), (26, 28, 40, 255))
    for i, n in enumerate(PART_ORDER):
        sheet.alpha_composite(PARTS[n], (i * 128, 0))
    sheet.crop((0, 0, 1280, 128)).resize((1280 * 2, 256), Image.NEAREST).save('parts_2x.png')
    json.dump({'bbox': [35, 6, 91, 121], 'palette_size': len(PALETTE),
               'parts': {n: {'pixels': len(MASKS[n]), 'bbox': bbox(MASKS[n]), 'pivot': PIVOTS[n]}
                         for n in PART_ORDER}}, open('rig.json', 'w'), indent=1)
