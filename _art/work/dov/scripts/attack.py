# attack.py — Dov "Strike": pixler keyframes (man-attack.png) as keyframes.
# Sheet: 0-1 rest(noise), 2 weight shift, 3 step+jab, 4-5 deep stance, 6 fist cocked high, 7 punch.
# We: replace 0 with rest, hold the cocked pose (windup), add an anticipation lean, an
# impact snap (+2 px forward), a hold on contact, then recover through 4,3,2 back to rest.
from common import *

K = load_sheet('attack')
K = [patch_head(f)[0] for f in K]        # rest head pasted where the head is unchanged (2 only)

# (key index or 'rest', dx, dy, duration)
SEQ = [
    ('rest', 0, 0, 100),
    (2, 0, 0, 90),       # weight shift
    (3, 0, 0, 110),      # step in
    (6, 0, 0, 180),      # windupFrame: fist cocked high, held for the telegraph
    (6, -1, 1, 50),      # anticipation: lean forward/down 1 px
    (7, -1, 0, 45),      # swing: fist comes down through chest height
    (5, -2, 0, 50),      # impact: fist extended low, overshoot 2 px forward
    (5, 0, 0, 130),      # contact hold
    (4, 0, 0, 110),      # settle
    (3, 0, 0, 110),      # recovery
    (2, 0, 0, 90),
    ('rest', 0, 0, 100),
]
WINDUP = 3
IMPACT = [6]


def build():
    frames = []
    for k, dx, dy, _ in SEQ:
        src = REST if k == 'rest' else K[k]
        f = shift(src, dx, dy) if (dx or dy) else src.copy()
        assert f.getbbox() and f.getbbox()[0] >= 1 and f.getbbox()[2] <= 127, 'clipped'
        frames.append(f)
    for f in frames:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
    assert diff_px(frames[0], REST) == 0 and diff_px(frames[-1], REST) == 0
    return frames, [d for *_, d in SEQ]


if __name__ == '__main__':
    fr, dur = build()
    print('frames', len(fr), 'total ms', sum(dur))
    save_sheet('attack', fr); save_gif('attack', fr, dur)
    print(contact('attack_out', fr, scale=3, cols=7))
