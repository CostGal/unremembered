"""nala_idle: 100% derived from rest (pixler idle/blink/ear/head_dip frames redraw the face with noise → not used).
breathing (1 px torso lift, stretch row 42) + blink (eye covered by lid colours) + near-ear forward flick (row shear)
+ tail-tip lift (column shear). 16 frames, ~2 s, loop, frame 0 = rest."""
import sys; sys.path.insert(0, '/home/claude/nala')
from common import *
from rig import part_masks, cut, body_fill_under

rest = np.array(Image.open(f'{OUT}/work/idle0.png'))
masks = part_masks(rest)
head, paw, tail = cut(rest, masks['head']), cut(rest, masks['paw']), cut(rest, masks['tail'])
body_f = body_fill_under(rest, masks)          # body with fur under tail/paw
STRETCH = 42

def lift_torso(k):
    """head + body rows < STRETCH move up k px; row STRETCH-1 duplicated (vertical outline there)."""
    if k == 0: return head, body_f
    def do(p):
        out = p.copy()
        out[:STRETCH] = 0
        out[:STRETCH - k] = p[k:STRETCH]
        for r in range(STRETCH - k, STRETCH): out[r] = p[STRETCH - 1]
        return out
    return do(head), do(body_f)

# eye: green pixels inside head
EYE = masks['head'] & (rest[..., 1] > 140) & (rest[..., 0] < 140) & (rest[..., 2] < 100)
ey, ex = np.where(EYE); print('eye px', EYE.sum(), 'rows', ey.min(), ey.max(), 'cols', ex.min(), ex.max())

def blink(h, level):
    """level 1 = top eye row covered, 2 = closed. lid colour = pixel directly above the eye column."""
    out = h.copy()
    rows = sorted(set(ey))
    cover = rows[:1] if level == 1 else rows
    for y in cover:
        for x in ex[ey == y]:
            out[y, x] = h[rows[0] - 1, x]
    return out

EAR = masks['head'] & (np.mgrid[0:W, 0:W][0] <= 14) & (np.mgrid[0:W, 0:W][1] >= 19)
def ear_flick(h, amt):
    """near ear tip shears forward (left): rows 8-9 by amt, rows 10-11 by amt//2 (integer)."""
    out = h.copy()
    out[EAR] = 0
    ear = np.zeros_like(h); ear[EAR] = h[EAR]
    for y in range(8, 15):
        d = amt if y <= 11 else 0
        row = np.roll(ear[y], -d, axis=0) if d else ear[y]
        if d: row[W - d:] = 0
        m = row[..., 3] > 0; out[y][m] = row[m]
    return out

def tail_lift(k):
    """tail tip flicks OUT (+x, behind the cat): rows 50-52 shift right k, row 53-54 (tip underside) k-1.
    vacated pixels on the left show body fill (foot/hip fur)."""
    out = np.zeros_like(tail)
    for y in range(50, 55):
        d = k if y <= 52 else max(k - 1, 0)
        out[y] = shift(tail, d, 0)[y]
    return out

def frame(lift, bl, ear, tl):
    h, b = lift_torso(lift)
    if bl: h = blink(h, bl)
    if ear: h = ear_flick(h, ear)
    t = tail_lift(tl)
    f = over(over(over(b, t), paw), h)
    # vacated ground under lifted tail: no fur there → transparent (body_f filled it with paw white)
    return f

#        lift blink ear tail
KEYS = [(0, 0, 0, 0), (0, 0, 0, 0), (0, 0, 1, 0), (0, 0, 1, 0),
        (0, 0, 1, 0), (1, 0, 0, 1), (1, 0, 0, 2), (1, 0, 0, 2),
        (1, 1, 0, 1), (1, 2, 0, 0), (1, 1, 0, 0), (1, 0, 0, 0),
        (0, 0, 0, 0), (0, 0, 0, 1), (0, 0, 0, 2), (0, 0, 0, 1)]
DUR = [160, 120, 90, 110, 90, 120, 130, 130, 90, 110, 90, 130, 140, 110, 130, 110]
frames = [frame(*k) for k in KEYS]
assert diff(frames[0], rest) == 0
os.makedirs(f'{OUT}/out', exist_ok=True)
pal = sheet_palette()
check(frames, 'idle', pal, rest, loop=True, durations=DUR)
save_sheet(frames, f'{OUT}/out/nala_idle.png')
save_gif(frames, DUR, f'{OUT}/out/nala_idle.gif')
contact(frames, f'{OUT}/work/idle_contact_6x.png', scale=6)
json.dump({'idle': {'frames': len(frames), 'sheet': 'nala_idle.png', 'durations_ms': DUR, 'loop': True}},
          open(f'{OUT}/work/idle.json', 'w'))
print('total ms', sum(DUR))
