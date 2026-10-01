# rig.py — the Clerk rig on the rest pose (native 128x128, facing LEFT)
# Parts are disjoint masks of the rest sprite; reconstruction == rest (diff 0).
import numpy as np
from common import *

REST = load_sheet('clerk')[0]

def _box(x0, x1, y0, y1):
    m = np.zeros((N, N), bool); m[y0:y1+1, x0:x1+1] = True; return m

def build_parts(rest=REST):
    a = rest[..., :3].astype(int); al = rest[..., 3] > 0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1)
    warm = (r > 95) & (r > b + 25)                 # skin / paper / leather
    shirt = (b > r + 15) & (mx > 140)              # blue-grey shirt
    tie = (r > 140) & (g < 75)                     # red tie
    glasses = (mx < 130) & (b <= r)                # black/grey lenses
    bright = mx >= 100
    parts = {}
    # head: skin, hair, glasses, ear — above the collar line
    hb = _box(56, 80, 7, 25)
    parts['head'] = al & hb & ((bright & ~shirt & ~tie) | glasses)
    # front hand holding the ledger spine
    parts['hand_front'] = al & _box(33, 38, 37, 45) & (r >= 200) & (g >= 130)
    # ledger (paper + leather cover)
    coat = (b >= r) & (mx < 130)                    # purple-dark coat tones
    bookmark = (b > r + 30) & (b > 60)              # the blue bookmark tab on the ledger
    parts['ledger'] = al & _box(30, 56, 25, 46) & (~coat | bookmark) & ~parts['hand_front']
    # front sleeve (upper arm, elbow bent; forearm is hidden behind the ledger)
    parts['sleeve_front'] = al & _box(52, 61, 25, 46) & coat
    used = parts['head'] | parts['hand_front'] | parts['ledger'] | parts['sleeve_front']
    # lower body
    parts['legs'] = al & ((_box(56, 66, 61, 111)) | _box(30, 100, 112, 120)) & ~used
    parts['hem_front'] = al & _box(30, 55, 61, 111) & ~used
    parts['hem_back'] = al & _box(67, 100, 61, 111) & ~used
    used |= parts['legs'] | parts['hem_front'] | parts['hem_back']
    # torso = coat body, collar, shirt, tie, back arm + pocket hand, button; takes the remainder
    parts['torso'] = al & ~used
    return parts

PIVOT = {  # (x, y) native
    'head': (68, 25), 'torso': (72, 60), 'sleeve_front': (58, 27), 'ledger': (38, 42),
    'hand_front': (38, 42), 'legs': (62, 62), 'hem_front': (56, 61), 'hem_back': (72, 61),
}
Z = ['hem_back', 'legs', 'hem_front', 'torso', 'head', 'sleeve_front', 'ledger', 'hand_front']

def part_img(rest, mask):
    out = np.zeros_like(rest); out[mask] = rest[mask]; return out

def fill_rows(img, mask_target, rows, direction):
    """Occlusion fill: for rows in `rows`, extend the part horizontally into `mask_target`
    by copying the pixel 2 px inside the part's edge on the same row (no outline copy)."""
    out = img.copy()
    for y in rows:
        xs = np.where(out[y, :, 3] > 0)[0]
        if len(xs) == 0: continue
        tx = np.where(mask_target[y])[0]
        if len(tx) == 0: continue
        if direction == 'left':   # fill to the left of the part
            edge = xs.min(); src = out[y, min(edge + 2, xs.max())]
            for x in tx:
                if x < edge: out[y, x] = src
        else:
            edge = xs.max(); src = out[y, max(edge - 2, xs.min())]
            for x in tx:
                if x > edge: out[y, x] = src
    return out

def rig(rest=REST):
    parts = build_parts(rest)
    imgs = {k: part_img(rest, m) for k, m in parts.items()}
    # occlusion fills (only where a part can move and expose what is behind it)
    imgs['torso'] = fill_rows(imgs['torso'], parts['head'], range(15, 26), 'left')     # collar behind the head
    imgs['torso'] = fill_rows(imgs['torso'], parts['sleeve_front'], range(28, 47), 'left')  # body behind the front sleeve
    imgs['hem_back'] = fill_rows(imgs['hem_back'], parts['legs'], range(61, 112), 'left')  # back flap behind the trousers
    return parts, imgs

def reconstruct(imgs):
    return composite([imgs[k] for k in Z])

if __name__ == '__main__':
    parts, imgs = rig()
    recon = composite([part_img(REST, parts[k]) for k in Z])
    diff = int((recon != REST).any(-1).sum())
    print('reconstruction diff (raw parts):', diff)
    recon2 = reconstruct(imgs)
    print('reconstruction diff (with fills):', int((recon2 != REST).any(-1).sum()))
    cover = np.zeros((N, N), int)
    for m in parts.values(): cover += m
    print('overlap pixels:', int((cover > 1).sum()), ' uncovered:', int(((cover == 0) & (REST[..., 3] > 0)).sum()))
    for k in Z: print(f'  {k:13s} {int(parts[k].sum()):5d} px  bbox', bbox(imgs[k]))
    # overlay 3x (output px) == 6x native
    COL = {'head': (255, 220, 80), 'torso': (80, 140, 255), 'sleeve_front': (255, 120, 40), 'ledger': (255, 255, 255),
           'hand_front': (255, 60, 60), 'legs': (60, 220, 120), 'hem_front': (200, 80, 255), 'hem_back': (120, 60, 180)}
    ov = np.zeros((N, N, 4), np.uint8)
    for k, m in parts.items(): ov[m] = (*COL[k], 255)
    base = Image.fromarray(up2(REST)).resize((768, 768), Image.NEAREST).convert('RGBA')
    o = Image.fromarray(up2(ov)).resize((768, 768), Image.NEAREST)
    o.putalpha(o.split()[3].point(lambda v: 140 if v else 0))
    bg = Image.new('RGBA', (768, 768), (30, 30, 36, 255)); bg.alpha_composite(base); bg.alpha_composite(o)
    # legend
    from PIL import ImageDraw
    d = ImageDraw.Draw(bg); y = 8
    for k, c in COL.items():
        d.rectangle([8, y, 24, y + 14], fill=(*c, 255)); d.text((30, y), k, fill=(255, 255, 255, 255)); y += 18
    bg.save(f'{OUT}/clerk_rig_overlay.png')
    # fills preview
    Image.fromarray(up2(composite([imgs['torso'], imgs['hem_back']]))).save('fills_preview.png')
