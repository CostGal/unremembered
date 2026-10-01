"""Hollow claw: windup keyframes from hollow_windup (mouth opens, f2 held = windupFrame),
strike keyframes from hollow_claw f1-f4 (tendrils whip) with a -x lunge, teal slash FX on impact,
return via hollow_claw f7, last = rest. ~0.95 s."""
from common import *
from rig import REST
import math

W = load_sheet('hollow_windup.png')
C = load_sheet('hollow_claw.png')

# (source frame, dx lunge, dy)   -- facing LEFT: lunge = -x
SEQ = [
    (REST, 0, 0),     # 0 rest
    (W[1], 0, 0),     # 1 mouth opening
    (W[2], 0, 0),     # 2 mouth wide  = windupFrame (held telegraph)
    (W[3], 1, 0),     # 3 mouth wide, tendrils gather back (tiny recoil +x)
    (C[1], -2, 0),    # 4 front tendril flicks out (anticipation)
    (C[2], -5, -1),   # 5 tendrils sweep up
    (C[3], -8, -1),   # 6 IMPACT: tendrils fanned, full lunge
    (C[4], -6, 0),    # 7 follow-through
    (C[7], -2, 0),    # 8 settle
    (REST, 0, 0),     # 9 rest
]
DURS = [90, 100, 160, 90, 70, 50, 45, 70, 110, 160]
WINDUP, IMPACT = 2, 6

def slash_fx(f, cx, cy, strength):
    """Three bold teal claw arcs bulging toward -x in front of the body (x ~4-19, y ~31-73).
    FX layer: only on transparent px, never despeckled. strength 2 = solid 2px, 1 = dotted remnant."""
    out = f.copy()
    for r in (22, 26, 30):
        step = 2 if strength == 2 else 9
        for d in range(-45, 46, step):
            a = math.radians(d)
            x = int(round(cx - r * math.cos(a))); y = int(round(cy + r * math.sin(a)))
            for xx in ((x, x + 1) if strength == 2 else (x - 2,)):
                if 1 <= xx <= 126 and 1 <= y <= 126 and f[y, xx, 3] == 0:
                    out[y, xx] = (*FX, 255)
    return out

def build():
    frames = []
    for i, (src, dx, dy) in enumerate(SEQ):
        f = np.roll(src, (dy, dx), axis=(0, 1))
        if i == IMPACT: f = slash_fx(f, 34, 52, 2)
        if i == IMPACT + 1: f = slash_fx(f, 32, 52, 1)   # dotted remnant
        frames.append(f)
    return frames

if __name__ == '__main__':
    frames = build()
    check(frames, DURS, palette(), rest=REST, name='claw')
    save_png(to_sheet(frames), f'{OUT}/hollow_claw.png')
    save_gif(frames, DURS, f'{OUT}/hollow_claw.gif')
    Image.fromarray(to_sheet(frames)).resize((FW*len(frames)*3, FW*3), Image.NEAREST).save('claw_contact3x.png')
    for i, f in enumerate(frames): print(i, bbox(f))
