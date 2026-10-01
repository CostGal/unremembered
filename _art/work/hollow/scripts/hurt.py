"""Hollow hurt: pixler hurt keyframes (head tilts back, tendrils flare) + whole-frame +x knockback
(hit comes from -x), small teal crack flash on the hood at impact, return to rest. ~0.6 s."""
from common import *
from rig import REST

H = load_sheet('hollow_hurt.png')
SEQ = [
    (REST, 0, 0),   # 0 rest
    (H[2], 4, 0),   # 1 flinch, head tilts
    (H[4], 8, -1),  # 2 max tilt + knockback peak, crack flash
    (H[5], 6, 0),   # 3 tendrils flare
    (H[6], 3, 0),   # 4 settling
    (H[7], 1, 0),   # 5 almost rest
    (REST, 0, 0),   # 6 rest
]
DURS = [60, 70, 110, 90, 90, 100, 80]

def crack_fx(f, dx):
    """Two short teal crack lines on the hit side of the hood (FX layer over the sprite)."""
    out = f.copy()
    for (x0, y0, pts) in [(38 + dx, 22, [(0, 0), (1, 1), (1, 2), (2, 3), (3, 4)]),
                          (44 + dx, 30, [(0, 0), (-1, 1), (-1, 2), (-2, 3)])]:
        for px, py in pts:
            x, y = x0 + px, y0 + py
            if f[y, x, 3]: out[y, x] = (*FX, 255)
    return out

def build():
    frames = []
    for i, (src, dx, dy) in enumerate(SEQ):
        f = np.roll(src, (dy, dx), axis=(0, 1))
        if i == 2: f = crack_fx(f, dx)
        frames.append(f)
    return frames

if __name__ == '__main__':
    frames = build()
    check(frames, DURS, palette(), rest=REST, name='hurt')
    save_png(to_sheet(frames), f'{OUT}/hollow_hurt.png')
    save_gif(frames, DURS, f'{OUT}/hollow_hurt.gif')
    Image.fromarray(to_sheet(frames)).resize((FW*len(frames)*3, FW*3), Image.NEAREST).save('hurt_contact3x.png')
    for i, f in enumerate(frames): print(i, bbox(f))
