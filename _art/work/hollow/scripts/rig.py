"""Hollow rig: partition the rest frame into parts (explicit row/col regions), pivots, overlay 4x, diff-0 test."""
from common import *

REST = load_sheet('hollow.png')[0]          # facing LEFT
FLOAT_LINE = 114                             # bottom row of rest bbox; bob allowed ±3

def lum(f):
    return f[..., :3].astype(int).sum(-1) // 3

def part_masks(f=REST):
    """Return dict name -> bool mask. Regions by explicit rows/cols (+ colour only for the mouth)."""
    al = f[..., 3] > 0
    yy, xx = np.mgrid[0:FW, 0:FW]
    L = lum(f)
    hood = al & (yy <= 37)
    mouth = hood & (yy >= 16) & (yy <= 34) & (xx >= 33) & (xx <= 52) & (L < 45)
    hood = hood & ~mouth
    band = al & (yy >= 38) & (yy <= 59)
    back_arm = al & (yy >= 60) & (yy <= 79) & (xx >= 78)          # trailing wisp reaching +x
    body = al & (yy >= 60) & (yy <= 79) & ~back_arm
    t_back = al & (yy >= 80) & (xx >= 62) | back_arm
    t_front = al & (yy >= 80) & (xx < 62)
    return {'hood': hood, 'mouth': mouth, 'band': band, 'body': body,
            't_front': t_front, 't_back': t_back}

PIVOTS = {'hood': (48, 36), 'mouth': (42, 25), 'band': (50, 48), 'body': (52, 68),
          't_front': (40, 82), 't_back': (80, 82)}
Z = ['t_back', 'body', 'band', 't_front', 'hood', 'mouth']   # draw order back->front

OVERLAY = {'hood': (90, 160, 255), 'mouth': (255, 60, 60), 'band': (60, 230, 120),
           'body': (240, 200, 60), 't_front': (255, 140, 40), 't_back': (170, 90, 230)}

def parts(f=REST):
    return {k: np.where(m[..., None], f, 0).astype(np.uint8) for k, m in part_masks(f).items()}

def compose(parts_dict, offsets=None):
    """Composite parts with integer offsets (dx, dy) in Z order."""
    out = np.zeros((FW, FW, 4), np.uint8)
    for k in Z:
        p = parts_dict[k]
        dx, dy = (offsets or {}).get(k, (0, 0))
        p = np.roll(p, (dy, dx), axis=(0, 1))
        m = p[..., 3] > 0
        out[m] = p[m]
    return out

def overlay4x(f=REST, path='rig_overlay_4x.png'):
    ov = np.zeros((FW, FW, 4), np.uint8)
    for k, m in part_masks(f).items():
        ov[m] = (*OVERLAY[k], 255)
    base = Image.fromarray(f).convert('RGBA')
    o = Image.fromarray(ov)
    blend = Image.blend(base, Image.alpha_composite(Image.new('RGBA', base.size, (0, 0, 0, 0)), o), 0.6)
    blend.putalpha(base.getchannel('A'))
    big = Image.new('RGBA', (FW*4, FW*4), (30, 30, 30, 255))
    big.alpha_composite(blend.resize((FW*4, FW*4), Image.NEAREST))
    for k, (px, py) in PIVOTS.items():
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                big.putpixel((px*4+1+dx, py*4+1+dy), (255, 255, 255, 255))
    big.save(path)

if __name__ == '__main__':
    P = parts()
    rec = compose(P)
    diff = (rec != REST).any(-1).sum()
    print('reconstruction diff px:', diff)
    for k, m in part_masks().items(): print(f'  {k:8s} {m.sum():5d} px')
    overlay4x()
    save_png(REST, f'{OUT}/hollow_rest.png')
