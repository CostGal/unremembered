# death.py — Dov death: pixler man-death.png. 2 stagger, 3 lean, 4 crouch, 5-7 on all fours.
# In-betweens for the two big drops: "squash" = upper body sinks k px, k rows above the
# hem seam are removed (knees bend). Last frame held by the game (holdLastFrame).
from common import *

K = load_sheet('death')
K = [patch_head(f)[0] for f in K]
# ground line = 120: pixler frame 4 floats 3 px, frames 5-7 sink 3 px below
GROUND_FIX = {3: 1, 4: 3, 5: -3, 6: -3, 7: -3}
K = [shift(f, 0, GROUND_FIX.get(i, 0)) if GROUND_FIX.get(i) else f for i, f in enumerate(K)]


def squash(im, seam, k):
    """rows >= seam unchanged; rows < seam copy row r-k (upper body sinks k px)"""
    out = new_frame()
    for r in range(H):
        src = r if r >= seam else r - k
        if src >= 0:
            out.paste(im.crop((0, src, W, src + 1)), (0, r))
    return out


SEQ = [  # (key, squash k, duration)
    ('rest', 0, 80),
    (2, 0, 90),
    (3, 0, 90),
    (3, 4, 90),      # sinks before the crouch
    (4, 0, 110),
    (4, 5, 90),      # sinks further before going down
    (5, 0, 120),
    (6, 0, 140),
    (7, 0, 180),
    (7, 0, 220),     # held
]
SEAM = 100


def build():
    frames = []
    for k, sq, _ in SEQ:
        src = REST if k == 'rest' else K[k]
        frames.append(squash(src, SEAM, sq) if sq else src.copy())
    for f in frames:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
        assert f.getbbox()[3] == 120, 'ground line'
    assert diff_px(frames[0], REST) == 0
    return frames, [d for *_, d in SEQ]


if __name__ == '__main__':
    fr, dur = build()
    print('frames', len(fr), 'ms', sum(dur))
    save_sheet('death', fr); save_gif('death', fr, dur)
    print(contact('death_out', fr, scale=3, cols=5))
