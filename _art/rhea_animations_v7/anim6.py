"""v6 — slim build (3 px narrower coat) and the baton lives in her RIGHT (far) hand
in every animation, drawn behind the body. Run with RHEA_SLIM=3."""
import os, math
os.environ.setdefault('RHEA_SLIM', '3')
from PIL import Image
import anim, anim2
from anim2 import (blank, put, shifted, shear_rows, teal_arc, body_offsets, draw_leg, legs_image,
                   leg_pose, rotate_about, open_coat_hem, sparkles, PARTS, C, plot, draw_baton)
from anim3 import ik_elbow
from anim4 import rot_pt, tip_from, NECK, HEAD_ROT, DUR
from anim5 import draw_limb, GLOVE_FAR, GLOVE_NEAR

D = int(os.environ['RHEA_SLIM'])
PIV = (73 - 1, 96)                 # hip pivot on the slim body
S_FAR0 = (75 - D, 33)              # right shoulder (behind)
S_NEAR0 = (64, 34)                 # left shoulder (near)
FAR_HAND = (73 - D, 69)            # where the original grey glove sits (rest)
REST_ANGLE = 150                   # baton resting forward-down behind the coat


def rest_baton(dx=0, dy=0, angle=REST_ANGLE):
    b = blank()
    draw_baton(b, (FAR_HAND[0] + dx, FAR_HAND[1] + dy), tip_from((FAR_HAND[0] + dx, FAR_HAND[1] + dy), angle))
    return b


def compose6(offsets, override=None, extra_front=None, extra_back=None, drop=()):
    """compose() with the baton moved behind the body, following the far arm."""
    drop = tuple(drop) + ('baton',)
    bdx, bdy = offsets.get('back_arm', offsets.get('*', (0, 0)))
    eb = [rest_baton(bdx, bdy)] + list(extra_back or [])
    return anim.compose(offsets, override, extra_front, eb, drop)


anim2.compose = compose6           # idle / walk / run / cast / hurt pick this up


# ================================================================== DEATH
def anim_death():
    frames = []
    thetas = [0, 0, 6, 15, 27, 42, 58, 73, 85, 90, 90, 90]
    for i, th in enumerate(thetas):
        s = math.sin(math.radians(th))
        hip = (PIV[0] - round(41 * s) + (2 if i == 1 else 0), PIV[1] + round(7 * s))
        near = None
        if i == 1 or i == 2:
            near = (52, 58)
        elif i == 3:
            near = (48, 50)
        elif i >= 4:
            near = (46, 40)
        extra_front, drop = [], ('legs',)
        if near:
            a = blank(); draw_limb(a, S_NEAR0, near, None, glove=GLOVE_NEAR)
            extra_front, drop = [a], ('legs', 'front_arm')
        eb = [rest_baton()] if i <= 3 else []
        up = anim.compose(body_offsets(0, 0), drop=drop + ('baton',), extra_front=extra_front, extra_back=eb)
        rot = rotate_about(up, th, PIV, hip)
        if i == 0:
            rot = shifted(rot, 2, 0)
        boot_rot = 0 if th < 20 else (30 if th < 45 else (60 if th < 75 else 90))
        fx = hip[0] - 8 - round(14 * s); bx = hip[0] + 3 - round(22 * s)
        ay = 116 - round(6 * s)
        kf = (round((hip[0] + fx) / 2) - 3, round((hip[1] + ay) / 2) - round(6 * s))
        kb = (round((hip[0] + bx) / 2) + 1, round((hip[1] + ay) / 2) - round(3 * s))
        legs = legs_image((hip, kf, (fx, ay)), (hip, kb, (bx, ay)), boot_rot=boot_rot)
        baton = blank()
        flight = {4: ((56, 74), (28, 86)), 5: ((44, 86), (14, 94)), 6: ((30, 100), (6, 106)),
                  7: ((18, 112), (44, 106)), 8: ((14, 118), (46, 114))}
        if i in flight:
            draw_baton(baton, *flight[i])
        elif i >= 9:
            draw_baton(baton, (14, 120), (46, 117))
        f = blank(); put(f, baton); put(f, legs)
        put(f, rot, 0, -2 if i == 9 else 0)
        if i in (9, 10):
            dust = blank()
            pts = [(hip[0] + 30 + k * 9, 118 - (k % 3) * 3 - (2 if i == 10 else 0)) for k in range(6)]
            pts += [(hip[0] - 12 - k * 7, 117 - (k % 2) * 4 - (2 if i == 10 else 0)) for k in range(3)]
            sparkles(dust, pts, col=anim.FX_WHITE if i == 9 else anim.FX_TEAL, plus=(i == 9))
            put(f, dust)
        frames.append(f)
    return frames, [90, 90, 70, 60, 55, 55, 55, 55, 55, 90, 160, 500]


# ================================================================== VICTORY
def anim_victory():
    spec = [  # dy, far hand, baton angle, legs, sparkle
        (2, (76, 48), -20, 'crouch', False),
        (-5, (78, 26), -30, 2, False),
        (-7, (78, 16), -30, 3, True),
        (-3, (78, 18), -32, 0, True),
        (1, (76, 30), -35, 'crouch', False),
        (0, (78, 20), -30, None, True),
    ]
    frames = []
    for i, (dy, hand, ang, lg, spark) in enumerate(spec):
        hand = (hand[0], hand[1] + dy)
        S = (S_FAR0[0], S_FAR0[1] + dy)
        elbow = (S[0] + 9, min(hand[1] + 14, S[1] + 8))
        far = blank(); draw_limb(far, S, hand, tip_from(hand, ang), elbow=elbow, glove=GLOVE_FAR)
        if lg == 'crouch':
            legs = legs_image(leg_pose(-4, 0, bend=2), leg_pose(4, 0, bend=2))
        elif lg is None:
            legs = PARTS['legs']
        else:
            legs = shifted(legs_image(leg_pose(-2, lg + 2), leg_pose(2, lg + 2)), 0, dy)
        hair = shear_rows(PARTS['hair'], 6, 12, lambda y: (1 if i in (1, 2, 3) else 0))
        hairdy = dy - (1 if i in (2, 3, 5) else 0)
        off = body_offsets(0, dy, hair=(0, hairdy), legs=(0, 0),
                           hem=(0, dy + (1 if i in (1, 2) else 0)),
                           bag=(0, dy + (2 if i in (1, 2) else 1 if i == 3 else 0)))
        fx = blank()
        if spark:
            tx, ty = tip_from(hand, ang)
            sparkles(fx, [(tx - 4, ty + 4), (tx - 8, ty - 1), (tx - 1, ty + 9), (tx - 12, ty + 6)], plus=(i == 2))
        frames.append(anim.compose(off, override={'legs': legs, 'hair': hair},
                                   drop=('baton', 'back_arm'), extra_back=[far], extra_front=[fx]))
    return frames, [110, 90, 120, 110, 100, 320]


# ================================================================== ATTACK
F = [
 dict(th=+2, hip=(73, 96), gird=(1, 0), far=((69, 66), None, 150), near=((56, 64), None),
      bag=(1, 0), legs=(-3, 0, 0, 4, 0, 0), hdx=0, trail=-1, hair=0, fx=None),
 dict(th=+5, hip=(74, 97), gird=(2, -1), far=((69, 50), (85, 44), -50), near=((52, 54), None),
      bag=(2, 0), legs=(-2, 1, 1, 5, 0, 0), hdx=0, trail=-2, hair=-1, fx=None),
 dict(th=+7, hip=(75, 97), gird=(3, -1), far=((70, 49), (88, 43), -55), near=((50, 50), None),
      bag=(2, 1), legs=(-2, 2, 1, 5, 0, 0), hdx=1, trail=-2, hair=-1, fx=None),
 dict(th=+4, hip=(71, 96), gird=(2, -2), far=((73, 30), (86, 32), -80), near=((52, 48), None),
      bag=(1, 0), legs=(-6, 0, 2, 5, 1, 15), hdx=0, trail=-1, hair=-1, fx=None),
 dict(th=-2, hip=(69, 95), gird=(1, -3), far=((67, 22), (83, 26), -105), near=((54, 52), None),
      bag=(-1, -1), legs=(-8, 0, 2, 5, 1, 20), hdx=0, trail=1, hair=0, fx='arc1'),
 dict(th=-8, hip=(67, 96), gird=(-3, 0), far=((36, 48), None, 176), near=((62, 70), (70, 54)),
      bag=(-2, 1), legs=(-10, 0, 3, 6, 2, 30), hdx=-2, trail=3, hair=2, fx='arc2'),
 dict(th=-11, hip=(66, 97), gird=(-4, 2), far=((38, 62), None, 160), near=((66, 76), (71, 57)),
      bag=(-3, 2), legs=(-10, 0, 3, 5, 2, 30), hdx=-3, trail=4, hair=3, fx='arc3'),
 dict(th=-12, hip=(65, 98), gird=(-4, 3), far=((44, 70), None, 145), near=((65, 79), (70, 59)),
      bag=(-3, 3), legs=(-9, 0, 3, 3, 1, 20), hdx=-3, trail=4, hair=3, fx=None),
 dict(th=-6, hip=(68, 97), gird=(-1, 1), far=((58, 68), None, 148), near=((60, 72), None),
      bag=(-1, 1), legs=(-6, 0, 2, 4, 0, 0), hdx=-1, trail=2, hair=1, fx=None),
 dict(th=-2, hip=(71, 96), gird=(0, 0), far=((70, 68), None, 150), near=((56, 66), None),
      bag=(0, 0), legs=(-3, 0, 1, 4, 0, 0), hdx=0, trail=0, hair=0, fx=None),
]


def anim_attack():
    frames = []
    prev_trail = 0
    for i, k in enumerate(F):
        th, hip = k['th'], k['hip']
        tr = (hip[0] - PIV[0], hip[1] - PIV[1])
        body_rot = lambda img: rotate_about(img, th, PIV, hip)

        def fx_rot(img):
            return img.rotate(-th, resample=Image.NEAREST, center=PIV, translate=tr) if th else shifted(img, *tr)

        gx, gy = k['gird']
        fh, fe, fw = k['far']
        S_far = (S_FAR0[0] + gx, S_FAR0[1] + gy)
        far = blank()
        if fe is None:
            fe, fh = ik_elbow(S_far, fh, side=-1)
        draw_limb(far, S_far, fh, tip_from(fh, fw), elbow=fe, glove=GLOVE_FAR)
        far = body_rot(far)
        nh, ne = k['near']
        S_near = (S_NEAR0[0] + gx, S_NEAR0[1] + gy)
        near = blank()
        if ne is None:
            ne, nh = ik_elbow(S_near, nh, side=-1)
        draw_limb(near, S_near, nh, None, elbow=ne, glove=GLOVE_NEAR)
        near = body_rot(near)
        sm = blank()
        if k['fx'] == 'arc1':
            teal_arc(sm, (60, 48), 30, 35, -35, -85, step=1.2)
        elif k['fx'] == 'arc2':
            teal_arc(sm, (54, 50), 29, 34, -95, -195, step=1.2)
            teal_arc(sm, (54, 50), 30, 33, -60, -95, white_rim=False, dotted=True, step=2)
        elif k['fx'] == 'arc3':
            teal_arc(sm, (54, 50), 30, 34, -150, -205, white_rim=False, dotted=True, step=2)
        sm = fx_rot(sm)
        body = anim.compose(body_offsets(0, 0, bag=k['bag'], strap=(0, 0)),
                            drop=('legs', 'hem', 'head', 'hair', 'front_arm', 'baton', 'back_arm'))
        body = body_rot(body)
        lag = prev_trail; prev_trail = k['trail']
        hem = shifted(open_coat_hem(front_swing=round(-lag / 3), back_swing=round(lag * 0.6), lift=0), *tr)
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: k['hair'])
        head = anim.compose(body_offsets(0, 0), override={'hair': hair},
                            drop=('legs', 'strap', 'hem', 'torso', 'bag', 'back_arm', 'front_arm', 'baton'))
        nw = rot_pt(NECK, PIV, th)
        nw = (round(nw[0] + tr[0]) + k['hdx'], round(nw[1] + tr[1]))
        head = rotate_about(head, round(th * HEAD_ROT), NECK, nw)
        fdx, flift, fbend, bdx, blift, bheel = k['legs']
        hx = hip[0]; legs = blank(); hip_l = (hx, 90)
        ba = (hx + bdx, 116 - blift); bk = (hx + round(bdx * 0.45) + 1, 104 - round(blift * 0.6))
        draw_leg(legs, hip_l, bk, ba, back=True, boot_rot=-bheel if bheel else 0)
        fa = (hx + fdx, 116 - flift); fk = (hx + round(fdx * 0.45) - fbend - round(flift * 0.9), 104 - round(flift * 0.6))
        draw_leg(legs, hip_l, fk, fa)
        f = blank()
        for layer in (sm, far, legs, hem, body, head, near):
            put(f, layer)
        frames.append(f)
    return frames, DUR


def anim_idle():
    """Idle keeps the ORIGINAL art: baton in the near hand, original pixels."""
    anim2.compose = anim.compose
    try:
        return anim2.anim_idle()
    finally:
        anim2.compose = compose6


if __name__ == '__main__':
    anim2.OUT = 'out6'; os.makedirs('out6', exist_ok=True)
    repl = {'attack': anim_attack, 'death': anim_death, 'victory': anim_victory, 'idle': anim_idle}
    anim2.ANIMS = [(n, repl.get(n, fn)) for n, fn in anim2.ANIMS]
    anim2.main()
    os.rename('out6/rhea_animations_v2.zip', 'out6/rhea_animations_v6.zip')
