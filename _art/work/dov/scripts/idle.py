# idle.py — Dov idle, derived from the rest pose (ART_BRIEF: "heavier, slower breathing").
# Breathing = vertical stretch of the upper body (rows above a seam move up by k, the seam
# row is duplicated k times). No resampling: every output row is a copy of a source row.
# Shoulders get +1 extra with 1-frame lag. Hem and legs never move. One slow blink.
from common import *

CHEST_SEAM = 90      # plain coat rows just above the hem: safe to duplicate
SHOULDER_SEAM = 46   # under the collar / shoulder line

# eye pixels (from the rest dump): pupil (62,18), highlight (63,18)
EYE_OPEN = {(62, 18), (63, 18)}
EYE_CLOSED = {(62, 18): (0xec, 0xb9, 0x94), (63, 18): (0xea, 0xb6, 0x92),
              (62, 19): (0x09, 0x05, 0x04), (63, 19): (0x09, 0x05, 0x04)}


def stretch_up(im, seam, k):
    """rows < seam-k copy row r+k; rows seam-k..seam-1 duplicate row seam-1; rest unchanged"""
    if k == 0:
        return im.copy()
    out = new_frame()
    for r in range(H):
        src = r + k if r < seam - k else (seam - 1 if r < seam else r)
        out.paste(im.crop((0, src, W, src + 1)), (0, r))
    return out


def blink(im):
    out = im.copy(); p = out.load()
    for (x, y), c in EYE_CLOSED.items():
        p[x, y] = c + (255,)
    return out


def breathe(k_chest, k_shoulder, closed=False):
    fr = stretch_up(REST, CHEST_SEAM, k_chest)
    fr = stretch_up(fr, SHOULDER_SEAM - k_chest, k_shoulder)
    return blink(fr) if closed else fr


CHEST    = [0, 1, 2, 2, 1, 0, 0, 0]
SHOULDER = [0, 0, 1, 1, 1, 0, 0, 0]
BLINK    = [0, 0, 0, 0, 0, 1, 0, 0]
DURATIONS = [200, 180, 180, 200, 180, 90, 200, 270]   # 1.5 s, slow-fast-slow


def build():
    frames = [breathe(c, s, b) for c, s, b in zip(CHEST, SHOULDER, BLINK)]
    assert diff_px(frames[0], REST) == 0
    for f in frames:
        assert_frame(f); assert components(f) == 1
    return frames


if __name__ == '__main__':
    fr = build()
    save_sheet('idle', fr); save_gif('idle', fr, DURATIONS)
    print(contact('idle_out', fr, scale=4, cols=8))
