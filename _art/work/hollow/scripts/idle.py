"""Hollow idle v2: derived from rest only (pixler idle frames grow 'legs' -> rejected).
Float bob + hood sway + tendril row-shear wave (1-frame lag) + tendril tip column dip (2-frame lag)."""
from common import *
from rig import REST, part_masks, parts, compose, Z
import math

N = 8
DURS = [200] * N                                 # 1.6 s loop
BOB  = [0, -1, -2, -3, -2, -1, 0, 1]             # whole-frame dy
SWAY = [0, 0, -1, -1, -1, 0, 0, 1]               # hood+mouth dx (leads the body)
WAVE = [BOB[(i - 1) % N] for i in range(N)]      # tendril shear phase, lag 1
WAVE[0] = 0                                      # f0 must equal rest
DIP  = [BOB[(i - 2) % N] for i in range(N)]      # tendril tips vertical, lag 2
DIP[0] = 0
TENDRIL_TOP = 80

def row_shear(f, s, top=TENDRIL_TOP):
    """Integer dx per row along a slow sine down the tendrils; amplitude <= 3 px."""
    if s == 0: return f
    out = f.copy()
    for y in range(top, FW):
        dx = int(round(s * math.sin(math.pi * (y - top) / 40)))
        out[y] = np.roll(f[y], dx, axis=0)
    return out

def column_dip(f, s, top=100):
    """Tendril tips (rows >= top): shift each column segment by an integer dy (-1..1), alternating sign across x
    so neighbouring tendrils dip out of phase. Gap left by a downward shift is filled with the pixel above."""
    if s == 0: return f
    out = f.copy()
    for x in range(FW):
        col = f[top:, x]
        if not (col[..., 3] > 0).any(): continue
        dy = int(round(s / 3 * math.sin(x / 7.0)))
        if dy == 0: continue
        seg = np.zeros_like(col)
        if dy > 0:
            seg[dy:] = col[:-dy]
            seg[:dy] = f[top - 1, x]           # fill with pixel above the segment
        else:
            seg[:dy] = col[-dy:]
        out[top:, x] = seg
    return out

def build():
    P = parts(REST)
    frames = []
    for i in range(N):
        f = compose(P, {'hood': (SWAY[i], 0), 'mouth': (SWAY[i], 0)})
        f = row_shear(f, WAVE[i])
        f = column_dip(f, DIP[i])
        f = np.roll(f, BOB[i], axis=0)
        frames.append(f)
    return frames

if __name__ == '__main__':
    frames = build()
    check(frames, DURS, palette(), rest=REST, loop=True, name='idle')
    assert np.array_equal(frames[0], REST)
    save_png(to_sheet(frames), f'{OUT}/hollow_idle.png')
    save_gif(frames, DURS, f'{OUT}/hollow_idle.gif')
    Image.fromarray(to_sheet(frames)).resize((FW*N*3, FW*3), Image.NEAREST).save('idle_contact3x.png')
    for i, f in enumerate(frames): print(i, bbox(f))
