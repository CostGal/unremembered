"""v7 — original width restored (RHEA_SLIM=0), v6 hand arrangement kept
(idle = original art; other animations carry the baton in the far hand),
plus a new 10-frame RANGED attack: an Echo wave fired from the baton tip."""
import os, math
os.environ['RHEA_SLIM'] = '0'
from PIL import Image
import anim, anim2, anim5, anim6
from anim2 import (blank, put, shifted, shear_rows, teal_arc, body_offsets, draw_leg,
                   rotate_about, open_coat_hem, sparkles, PARTS, C, plot)
from anim3 import ik_elbow
from anim4 import rot_pt, tip_from, NECK, HEAD_ROT
from anim5 import draw_limb, GLOVE_FAR, GLOVE_NEAR
from rig import FX_TEAL, FX_WHITE, W, H

# --- un-slim the v6 constants
anim6.PIV = (73, 96)
F = [dict(k) for k in anim5.F]
F[0]['far'] = ((70, 66), None, 150)     # start from the shared rest pose
F[9]['far'] = ((73, 68), None, 150)
anim6.F = F
PIV, S_FAR0, S_NEAR0, FAR_HAND = anim6.PIV, anim6.S_FAR0, anim6.S_NEAR0, anim6.FAR_HAND


def echo_wave(img, centre, r, strength=1.0, dotted=False, rim=True):
    """Crescent sound-wave travelling left: convex side leads."""
    a0, a1 = 125, 235
    if strength >= 1:
        teal_arc(img, centre, max(r - 3, 1), r, a0, a1, white_rim=rim, step=0.8, dotted=dotted)
    else:
        teal_arc(img, centre, r, r, a0, a1, white_rim=False, step=1.5, dotted=True)


def flash(img, c, size):
    p = img.load()
    cx, cy = c
    for k in range(-size, size + 1):
        plot(p, cx + k, cy, FX_WHITE if abs(k) <= size // 2 else FX_TEAL)
        plot(p, cx, cy + k, FX_WHITE if abs(k) <= size // 2 else FX_TEAL)
    for k in range(1, size // 2 + 1):
        for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            plot(p, cx + sx * k, cy + sy * k, FX_TEAL)


# frame table: th, hip, girdle, far (hand, elbow, wrist), near (hand, elbow), bag, legs, hdx, trail, hair, stage
R = [
 dict(th=+3, hip=(74, 96), gird=(1, 0), far=((70, 60), None, 130), near=((56, 64), None),
      bag=(1, 0), legs=(-3, 0, 0, 4, 0, 0), hdx=0, trail=-1, hair=0, stage=None),
 dict(th=+5, hip=(75, 96), gird=(2, -1), far=((68, 44), (86, 40), -20), near=((52, 58), None),
      bag=(2, 0), legs=(-2, 1, 1, 5, 0, 0), hdx=0, trail=-2, hair=-1, stage=None),
 dict(th=0, hip=(72, 96), gird=(0, -1), far=((58, 46), None, 172), near=((56, 60), None),
      bag=(0, 0), legs=(-5, 0, 1, 5, 0, 10), hdx=0, trail=0, hair=0, stage=None),
 dict(th=-4, hip=(70, 96), gird=(-2, 0), far=((56, 48), None, 178), near=((60, 66), None),
      bag=(-1, 1), legs=(-7, 0, 2, 5, 1, 15), hdx=-1, trail=2, hair=1, stage='charge'),
 dict(th=-6, hip=(69, 96), gird=(-3, 0), far=((55, 48), None, 178), near=((62, 68), None),
      bag=(-2, 1), legs=(-8, 0, 2, 5, 1, 20), hdx=-2, trail=3, hair=2, stage='fire'),
 dict(th=-2, hip=(71, 96), gird=(-1, 0), far=((59, 48), None, 176), near=((60, 66), None),
      bag=(0, 1), legs=(-7, 0, 2, 5, 0, 10), hdx=0, trail=-1, hair=-1, stage='recoil'),
 dict(th=-4, hip=(70, 96), gird=(-2, 0), far=((56, 48), None, 178), near=((60, 66), None),
      bag=(-1, 1), legs=(-7, 0, 2, 5, 1, 15), hdx=-1, trail=1, hair=1, stage='travel1'),
 dict(th=-3, hip=(70, 96), gird=(-2, 0), far=((56, 49), None, 176), near=((60, 66), None),
      bag=(-1, 0), legs=(-7, 0, 2, 5, 0, 10), hdx=-1, trail=1, hair=0, stage='travel2'),
 dict(th=0, hip=(72, 96), gird=(0, 0), far=((60, 62), None, 140), near=((58, 66), None),
      bag=(0, 0), legs=(-4, 0, 1, 4, 0, 0), hdx=0, trail=0, hair=0, stage=None),
 dict(th=0, hip=(73, 96), gird=(0, 0), far=((73, 68), None, 150), near=((56, 66), None),
      bag=(0, 0), legs=(-3, 0, 0, 4, 0, 0), hdx=0, trail=0, hair=0, stage=None),
]
R_DUR = [80, 70, 50, 100, 60, 50, 60, 70, 90, 120]


def anim_ranged():
    frames = []
    prev_trail = 0
    tip_world = None
    for i, k in enumerate(R):
        th, hip = k['th'], k['hip']
        tr = (hip[0] - PIV[0], hip[1] - PIV[1])
        body_rot = lambda img: rotate_about(img, th, PIV, hip)
        gx, gy = k['gird']
        fh, fe, fw = k['far']
        S_far = (S_FAR0[0] + gx, S_FAR0[1] + gy)
        far = blank()
        if fe is None:
            fe, fh = ik_elbow(S_far, fh, side=-1)
        tip = tip_from(fh, fw)
        draw_limb(far, S_far, fh, tip, elbow=fe, glove=GLOVE_FAR)
        far = body_rot(far)
        tw = rot_pt(tip, PIV, th); tw = (round(tw[0] + tr[0]), round(tw[1] + tr[1]))
        nh, ne = k['near']
        S_near = (S_NEAR0[0] + gx, S_NEAR0[1] + gy)
        near = blank()
        if ne is None:
            ne, nh = ik_elbow(S_near, nh, side=-1)
        draw_limb(near, S_near, nh, None, elbow=ne, glove=GLOVE_NEAR)
        near = body_rot(near)
        body = anim.compose(body_offsets(0, 0, bag=k['bag'], strap=(0, 0)),
                            drop=('legs', 'hem', 'head', 'hair', 'front_arm', 'baton', 'back_arm'))
        body = body_rot(body)
        lag = prev_trail; prev_trail = k['trail']
        hem = shifted(open_coat_hem(front_swing=round(-lag / 3), back_swing=round(lag * 0.6), lift=0), *tr)
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: k['hair'])
        head = anim.compose(body_offsets(0, 0), override={'hair': hair},
                            drop=('legs', 'strap', 'hem', 'torso', 'bag', 'back_arm', 'front_arm', 'baton'))
        nw = rot_pt(NECK, PIV, th); nw = (round(nw[0] + tr[0]) + k['hdx'], round(nw[1] + tr[1]))
        head = rotate_about(head, round(th * HEAD_ROT), NECK, nw)
        fdx, flift, fbend, bdx, blift, bheel = k['legs']
        hx = hip[0]; legs = blank(); hip_l = (hx, 90)
        ba = (hx + bdx, 116 - blift); bk = (hx + round(bdx * 0.45) + 1, 104 - round(blift * 0.6))
        draw_leg(legs, hip_l, bk, ba, back=True, boot_rot=-bheel if bheel else 0)
        fa = (hx + fdx, 116 - flift); fk = (hx + round(fdx * 0.45) - fbend - round(flift * 0.9), 104 - round(flift * 0.6))
        draw_leg(legs, hip_l, fk, fa)
        # ---- FX by stage
        fx_back, fx_front = blank(), blank()
        st = k['stage']
        if st == 'charge':
            # motes converging on the tip
            pts = [(tw[0] - 7, tw[1] - 6), (tw[0] + 6, tw[1] - 8), (tw[0] - 8, tw[1] + 5),
                   (tw[0] + 7, tw[1] + 6), (tw[0] - 2, tw[1] - 10), (tw[0] + 1, tw[1] + 9)]
            sparkles(fx_front, pts)
            flash(fx_front, tw, 2)
        elif st == 'fire':
            flash(fx_front, tw, 6)
            echo_wave(fx_front, (tw[0] - 2, tw[1]), 5)
            echo_wave(fx_front, (tw[0] + 4, tw[1]), 9, strength=0.5)
            tip_world = tw
        elif st == 'recoil':
            flash(fx_front, tw, 3)
            echo_wave(fx_front, (tw[0] - 9, tw[1]), 9)
            echo_wave(fx_front, (tw[0] - 1, tw[1]), 12, strength=0.5)
        elif st == 'travel1':
            plot(fx_front.load(), tw[0], tw[1], FX_TEAL)
            echo_wave(fx_front, (tw[0] - 14, tw[1]), 13)
            echo_wave(fx_front, (tw[0] - 5, tw[1]), 14, strength=0.5)
        elif st == 'travel2':
            echo_wave(fx_front, (tw[0] - 22, tw[1]), 16, rim=False)
            echo_wave(fx_front, (tw[0] - 12, tw[1]), 15, strength=0.5)
        f = blank()
        for layer in (fx_back, far, legs, hem, body, head, near, fx_front):
            put(f, layer)
        frames.append(f)
    return frames, R_DUR


def projectile_sheet():
    """Stand-alone Echo wave projectile (48x48, 4 frames) for the engine to spawn."""
    S = 48
    frames = []
    for i, (r, strength, dotted) in enumerate([(6, 1, False), (10, 1, False), (14, 1, False), (16, 0.5, True)]):
        im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        c = (S // 2 + 6, S // 2)
        # teal_arc works on the 128 canvas; draw on a temp canvas and crop
        tmp = blank(); cc = (64, 64)
        teal_arc(tmp, cc, max(r - 2, 1), r, 125, 235, white_rim=(strength >= 1), step=1.0, dotted=dotted)
        if i >= 1:
            teal_arc(tmp, (cc[0] + 8, cc[1]), r - 3, r - 3, 130, 230, white_rim=False, step=1.5, dotted=True)
        im.paste(tmp.crop((64 - 22, 64 - 24, 64 + 26, 64 + 24)), (0, 0))
        frames.append(im)
    return frames


if __name__ == '__main__':
    anim2.OUT = 'out7'; os.makedirs('out7', exist_ok=True)
    repl = {'attack': anim6.anim_attack, 'death': anim6.anim_death, 'victory': anim6.anim_victory,
            'idle': anim6.anim_idle}
    anims = [(n, repl.get(n, fn)) for n, fn in anim2.ANIMS]
    anims.insert(4, ('ranged', anim_ranged))
    anim2.ANIMS = anims
    anim2.main()
    pf = projectile_sheet()
    sheet = Image.new('RGBA', (48 * 4, 48), (0, 0, 0, 0))
    for i, f in enumerate(pf):
        sheet.paste(f, (i * 48, 0))
    sheet.save('out7/echo_wave_projectile_sheet.png')
    os.rename('out7/rhea_animations_v2.zip', 'out7/rhea_animations_v7.zip')
