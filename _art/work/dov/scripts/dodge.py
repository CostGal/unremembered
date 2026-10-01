# dodge.py — Dov dodge: pixler man-dodge.png = hop back. 1 lean, 2-3 step, 4 crouch, 5 airborne,
# 6-7 landing. Backward travel = integer +x shift; holdFrame = airborne (the enemy hit misses).
from common import *

K = [patch_head(f)[0] for f in load_sheet('dodge')]
GROUND_FIX = {1: 1, 4: 1, 6: 3, 7: 2}          # pin grounded frames to y=120; 5 stays airborne
K = [shift(f, 0, GROUND_FIX[i]) if i in GROUND_FIX else f for i, f in enumerate(K)]

SEQ = [  # (key, dx, duration)
    ('rest', 0, 60),
    (1, 0, 50),        # lean
    (3, 2, 60),        # step back
    (4, 4, 70),        # crouch, push off
    (5, 6, 140),       # airborne: holdFrame
    (6, 6, 80),        # land
    (7, 5, 80),        # settle
    (3, 2, 70),        # step back in
    ('rest', 0, 80),
]
HOLD = 4


def build():
    frames = []
    for k, dx, _ in SEQ:
        src = REST if k == 'rest' else K[k]
        frames.append(shift(src, dx, 0) if dx else src.copy())
    for i, f in enumerate(frames):
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
        b = f.getbbox(); assert b[2] <= 127 and (b[3] == 120 or i == HOLD), (i, b)
    assert diff_px(frames[0], REST) == 0 and diff_px(frames[-1], REST) == 0
    return frames, [d for *_, d in SEQ]


if __name__ == '__main__':
    fr, dur = build()
    print('frames', len(fr), 'ms', sum(dur))
    save_sheet('dodge', fr); save_gif('dodge', fr, dur)
    print(contact('dodge_out', fr, scale=3, cols=9))
