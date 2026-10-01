"""Attack v5 — the strike is thrown by the far (right) arm, drawn BEHIND the body so
the shoulder joint is hidden by the torso; the near (left) arm counter-balances in
front; the coat hangs from the waist and swings as cloth instead of rotating with
the torso."""
import os, math
from PIL import Image
import anim2
from anim2 import (blank, put, shifted, shear_rows, teal_arc, compose, body_offsets,
                   draw_leg, rotate_about, open_coat_hem, PARTS, C, plot, thick_line, draw_baton)
from anim3 import ik_elbow
from anim4 import rot_pt, tip_from, PIV, NECK, HEAD_ROT, DUR

S_FAR0 = (75, 33)     # right shoulder (far side) — sits behind the torso mid-line
S_NEAR0 = (64, 34)    # left shoulder (near side)
GLOVE_FAR = dict(fill=(125, 124, 137), edge=(11, 4, 37), hi=(133, 131, 149))
GLOVE_NEAR = dict(fill=C['glove'], edge=C['glove_dark'], hi=C['glove_hi'])
for g in (GLOVE_FAR, GLOVE_NEAR):
    for v in g.values():
        assert v in anim2.ALLOWED


def draw_limb(img, shoulder, hand, tip=None, elbow=None, side=-1, glove=GLOVE_NEAR, w=5):
    if elbow is None:
        elbow, hand = ik_elbow(shoulder, hand, side)
    p = img.load()
    for a, b in ((shoulder, elbow), (elbow, hand)):
        thick_line(p, a, b, w + 2, C['coat_out'])
    for a, b in ((shoulder, elbow), (elbow, hand)):
        thick_line(p, a, b, w, C['coat'])
    for a, b in ((shoulder, elbow), (elbow, hand)):
        (x0, y0), (x1, y1) = a, b
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            cx = x0 + round((x1 - x0) * i / n); cy = y0 + round((y1 - y0) * i / n)
            if abs(y1 - y0) >= abs(x1 - x0):
                plot(p, cx + w // 2 - 1, cy, C['coat_dark'])
            else:
                plot(p, cx, cy + w // 2 - 1, C['coat_dark'])
    ex, ey = elbow
    for k in (-1, 0, 1):
        plot(p, ex + k, ey + 1, C['coat_dark'])
    plot(p, ex, ey, C['coat_deep'])
    hx, hy = hand
    for yy in range(-3, 3):
        for xx in range(-3, 3):
            if abs(xx + 0.5) + abs(yy + 0.5) <= 4.2:
                edge = abs(xx + 0.5) + abs(yy + 0.5) > 3.0
                plot(p, hx + xx, hy + yy, glove['edge'] if edge else glove['fill'])
    plot(p, hx - 1, hy - 1, glove['hi'])
    if tip:
        draw_baton(img, hand, tip)
    return elbow, hand


# ------------------------------------------------------------- frame table
# far (striking) arm: shoulder offset from S_FAR0, hand, explicit elbow or None (IK), wrist angle
# near arm: hand, explicit elbow or None
F = [
 dict(th=+2, hip=(74, 96), gird=(1, 0), far=((66, 62), None, 118), near=((56, 64), None),
      bag=(1, 0), legs=(-3, 0, 0, 4, 0, 0), hdx=0, trail=-1, hair=0, fx=None),
 dict(th=+5, hip=(75, 97), gird=(2, -1), far=((72, 50), (88, 44), -50), near=((52, 54), None),
      bag=(2, 0), legs=(-2, 1, 1, 5, 0, 0), hdx=0, trail=-2, hair=-1, fx=None),
 dict(th=+7, hip=(76, 97), gird=(3, -1), far=((73, 49), (91, 43), -55), near=((50, 50), None),
      bag=(2, 1), legs=(-2, 2, 1, 5, 0, 0), hdx=1, trail=-2, hair=-1, fx=None),
 dict(th=+4, hip=(72, 96), gird=(2, -2), far=((76, 30), (89, 32), -80), near=((52, 48), None),
      bag=(1, 0), legs=(-6, 0, 2, 5, 1, 15), hdx=0, trail=-1, hair=-1, fx=None),
 dict(th=-2, hip=(70, 95), gird=(1, -3), far=((70, 22), (86, 26), -105), near=((54, 52), None),
      bag=(-1, -1), legs=(-8, 0, 2, 5, 1, 20), hdx=0, trail=1, hair=0, fx='arc1'),
 dict(th=-8, hip=(68, 96), gird=(-3, 0), far=((38, 48), None, 176), near=((64, 70), (72, 54)),
      bag=(-2, 1), legs=(-10, 0, 3, 6, 2, 30), hdx=-2, trail=3, hair=2, fx='arc2'),
 dict(th=-11, hip=(67, 97), gird=(-4, 2), far=((40, 62), None, 160), near=((68, 76), (73, 57)),
      bag=(-3, 2), legs=(-10, 0, 3, 5, 2, 30), hdx=-3, trail=4, hair=3, fx='arc3'),
 dict(th=-12, hip=(66, 98), gird=(-4, 3), far=((46, 70), None, 145), near=((67, 79), (72, 59)),
      bag=(-3, 3), legs=(-9, 0, 3, 3, 1, 20), hdx=-3, trail=4, hair=3, fx=None),
 dict(th=-6, hip=(69, 97), gird=(-1, 1), far=((58, 66), None, 132), near=((60, 72), None),
      bag=(-1, 1), legs=(-6, 0, 2, 4, 0, 0), hdx=-1, trail=2, hair=1, fx=None),
 dict(th=-2, hip=(72, 96), gird=(0, 0), far=((64, 66), None, 124), near=((56, 66), None),
      bag=(0, 0), legs=(-3, 0, 1, 4, 0, 0), hdx=0, trail=0, hair=0, fx=None),
]


def anim_attack():
    frames = []
    prev_trail = 0
    for i, k in enumerate(F):
        th, hip = k['th'], k['hip']
        tr = (hip[0] - PIV[0], hip[1] - PIV[1])

        def body_rot(img):
            return rotate_about(img, th, PIV, hip)

        def fx_rot(img):
            if th:
                return img.rotate(-th, resample=Image.NEAREST, center=PIV, translate=tr)
            return shifted(img, *tr)

        gx, gy = k['gird']
        # ---- far (right) arm with baton: behind the body
        (fh, fe, fw) = k['far']
        S_far = (S_FAR0[0] + gx, S_FAR0[1] + gy)
        far = blank()
        if fe is None:
            fe, fh = ik_elbow(S_far, fh, side=-1)
        tip = tip_from(fh, fw)
        draw_limb(far, S_far, fh, tip, elbow=fe, glove=GLOVE_FAR)
        far = body_rot(far)
        # ---- near (left) arm: in front, counter-swings
        (nh, ne) = k['near']
        S_near = (S_NEAR0[0] + gx, S_NEAR0[1] + gy)
        near = blank()
        if ne is None:
            ne, nh = ik_elbow(S_near, nh, side=-1)
        draw_limb(near, S_near, nh, None, elbow=ne, glove=GLOVE_NEAR)
        near = body_rot(near)
        # ---- smear, body space
        sm = blank()
        if k['fx'] == 'arc1':
            teal_arc(sm, (62, 48), 30, 35, -35, -85, step=1.2)
        elif k['fx'] == 'arc2':
            teal_arc(sm, (56, 50), 29, 34, -95, -195, step=1.2)
            teal_arc(sm, (56, 50), 30, 33, -60, -95, white_rim=False, dotted=True, step=2)
        elif k['fx'] == 'arc3':
            teal_arc(sm, (56, 50), 30, 34, -150, -205, white_rim=False, dotted=True, step=2)
        sm = fx_rot(sm)
        # ---- torso block (no hem, no arms, no head)
        off = body_offsets(0, 0, bag=k['bag'], strap=(0, 0))
        body = compose(off, drop=('legs', 'hem', 'head', 'hair', 'front_arm', 'baton', 'back_arm'))
        body = body_rot(body)
        # ---- coat: hangs from the waist, follows the hips, swings with one frame of lag
        lag = prev_trail; prev_trail = k['trail']
        hem = open_coat_hem(front_swing=round(-lag / 2), back_swing=round(lag), lift=0)
        hem = shifted(hem, tr[0], tr[1])
        # ---- head on the neck, counter-rotated
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: k['hair'])
        head = compose(body_offsets(0, 0), override={'hair': hair},
                       drop=('legs', 'strap', 'hem', 'torso', 'bag', 'back_arm', 'front_arm', 'baton'))
        nw = rot_pt(NECK, PIV, th)
        nw = (round(nw[0] + tr[0]) + k['hdx'], round(nw[1] + tr[1]))
        head = rotate_about(head, round(th * HEAD_ROT), NECK, nw)
        # ---- legs
        fdx, flift, fbend, bdx, blift, bheel = k['legs']
        hx = hip[0]; legs = blank(); hip_l = (hx, 90)
        ba = (hx + bdx, 116 - blift); bk = (hx + round(bdx * 0.45) + 1, 104 - round(blift * 0.6))
        draw_leg(legs, hip_l, bk, ba, back=True, boot_rot=-bheel if bheel else 0)
        fa = (hx + fdx, 116 - flift); fk = (hx + round(fdx * 0.45) - fbend - round(flift * 0.9), 104 - round(flift * 0.6))
        draw_leg(legs, hip_l, fk, fa)
        # ---- assemble: smear, far arm, legs, coat, torso, head, near arm
        f = blank()
        for layer in (sm, far, legs, hem, body, head, near):
            put(f, layer)
        frames.append(f)
    return frames, DUR


if __name__ == '__main__':
    anim2.OUT = 'out5'; os.makedirs('out5', exist_ok=True)
    anim2.ANIMS = [(n, anim_attack if n == 'attack' else fn) for n, fn in anim2.ANIMS]
    anim2.main()
    os.rename('out5/rhea_animations_v2.zip', 'out5/rhea_animations_v5.zip')
