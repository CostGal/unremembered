# brace_parry.py — Dov "Brace" (guard loop + in/out) and "parry" (guard hold -> block -> shove -> rest).
# man-brace.png: 1 fists raise, 2 forward, 3-4 boxer guard (crouched), 5 lowering, 6-7 rest.
# man-parry.png: 1-2 arms spread, 3-7 wide sweep. The parry holdFrame is pixel-identical to
# brace loop frame 0 (ANIMATION.md §8) so the game can switch without a cut.
from common import *
from idle import stretch_up, CHEST_SEAM

B = [patch_head(f)[0] for f in load_sheet('brace')]
P = [patch_head(f)[0] for f in load_sheet('parry')]
AMBER = (0xe0, 0xa0, 0x40, 255); WHITE = (0xf1, 0xef, 0xe8, 255)

GUARD = B[3]

# ---- brace loop: guard with breathing (1 px), 8 x 110 ms
BRACE_KEYS = [(3, 0), (3, 0), (3, 1), (4, 1), (4, 0), (4, 0), (4, 1), (3, 1)]
BRACE_DUR = [110] * 8
IN_DUR = [80, 90, 100, 100]
OUT_DUR = [100, 90, 90, 80]


def brace_loop():
    return [stretch_up(B[k], CHEST_SEAM, s) if s else B[k].copy() for k, s in BRACE_KEYS]


# ---- block sparks: white core + amber, just left of the leading fist (empty pixels only)
def sparks(fr, rows=(38, 62), phase=0):
    fx = new_frame(); p = fr.load(); q = fx.load()
    # leftmost opaque pixel in the fist rows = the leading fist edge
    edge = min((x for y in range(*rows) for x in range(W) if p[x, y][3]), default=None)
    ey = min(range(*rows), key=lambda y: next((x for x in range(W) if p[x, y][3]), W))
    if edge is None:
        return fx
    pts = [(-2, 0, WHITE), (-3, -2, AMBER), (-4, 2, AMBER), (-1, -3, WHITE), (-2, 4, AMBER), (-5, -1, WHITE)]
    if phase:
        pts = [(dx - 2, dy * 2, c) for dx, dy, c in pts]
    for dx, dy, c in pts:
        x, y = edge + dx, ey + dy
        if 0 <= x < W and 0 <= y < H and not p[x, y][3]:
            q[x, y] = c
    return fx


PARRY_SEQ = [  # (source, dx, sparks phase or None, duration)
    (REST, 0, None, 80),
    (B[2], 0, None, 90),
    (GUARD, 0, None, 150),    # holdFrame: guard, waits for the enemy hit
    (B[4], 2, 0, 50),         # impact: block, recoil 2 px, sparks
    (B[4], 1, 1, 70),         # sparks fly off
    (P[3], 0, None, 100),     # shove: arms sweep out
    (P[2], 0, None, 100),
    (B[6], 0, None, 90),
    (REST, 0, None, 80),
]
PARRY_HOLD = 2
PARRY_IMPACT = [3]


def parry():
    frames = []
    for src, dx, ph, _ in PARRY_SEQ:
        f = shift(src, dx, 0) if dx else src.copy()
        if ph is not None:
            f.alpha_composite(sparks(f, phase=ph))
        frames.append(f)
    return frames, [d for *_, d in PARRY_SEQ]


def build():
    loop = brace_loop()
    bin_ = [REST.copy(), B[1].copy(), B[2].copy(), loop[0].copy()]
    bout = [loop[0].copy(), B[5].copy(), B[6].copy(), REST.copy()]
    pf, pd = parry()
    for f in loop + bin_ + bout + pf:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
        assert f.getbbox()[3] == 120
    assert diff_px(bin_[-1], loop[0]) == 0 and diff_px(bout[0], loop[0]) == 0
    assert diff_px(pf[PARRY_HOLD], loop[0]) == 0, 'parry hold != brace loop0'
    assert diff_px(pf[0], REST) == 0 and diff_px(pf[-1], REST) == 0
    return loop, bin_, bout, pf, pd


if __name__ == '__main__':
    loop, bin_, bout, pf, pd = build()
    save_sheet('brace', loop); save_gif('brace', loop, BRACE_DUR)
    save_sheet('brace_in', bin_); save_gif('brace_in', bin_, IN_DUR)
    save_sheet('brace_out', bout); save_gif('brace_out', bout, OUT_DUR)
    save_gif('brace_full', bin_ + loop * 2 + bout, IN_DUR + BRACE_DUR * 2 + OUT_DUR)
    save_sheet('parry', pf); save_gif('parry', pf, pd)
    print('parry', len(pf), sum(pd))
    print(contact('parry_out', pf, scale=3, cols=9))
    print(contact('brace_out_review', bin_ + loop + bout, scale=3, cols=8))
