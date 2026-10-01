# victory.py — Dov victory: pixler man-victory.png = fist pounded into the other palm.
# 1 fist up, 2-3 contact, 4 fist up, 5-7 second pound. Non-loop, last frame held.
from common import *

K = load_sheet('victory')
K = [patch_head(f)[0] for f in K]

SEQ = [  # (key, dx, dy, duration)
    ('rest', 0, 0, 90),
    (1, 0, 0, 110),      # fist raised
    (2, 0, 1, 60),       # pound: drops 1 px on contact
    (3, 0, 0, 150),      # hold
    (4, 0, 0, 110),      # raise again
    (6, 0, 1, 60),       # second pound
    (7, 0, 0, 160),      # up, settle
    (7, 0, 0, 220),      # held
]


def build():
    frames = []
    for k, dx, dy, _ in SEQ:
        src = REST if k == 'rest' else K[k]
        f = shift(src, dx, dy) if (dx or dy) else src.copy()
        # a dy shift would push the boots below the ground line: keep rows >= 100 fixed
        if dy:
            f.paste(src.crop((0, 100, W, H)), (0, 100))
        frames.append(f)
    for f in frames:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
        assert f.getbbox()[3] == 120
    assert diff_px(frames[0], REST) == 0
    return frames, [d for *_, d in SEQ]


if __name__ == '__main__':
    fr, dur = build()
    print('frames', len(fr), 'ms', sum(dur))
    save_sheet('victory', fr); save_gif('victory', fr, dur)
    print(contact('victory_out', fr, scale=3, cols=8))
