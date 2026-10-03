"""Nala rig: region masks on the rest canvas. Parts partition the sprite → reconstruction diff 0 by construction."""
import sys; sys.path.insert(0, '/home/claude/nala')
from common import *

def part_masks(rest):
    a = rest[..., 3] > 0
    yy, xx = np.mgrid[0:W, 0:W]
    head = a & (((yy >= 8) & (yy <= 21)) | ((yy >= 22) & (yy <= 23) & (xx <= 26)) | ((yy == 24) & (xx <= 24)))
    white = (rest[..., 0] > 200) & (rest[..., 1] > 200) & (rest[..., 2] > 200)
    lgrey = (rest[..., 0] > 150) & (np.abs(rest[..., 0].astype(int) - rest[..., 1]) < 20) & (np.abs(rest[..., 1].astype(int) - rest[..., 2]) < 20)
    tail = a & (yy >= 50) & (yy <= 54) & (xx >= 46) & (xx <= 52) & ~white & ~lgrey   # orange+black tail tip beside the hind foot
    paw  = a & (((yy >= 48) & (yy <= 55) & (xx >= 20) & (xx <= 33)) | ((yy >= 40) & (yy <= 47) & (xx >= 23) & (xx <= 31)))
    body = a & ~head & ~tail & ~paw
    return {'head': head, 'body': body, 'paw': paw, 'tail': tail}

def cut(rest, m):
    p = np.zeros_like(rest); p[m] = rest[m]; return p

def parts(rest):
    return {k: cut(rest, m) for k, m in part_masks(rest).items()}

def body_fill_under(rest, masks):
    """body with occluded area under tail/paw filled from nearest interior body pixel on the same row (2 px inside)."""
    body = cut(rest, masks['body']).copy()
    for name in ('tail', 'paw'):
        m = masks[name]
        for y in range(W):
            xs = np.where(m[y])[0]
            if len(xs) == 0: continue
            bx = np.where(masks['body'][y])[0]
            if len(bx) == 0: continue
            for x in xs:
                near = bx[np.abs(bx - x).argmin()]
                src = near + (2 if near > x else -2)
                if src not in bx: src = near
                body[y, x] = rest[y, src]
    return body

if __name__ == '__main__':
    rest = np.array(Image.open(f'{OUT}/work/idle0.png'))
    masks = part_masks(rest)
    ps = parts(rest)
    rec = np.zeros_like(rest)
    for p in ps.values(): rec = over(rec, p)
    print('reconstruction diff =', diff(rec, rest))
    cols = {'head': (255, 80, 80), 'body': (80, 160, 255), 'paw': (80, 255, 120), 'tail': (255, 220, 60)}
    ov = rest.copy()
    for k, m in masks.items():
        ov[m, :3] = (0.45 * rest[m, :3] + 0.55 * np.array(cols[k])).astype(np.uint8)
    sc = 6
    im = Image.new('RGBA', (W*sc*2 + 12, W*sc), (40, 40, 40, 255))
    im.alpha_composite(Image.fromarray(ov).resize((W*sc, W*sc), Image.NEAREST), (0, 0))
    im.alpha_composite(Image.fromarray(body_fill_under(rest, masks)).resize((W*sc, W*sc), Image.NEAREST), (W*sc + 12, 0))
    im.save(f'{OUT}/work/rig_overlay_6x.png')
    for k, m in masks.items(): print(k, int(m.sum()), 'px')
