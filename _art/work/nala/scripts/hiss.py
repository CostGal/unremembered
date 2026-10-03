"""nala_hiss: rest → hiss f2 (ears pinning back, paw rising) → hiss f3/f4 held (hiss pose = the cancel-attack moment,
holdFrame) → swipe f3 (body drops forward) → swipe f4 impact (+ spark FX at the paw) → swipe f6 (recover) → hiss f7 → rest.
pixler swipe f3-7 reach y 56-57 (tail tip): the tail columns (x>=44, rows>=46) are shifted up so the ground stays row 55."""
import sys; sys.path.insert(0, '/home/claude/nala')
from common import *

rest = np.array(Image.open(f'{OUT}/work/idle0.png'))
hs = load_sheet('nala_hiss'); sw = load_sheet('nala_swipe')

def pin_ground(f):
    ymax = int(bbox(f)[3]); k = ymax - GROUND
    if k <= 0: return f
    out = f.copy()
    out[46:, 44:] = 0
    out[46:W - k, 44:] = f[46 + k:, 44:]
    return out

def spark(f, size):
    """orange cross + teal corners in front of the paw tip, empty pixels only. size 2 = impact, 1 = after."""
    a = f[..., 3] > 0
    ys, xs = np.where(a[14:40, :22]); tip_x = int(xs.min()); tip_y = int(np.median(ys[xs <= tip_x + 2])) + 14
    cx, cy = tip_x - 3, tip_y
    pts = []
    if size == 2:
        pts += [((cx + dx, cy), FX_ORANGE) for dx in (-2, -1, 0, 1, 2)] + [((cx, cy + dy), FX_ORANGE) for dy in (-2, -1, 1, 2)]
        pts += [((cx + dx, cy + dy), FX_TEAL) for dx in (-2, 2) for dy in (-2, 2)]
    else:
        pts += [((cx - 1, cy - 2), FX_ORANGE), ((cx + 1, cy + 2), FX_ORANGE), ((cx - 3, cy), FX_TEAL), ((cx, cy - 4), FX_TEAL)]
    fx = np.zeros_like(f)
    for (x, y), c in pts:
        if 0 <= x < W and 0 <= y < W and not a[y, x]:
            fx[y, x, :3] = c; fx[y, x, 3] = 255
    return over(f, fx)

imp = pin_ground(sw[4])
frames = [rest, hs[2], hs[3], hs[4], pin_ground(sw[3]), spark(imp, 2), spark(pin_ground(sw[6]), 1), hs[7], rest]
DUR = [70, 70, 110, 110, 50, 60, 80, 80, 70]
pal = sheet_palette()
check(frames, 'hiss', pal, rest, durations=DUR)
save_sheet(frames, f'{OUT}/out/nala_hiss.png'); save_gif(frames, DUR, f'{OUT}/out/nala_hiss.gif')
contact(frames, f'{OUT}/work/hiss_contact_6x.png', scale=6)
json.dump({'hiss': {'frames': len(frames), 'sheet': 'nala_hiss.png', 'durations_ms': DUR, 'loop': False,
                    'holdFrame': 3, 'impactFrames': [5]}}, open(f'{OUT}/work/hiss.json', 'w'))
print('total', sum(DUR))
