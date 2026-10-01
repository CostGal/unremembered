# cast.py — Dov "Anchor": pixler man-cast.png keyframes. 1-4 arm raises to extended, 5-7 lowers.
# Loop = keyframe 3 (arm extended) with breathing + amber aura FX LAYER on the fists
# (never a recolor of the sprite). cast_in: rest -> 1 -> 2 -> loop0. cast_out: loop0 -> 4 -> 6 -> rest.
from common import *
from idle import stretch_up, CHEST_SEAM

K = load_sheet('cast')
K = [patch_head(f)[0] for f in K]
AMBER = (0xe0, 0xa0, 0x40, 255); WHITE = (0xf1, 0xef, 0xe8, 255)

# fist boxes in keyframe 3 (x0, y0, x1, y1), inclusive
FISTS = [(18, 35, 28, 47), (49, 36, 61, 48)]


def is_fist(c):
    r, g, b = c[:3]
    return 0x40 <= r <= 0xa0 and (r - b) < 0x40 and (r - g) < 0x28


def aura_outline(fr, boxes, dy=0):
    """1-px amber ring around fist-colored pixels, drawn as an FX layer"""
    fx = new_frame(); p = fr.load(); q = fx.load()
    for x0, y0, x1, y1 in boxes:
        y0 -= dy; y1 -= dy
        F = {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)
             if p[x, y][3] and is_fist(p[x, y])}
        for x, y in F:
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if (nx, ny) not in F and 0 <= nx < W and 0 <= ny < H:
                    q[nx, ny] = AMBER
    return fx


# motes: (x, y_start, period offset, color) rising above the far fist, in empty space only
MOTES = [(16, 34, 0, AMBER), (22, 33, 3, WHITE), (30, 31, 5, AMBER), (12, 40, 6, AMBER)]


def motes(fr, phase, n=8):
    fx = new_frame(); p = fr.load(); q = fx.load()
    for x, y0, off, col in MOTES:
        t = (phase + off) % n
        y = y0 - 2 * t
        if 0 <= y < H and not p[x, y][3]:
            q[x, y] = col
    return fx


BREATH = [0, 0, 1, 1, 1, 1, 0, 0]
LOOP_DUR = [110] * 8
IN_DUR = [90, 90, 90, 100]
OUT_DUR = [100, 90, 90, 80]


def loop_frame(phase):
    k = BREATH[phase]
    base = stretch_up(K[3], CHEST_SEAM, k)
    fr = base.copy()
    fr.alpha_composite(aura_outline(base, FISTS, dy=k))
    fr.alpha_composite(motes(base, phase))
    return fr


def build():
    loop = [loop_frame(i) for i in range(8)]
    cin = [REST.copy(), K[1].copy(), K[2].copy(), loop[0].copy()]
    cout = [loop[0].copy(), K[4].copy(), K[6].copy(), REST.copy()]
    for f in loop + cin + cout:
        assert_frame(f, SHEET_PALETTE); assert components(f) == 1
    assert diff_px(cin[-1], loop[0]) == 0 and diff_px(cout[0], loop[0]) == 0
    assert diff_px(cin[0], REST) == 0 and diff_px(cout[-1], REST) == 0
    return loop, cin, cout


if __name__ == '__main__':
    loop, cin, cout = build()
    save_sheet('cast', loop); save_gif('cast', loop, LOOP_DUR)
    save_sheet('cast_in', cin); save_gif('cast_in', cin, IN_DUR)
    save_sheet('cast_out', cout); save_gif('cast_out', cout, OUT_DUR)
    save_gif('cast_full', cin + loop * 2 + cout, IN_DUR + LOOP_DUR * 2 + OUT_DUR)
    print(contact('cast_out_review', cin + loop + cout, scale=3, cols=8))
