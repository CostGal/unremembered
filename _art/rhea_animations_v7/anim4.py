"""Attack v4 — a 10-frame one-handed baton strike built on the kinetic chain:
hips lead, torso follows, shoulder girdle retracts/protracts, elbow unfolds last,
wrist cocks and releases; head counter-rotates to stay on target."""
import os, math
from PIL import Image
import anim2
from anim2 import (blank, put, shifted, shear_rows, teal_arc, compose, body_offsets,
                   draw_leg, rotate_about, PARTS, C, plot)
from anim3 import draw_arm2, ik_elbow

PIV = (73, 96)        # hip pivot (greater trochanter, side view)
NECK = (68, 24)       # C7/T1 — where the head pivots on the torso
S0 = (69, 34)         # glenohumeral joint at rest
BATON = 33
HEAD_ROT = 0.4        # head follows only ~40% of the torso lean (vestibular stabilisation)


def rot_pt(pt, pivot, cw_deg):
    r = math.radians(cw_deg)
    dx, dy = pt[0] - pivot[0], pt[1] - pivot[1]
    return (pivot[0] + dx * math.cos(r) - dy * math.sin(r),
            pivot[1] + dx * math.sin(r) + dy * math.cos(r))


def tip_from(hand, angle_deg):
    r = math.radians(angle_deg)
    return (round(hand[0] + BATON * math.cos(r)), round(hand[1] + BATON * math.sin(r)))


# frame table ------------------------------------------------------------
# th: torso lean (cw +, i.e. back).  hip: pelvis position.  S: shoulder joint (girdle shift)
# hand / elbow: body-space.  wrist: baton angle (deg, 0 = right, -90 = up).
# bag, back_arm: (dx,dy).  legs: (front dx, front lift, front bend, back dx, back lift, back heel rot)
# hdx: head lead.  trail: hem shear.  hair: hair drag.  fx: smear stage.  behind: arm behind head.
F = [
 dict(th=+2, hip=(74, 96), S=(70, 34), hand=(60, 58), elbow=None, wrist=112, bag=(1, 0), back_arm=(1, 0),
      legs=(-3, 0, 0, 4, 0, 0), hdx=0, trail=-1, hair=0, fx=None, behind=False),
 dict(th=+5, hip=(75, 97), S=(71, 33), hand=(66, 50), elbow=(82, 44), wrist=-50, bag=(2, 0), back_arm=(-2, 0),
      legs=(-2, 1, 1, 5, 0, 0), hdx=0, trail=-2, hair=-1, fx=None, behind=False),
 dict(th=+7, hip=(76, 97), S=(72, 33), hand=(67, 49), elbow=(85, 43), wrist=-55, bag=(2, 1), back_arm=(-3, 0),
      legs=(-2, 2, 1, 5, 0, 0), hdx=1, trail=-2, hair=-1, fx=None, behind=False),
 dict(th=+4, hip=(72, 96), S=(71, 32), hand=(70, 30), elbow=(83, 32), wrist=-80, bag=(1, 0), back_arm=(-2, 0),
      legs=(-6, 0, 2, 5, 1, 15), hdx=0, trail=-1, hair=-1, fx=None, behind=False),
 dict(th=-2, hip=(70, 95), S=(70, 31), hand=(64, 22), elbow=(80, 26), wrist=-105, bag=(-1, -1), back_arm=(0, 0),
      legs=(-8, 0, 2, 5, 1, 20), hdx=0, trail=1, hair=0, fx='arc1', behind=True),
 dict(th=-8, hip=(68, 96), S=(66, 34), hand=(36, 48), elbow=None, wrist=176, bag=(-2, 1), back_arm=(2, 0),
      legs=(-10, 0, 3, 6, 2, 30), hdx=-2, trail=3, hair=2, fx='arc2', behind=False),
 dict(th=-11, hip=(67, 97), S=(65, 36), hand=(40, 62), elbow=None, wrist=160, bag=(-3, 2), back_arm=(3, 0),
      legs=(-10, 0, 3, 5, 2, 30), hdx=-3, trail=4, hair=3, fx='arc3', behind=False),
 dict(th=-12, hip=(66, 98), S=(65, 37), hand=(44, 70), elbow=None, wrist=145, bag=(-3, 3), back_arm=(3, 1),
      legs=(-9, 0, 3, 3, 1, 20), hdx=-3, trail=4, hair=3, fx=None, behind=False),
 dict(th=-6, hip=(69, 97), S=(68, 35), hand=(52, 66), elbow=None, wrist=132, bag=(-1, 1), back_arm=(1, 0),
      legs=(-6, 0, 2, 4, 0, 0), hdx=-1, trail=2, hair=1, fx=None, behind=False),
 dict(th=-2, hip=(72, 96), S=(69, 34), hand=(55, 67), elbow=None, wrist=128, bag=(0, 0), back_arm=(0, 0),
      legs=(-3, 0, 1, 4, 0, 0), hdx=0, trail=0, hair=0, fx=None, behind=False),
]
DUR = [90, 70, 60, 50, 45, 55, 70, 90, 110, 150]


def anim_attack():
    frames = []
    for i, k in enumerate(F):
        th, hip = k['th'], k['hip']
        # ---- torso block (strap, hem, torso, bag, far arm) in body space
        hem = shear_rows(PARTS['hem'], 88, 103, lambda y: round(k['trail'] * (y - 88) / 15))
        off = body_offsets(0, 0, hem=(0, 0), bag=k['bag'], back_arm=k['back_arm'], strap=(0, 0))
        # smear in body space, behind everything
        sm = blank()
        if k['fx'] == 'arc1':
            teal_arc(sm, (62, 48), 30, 35, -35, -85, step=1.2)
        elif k['fx'] == 'arc2':
            teal_arc(sm, (56, 50), 29, 34, -95, -195, step=1.2)
            teal_arc(sm, (56, 50), 30, 33, -60, -95, white_rim=False, dotted=True, step=2)
        elif k['fx'] == 'arc3':
            teal_arc(sm, (56, 50), 30, 34, -150, -205, white_rim=False, dotted=True, step=2)
        # near arm: shoulder -> elbow -> hand; elbow never locks (reach clamped in IK)
        arm = blank()
        hand = k['hand']
        if k['elbow'] is None:
            elbow, hand = ik_elbow(k['S'], hand, side=-1)   # elbow sits below/behind the shoulder-hand line
        else:
            elbow = k['elbow']
        tip = tip_from(hand, k['wrist'])
        draw_arm2(arm, k['S'], hand, tip, elbow=elbow)
        body = compose(off, override={'hem': hem}, drop=('legs', 'head', 'hair', 'front_arm', 'baton'),
                       extra_front=[arm])
        body = rotate_about(body, th, PIV, hip)
        if th:
            sm = sm.rotate(-th, resample=Image.NEAREST, center=PIV, translate=(hip[0] - PIV[0], hip[1] - PIV[1]))
        else:
            sm = shifted(sm, hip[0] - PIV[0], hip[1] - PIV[1])
        # ---- head: pivots on the neck, counter-rotates to stay on target, leads slightly
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: k['hair'])
        head = compose(body_offsets(0, 0), override={'hair': hair},
                       drop=('legs', 'strap', 'hem', 'torso', 'bag', 'back_arm', 'front_arm', 'baton'))
        neck_w = rot_pt(NECK, PIV, th)
        neck_w = (round(neck_w[0] + hip[0] - PIV[0]) + k['hdx'], round(neck_w[1] + hip[1] - PIV[1]))
        head = rotate_about(head, round(th * HEAD_ROT), NECK, neck_w)
        # ---- legs: weight transfer, front knee bends into the lunge, back heel rises
        fdx, flift, fbend, bdx, blift, bheel = k['legs']
        hx = hip[0]
        legs = blank()
        hip_l = (hx, 90)
        # back leg: heel lift = ankle up + boot tilted toe-down (plantarflexion)
        ba = (hx + bdx, 116 - blift); bk = (hx + round(bdx * 0.45) + 1, 104 - round(blift * 0.6))
        draw_leg(legs, hip_l, bk, ba, back=True, boot_rot=-bheel if bheel else 0, cuff=True)
        fa = (hx + fdx, 116 - flift); fk = (hx + round(fdx * 0.45) - fbend - round(flift * 0.9), 104 - round(flift * 0.6))
        draw_leg(legs, hip_l, fk, fa, boot_rot=0)
        f = blank(); put(f, sm); put(f, legs)
        if k['behind']:
            put(f, body); put(f, head)
        else:
            put(f, body); put(f, head)
        frames.append(f)
    return frames, DUR


if __name__ == '__main__':
    anim2.OUT = 'out4'; os.makedirs('out4', exist_ok=True)
    anim2.ANIMS = [(n, anim_attack if n == 'attack' else fn) for n, fn in anim2.ANIMS]
    anim2.main()
    os.rename('out4/rhea_animations_v2.zip', 'out4/rhea_animations_v4.zip')
