# hurt.py — Dov hurt: pixler man-hurt.png. 1 flinch, 2-3 lean back, 4-7 staggered back & lower.
# Hit comes from the left (facing left): knockback = integer shift to +x, then recovery to rest.
from common import *

K = load_sheet('hurt')
K = [patch_head(f)[0] for f in K]
GROUND_FIX = {3: 1, 4: -1, 5: -1, 6: -1, 7: -1}   # pin boots to y=120
K = [shift(f, 0, GROUND_FIX[i]) if i in GROUND_FIX else f for i, f in enumerate(K)]

SEQ = [  # (key, dx, duration)
    ('rest', 0, 40),
    (1, 1, 60),       # flinch
    (3, 3, 80),       # lean back
    (5, 4, 90),       # stagger
    (7, 4, 100),      # lowest point
    (4, 2, 80),       # recovery
    (2, 1, 80),
    ('rest', 0, 90),
]


def build():
    frames = []
    for k, dx, _ in SEQ:
        src = REST if k == 'rest' else K[k]
        f = shift(src, dx, 0) if dx else src.copy()
        frames.append(f)
    for f in frames:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
        b = f.getbbox(); assert b[2] <= 127 and b[3] == 120, b
    assert diff_px(frames[0], REST) == 0 and diff_px(frames[-1], REST) == 0
    return frames, [d for *_, d in SEQ]


if __name__ == '__main__':
    fr, dur = build()
    print('frames', len(fr), 'ms', sum(dur))
    save_sheet('hurt', fr); save_gif('hurt', fr, dur)
    print(contact('hurt_out', fr, scale=3, cols=8))
