# rig.py — Blank: load sources (flip to face LEFT), part map of the rest pose,
# 4x color-coded overlay, reconstruction diff assertion.
import json, colorsys
import numpy as np
from PIL import Image

SRC = '/mnt/user-data/uploads'
OUT = '/home/claude/blank'
FS = 128
GROUND = 119          # last opaque row (ground line "120" = boundary below it)

def load_sheet(name):
    """Load a pixler sheet, flip every frame horizontally (exact), return list of RGBA arrays."""
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    a = np.array(im)
    n = a.shape[1] // FS
    return [np.ascontiguousarray(a[:, i*FS:(i+1)*FS][:, ::-1]) for i in range(n)]

REST = load_sheet('blank')[0]
SHEETS = {k: load_sheet('blank_' + k) for k in ['idle', 'idle_b', 'punch', 'lunge', 'hurt', 'death']}

# palette = union of all sheets (measured: identical 128 colours everywhere)
def palette():
    cols = set()
    for frs in [[REST]] + list(SHEETS.values()):
        for f in frs:
            op = f[f[..., 3] > 0][:, :3]
            cols |= set(map(tuple, np.unique(op, axis=0)))
    return cols
PAL = palette()

def hsv(px):
    return colorsys.rgb_to_hsv(*(px[:3] / 255.0))

# ---- colour classes (only used inside positional regions) -------------------
def is_skin(p):
    h, s, v = hsv(p); h *= 360
    return v > 0.45 and ((10 <= h <= 50 and s < 0.3) or (320 <= h <= 360 and s < 0.5))
def is_pink(p):
    h, s, v = hsv(p); h *= 360
    return 330 <= h <= 350 and s > 0.5 and v > 0.5
def is_pants(p):
    h, s, v = hsv(p); h *= 360
    return 205 <= h <= 222 and s >= 0.28 and v >= 0.3
def is_dark(p):
    return hsv(p)[2] < 0.22

# part ids and draw order (back → front)
PARTS = ['hem_back', 'boot_back', 'leg_front', 'boot_front',
         'hem_front', 'torso', 'hair', 'head', 'hand_front', 'hand_back']
COLORS = {'hair': (60, 60, 220), 'head': (255, 220, 120), 'torso': (120, 200, 90),
          'hand_back': (255, 60, 60), 'hand_front': (255, 140, 200), 'hem_front': (200, 200, 60),
          'hem_back': (120, 120, 40), 'leg_front': (60, 200, 220), 'leg_back': (20, 120, 160),
          'boot_front': (220, 120, 40), 'boot_back': (140, 70, 20)}

def segment(a):
    """Return label map (strings) for the flipped rest pose."""
    H, W = a.shape[:2]
    lab = np.full((H, W), '', dtype=object)
    for y in range(H):
        for x in range(W):
            p = a[y, x]
            if p[3] == 0: continue
            # --- hands (positional boxes measured on the 10x zoom) ------
            if 66 <= y <= 80 and 66 <= x <= 79 and (is_pink(p) or (0.22 < hsv(p)[2] < 0.42 and hsv(p)[1] < 0.16)):
                lab[y, x] = 'hand_back'; continue
            if 66 <= y <= 78 and 43 <= x <= 50 and (is_pink(p) or (0.22 < hsv(p)[2] < 0.42 and hsv(p)[1] < 0.16)):
                lab[y, x] = 'hand_front'; continue
            # --- head / hair ------------------------------------------
            if y <= 36 and x <= 62:
                if is_skin(p) and y >= 15 and x >= 44:
                    lab[y, x] = 'head'; continue
                if y <= 30 and (is_dark(p) or hsv(p)[0]*360 > 190):
                    lab[y, x] = 'hair'; continue
                if x >= 44 and y >= 15:
                    lab[y, x] = 'head'; continue
                lab[y, x] = 'hair'; continue
            # --- torso (coat upper + shirt + collar + sleeve) --------
            if y <= 61:
                lab[y, x] = 'torso'; continue
            # --- lower body ------------------------------------------
            if y >= 104 and x <= 64:
                lab[y, x] = 'boot_front'; continue
            if y >= 107 and x > 64:
                lab[y, x] = 'boot_back'; continue
            if x <= 46 and y <= 88:
                lab[y, x] = 'hem_front'; continue
            if x <= 64:
                lab[y, x] = 'leg_front'; continue
            lab[y, x] = 'hem_back'
    return lab

def overlay(a, lab, scale=4):
    o = np.zeros((FS, FS, 4), np.uint8)
    for name, col in COLORS.items():
        m = lab == name
        o[m, :3] = col; o[m, 3] = 255
    # blend 50% with art for readability
    art = a.copy()
    mix = ((art[..., :3].astype(int) + o[..., :3].astype(int)) // 2).astype(np.uint8)
    out = np.dstack([mix, a[..., 3]])
    im = Image.fromarray(out).crop((30, 0, 100, FS))
    return im.resize((im.width*scale, im.height*scale), Image.NEAREST)

def reconstruct(a, lab):
    out = np.zeros_like(a)
    for name in PARTS:
        m = lab == name
        out[m] = a[m]
    return out

if __name__ == '__main__':
    lab = segment(REST)
    overlay(REST, lab, 6).save(f'{OUT}/rig_overlay_6x.png')
    rec = reconstruct(REST, lab)
    diff = int((rec != REST).any(-1).sum())
    unl = int(((REST[..., 3] > 0) & (lab == '')).sum())
    print('reconstruction diff px:', diff, ' unlabelled:', unl)
    assert diff == 0 and unl == 0
    stats = {n: int((lab == n).sum()) for n in PARTS}
    print(stats)
    Image.fromarray(REST).save(f'{OUT}/rest_flip.png')
    np.save(f'{OUT}/rest_labels.npy', lab)
