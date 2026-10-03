"""nala_alert: ears-up pointing pose. loop base = nala_point f8 (one clean keyframe; the pixler f3-15 differ
~150-500 px per step = face noise → not looped as-is). Breathing derived (1 px lift, stretch row 44).
Glow = FX layer only in empty pixels: orange 1-px outline on ears/head (pulses from ears-only to full head)
+ 3 teal motes drifting up. alert_in: rest → paw_lift f3 → paw_lift f5 → loop0. alert_out = reverse (fade glow)."""
import sys; sys.path.insert(0, '/home/claude/nala')
from common import *
from scipy import ndimage

rest = np.array(Image.open(f'{OUT}/work/idle0.png'))
point = load_sheet('nala_point'); pl = load_sheet('nala_paw_lift')
BASE = point[8]
STRETCH = 44

def lift(p, k):
    if k == 0: return p
    out = p.copy(); out[:STRETCH] = 0
    out[:STRETCH - k] = p[k:STRETCH]
    for r in range(STRETCH - k, STRETCH): out[r] = p[STRETCH - 1]
    return out

def outline_fx(sprite, rows_max, x_max, color):
    a = sprite[..., 3] > 0
    ring = ndimage.binary_dilation(a, structure=np.ones((3, 3))) & ~a
    yy, xx = np.mgrid[0:W, 0:W]
    ring &= (yy <= rows_max) & (xx <= x_max)
    fx = np.zeros_like(sprite); fx[ring, :3] = color; fx[ring, 3] = 255
    return fx

MOTES = [(10, 9), (33, 4), (20, 0)]   # (x, y) start, drift up 1 px/frame, 6-frame cycle
def motes(sprite, t, n=3):
    fx = np.zeros_like(sprite)
    for i, (x, y0) in enumerate(MOTES[:n]):
        y = y0 + 6 - ((t + i * 2) % 6)
        if 0 <= y < W and sprite[y, x, 3] == 0:
            fx[y, x, :3] = FX_TEAL; fx[y, x, 3] = 255
    return fx

def glow(sprite, level, t):
    """level 0 none, 1 ears (rows<=10), 2 head (rows<=20)."""
    if level == 0: return np.zeros_like(sprite)
    fx = outline_fx(sprite, 10 if level == 1 else 20, 36, FX_ORANGE)
    return over(fx, motes(sprite, t, 2 if level == 1 else 3))

def frame(base, k, level, t):
    s = lift(base, k)
    return over(s, glow(s, level, t))

# loop: 8 frames ~1.3 s. breathing 0 0 1 1 1 1 0 0, glow pulses ears→head→ears
LOOP_KEYS = [(0, 1), (0, 1), (1, 2), (1, 2), (1, 2), (1, 2), (0, 1), (0, 1)]
LOOP_DUR = [170, 150, 150, 170, 170, 150, 150, 170]
loop = [frame(BASE, k, g, t) for t, (k, g) in enumerate(LOOP_KEYS)]
loop0 = loop[0]
alert_in  = [rest, pl[3], over(pl[5], glow(pl[5], 1, 5)), loop0]
IN_DUR = [80, 90, 90, 120]
alert_out = [loop0, over(pl[5], glow(pl[5], 1, 2)), pl[3], rest]
OUT_DUR = [120, 90, 90, 80]

pal = sheet_palette()
for name, fr, d in [('alert_in', alert_in, IN_DUR), ('alert', loop, LOOP_DUR), ('alert_out', alert_out, OUT_DUR)]:
    check(fr, name, pal, rest if name == 'alert' else None, loop=(name == 'alert'), durations=d)
    save_sheet(fr, f'{OUT}/out/nala_{name}.png'); save_gif(fr, d, f'{OUT}/out/nala_{name}.gif')
assert diff(alert_in[-1], loop0) == 0 and diff(alert_out[0], loop0) == 0
assert diff(alert_in[0], rest) == 0 and diff(alert_out[-1], rest) == 0
contact(alert_in + loop + alert_out, f'{OUT}/work/alert_contact_6x.png', scale=6)
save_gif(alert_in + loop + loop + alert_out, IN_DUR + LOOP_DUR * 2 + OUT_DUR, f'{OUT}/work/alert_full_preview.gif')
json.dump({'alert_in': {'frames': 4, 'sheet': 'nala_alert_in.png', 'durations_ms': IN_DUR, 'loop': False},
           'alert': {'frames': 8, 'sheet': 'nala_alert.png', 'durations_ms': LOOP_DUR, 'loop': True},
           'alert_out': {'frames': 4, 'sheet': 'nala_alert_out.png', 'durations_ms': OUT_DUR, 'loop': False}},
          open(f'{OUT}/work/alert.json', 'w'))
