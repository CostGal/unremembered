# anim_archive_charge.py — ARCHIVE charge: ledger raised by the head (overhead_kick f1-5, before the kick),
# glow FX pulsing around the ledger. _in (4) → loop (6) → _out (4); _in last == loop0 == _out first.
from common import *
from rig import REST
import json

O = load_sheet('clerk_overhead_kick')

def ledger_mask(f, x0=34, x1=64, y0=6, y1=54):
    a = f[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    warm = (f[..., 3] > 0) & (r > 95) & (r > b + 25) & ~((r >= 200) & (g >= 120) & (g <= 200) & (b < 160) & (r > b + 60) & (g < 185))  # ledger, not skin
    box = np.zeros((N, N), bool); box[y0:y1+1, x0:x1+1] = True
    return warm & box

def ring(mask, opaque, n=1):
    """n-px ring outside the mask, only on transparent canvas (FX never covers the sprite)."""
    m = mask.copy()
    for _ in range(n):
        d = m.copy()
        d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        m = d
    return m & ~opaque

def glow(f, level, box=(34, 64, 6, 54)):
    """level 0..3: dotted ring → ring → ring + sparkles + white core dots."""
    L = np.zeros((N, N, 4), np.uint8)
    if level == 0: return L
    op = f[..., 3] > 0; lm = ledger_mask(f, *box)
    r1 = ring(lm, op, 1)
    ys, xs = np.where(r1)
    T = (*FX['teal'], 255); Wh = (*FX['white'], 255)
    if level == 1:
        for y, x in zip(ys, xs):
            if (x + y) % 2 == 0: L[y, x] = T
    else:
        L[r1] = T
        if level == 3:
            r2 = ring(lm, op | r1, 1)
            ys2, xs2 = np.where(r2)
            for y, x in zip(ys2, xs2):
                if (x * 7 + y * 3) % 5 == 0: L[y, x] = T
            for y, x in zip(ys, xs):
                if (x * 3 + y) % 7 == 0: L[y, x] = Wh
    return L

def mk(f, level): return composite([f, glow(f, level)])

LOOP0 = mk(O[5], 1)
IN  = [REST, O[1], O[3], LOOP0]
LOOP = [LOOP0, mk(O[5], 2), mk(O[4], 3), mk(O[4], 3), mk(O[5], 2), mk(O[5], 1)]
OUTF = [LOOP0, O[3], O[1], REST]
DUR_IN, DUR_LOOP, DUR_OUT = [90, 100, 110, 120], [150, 150, 150, 150, 150, 150], [120, 110, 100, 90]

if __name__ == '__main__':
    pal = palette_of([REST] + O)
    assert np.array_equal(IN[-1], LOOP[0]) and np.array_equal(OUTF[0], LOOP[0])
    assert np.array_equal(IN[0], REST) and np.array_equal(OUTF[-1], REST)
    for name, fr, d in (('archive_charge_in', IN, DUR_IN), ('archive_charge', LOOP, DUR_LOOP), ("archive_charge_out", OUTF, DUR_OUT)):
        check_frames(fr, pal, name, loop=True)
        for i, f in enumerate(fr): assert ground_row(f) == GROUND, (name, i)
        save_sheet(fr, f'{OUT}/clerk_{name}.png'); save_gif(fr, d, f'{OUT}/clerk_{name}.gif')
        json.dump({'frames': len(fr), 'sheet': f'clerk_{name}.png', 'durations_ms': d, 'loop': name == 'archive_charge'},
                  open(f'{OUT}/_{name}.json', 'w'))
    contact_sheet(IN + LOOP + OUTF, f'{OUT}/clerk_archive_charge_contact.png', scale=1, cols=7)
    print('ok')
