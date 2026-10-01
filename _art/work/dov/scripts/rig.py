# rig.py — part map of the Dov rest sprite (man.png). Regions are explicit per row,
# not color-only (ANIMATION.md §3). Reconstruction of all parts must equal the original.
from PIL import Image, ImageDraw
from common import REST, W, H, new_frame, diff_px, OUT

px = REST.load()

# ---- part regions: name -> list of (y0, y1, x0, x1) inclusive boxes, evaluated in order.
# First box that contains a pixel claims it. Order = priority (small parts first).
PARTS = {
    'far_fist':  [(62, 72, 38, 51)],                 # far (viewer-left) bandaged fist
    'far_arm':   [(40, 61, 38, 51)],
    'near_fist': [(65, 65, 71, 77), (66, 66, 70, 82), (67, 69, 68, 80), (70, 70, 68, 81),
                  (71, 71, 68, 80), (72, 72, 68, 79), (73, 73, 69, 79), (74, 74, 72, 78)],  # ring-traced
    'near_arm':  [(38, 66, 73, 88), (67, 76, 81, 88)],  # near sleeve, down to the fist
    'head':      [(7, 32, 48, 82)],                  # hair + face + neck (collar = torso)
    'hem_front': [(86, 100, 38, 65)],                # front flap (viewer-left)
    'hem_back':  [(86, 100, 66, 88)],                # back flap (viewer-right)
    'legs':      [(101, 120, 48, 82)],               # pants + boots
    'torso':     [(30, 85, 38, 88)],                 # coat body + lining + belt
}
COLORS = {'far_fist': (255, 0, 0), 'far_arm': (255, 140, 0), 'near_fist': (0, 200, 255),
          'near_arm': (0, 90, 255), 'head': (255, 255, 0), 'hem_front': (0, 220, 0),
          'hem_back': (0, 120, 0), 'legs': (200, 0, 255), 'torso': (150, 150, 150)}

# pivots (x, y) in canvas coords
PIVOTS = {'head': (66, 33), 'far_arm': (46, 42), 'near_arm': (80, 42), 'torso': (64, 84),
          'hem_front': (56, 86), 'hem_back': (76, 86), 'legs': (64, 100),
          'far_fist': (46, 67), 'near_fist': (75, 70)}


def owner(x, y):
    for name, boxes in PARTS.items():
        for y0, y1, x0, x1 in boxes:
            if y0 <= y <= y1 and x0 <= x <= x1:
                return name
    return None


def split(src=REST):
    parts = {n: new_frame() for n in PARTS}
    sp = src.load(); dst = {n: parts[n].load() for n in PARTS}
    unowned = 0
    for y in range(H):
        for x in range(W):
            if sp[x, y][3]:
                o = owner(x, y)
                if o is None:
                    unowned += 1; continue
                dst[o][x, y] = sp[x, y]
    return parts, unowned


def reconstruct(parts, order=('far_arm', 'far_fist', 'legs', 'hem_back', 'torso', 'hem_front', 'head',
                              'near_arm', 'near_fist')):
    fr = new_frame()
    for n in order:
        fr.alpha_composite(parts[n])
    return fr


def overlay(parts, scale=4, path=f'{OUT}/rig_overlay.png'):
    big = Image.new('RGBA', (W * scale, H * scale), (40, 40, 48, 255))
    big.alpha_composite(REST.resize((W * scale, H * scale), Image.NEAREST))
    tint = Image.new('RGBA', big.size, (0, 0, 0, 0)); tp = tint.load()
    for n, im in parts.items():
        p = im.load(); c = COLORS[n] + (140,)
        for y in range(H):
            for x in range(W):
                if p[x, y][3]:
                    for dy in range(scale):
                        for dx in range(scale):
                            tp[x * scale + dx, y * scale + dy] = c
    big.alpha_composite(tint)
    d = ImageDraw.Draw(big)
    for n, (x, y) in PIVOTS.items():
        d.ellipse([x * scale - 3, y * scale - 3, x * scale + 3, y * scale + 3], outline=(255, 255, 255), width=2)
    for y in range(0, H, 8):
        d.text((2, y * scale), str(y), fill=(255, 255, 255))
    big = big.crop((36 * scale, 0, 92 * scale, 124 * scale))
    big.save(path)
    return path


if __name__ == '__main__':
    parts, un = split()
    rec = reconstruct(parts)
    print('unowned px:', un, ' reconstruction diff:', diff_px(rec, REST))
    for n, im in parts.items():
        print(f'{n:10s} bbox={im.getbbox()}')
    print(overlay(parts))
