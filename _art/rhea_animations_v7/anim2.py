"""Rhea animation set v2: open-coat walk/run, 12-frame backward-fall death,
longer attack/cast/hurt/victory/idle. Reuses the rig + primitives from anim.py."""
import json, math, os, zipfile
from collections import Counter
from PIL import Image, ImageDraw
import rig
from rig import W, H, PARTS, MASKS, PX, ALLOWED, FX_TEAL, FX_WHITE
from anim import (blank, put, shifted, plot, thick_line, outline_of, shear_rows, draw_arm,
                  draw_baton, teal_arc, sparkles, ring_image, compose, body_offsets, save_gif,
                  check_palette, C, FRONT_BOOT, BACK_BOOT, BOOT_ANCHOR, BG, Z)

OUT = 'out2'
os.makedirs(OUT, exist_ok=True)
HIP = (73, 90)          # legs now start higher: the coat can open


# --------------------------------------------------------------- utilities
def despeckle(img):
    """Palette-safe clean-up after a nearest-neighbour rotation: drop orphan
    pixels and fill 1-px holes with the majority neighbour colour."""
    p = img.load()
    op = {(x, y): p[x, y] for y in range(H) for x in range(W) if p[x, y][3]}
    n4 = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    for (x, y) in list(op):
        if sum((x + a, y + b) in op for a, b in n4) <= 1:
            p[x, y] = (0, 0, 0, 0); del op[(x, y)]
    holes = set()
    for (x, y) in op:
        for a, b in n4:
            q = (x + a, y + b)
            if q not in op and 0 <= q[0] < W and 0 <= q[1] < H:
                holes.add(q)
    for (x, y) in holes:
        nb = [op[(x + a, y + b)] for a, b in n4 if (x + a, y + b) in op]
        if len(nb) >= 3:
            p[x, y] = Counter(nb).most_common(1)[0][0]
    return img


def rotate_about(img, cw_deg, pivot, new_pivot):
    """Rotate img clockwise by cw_deg about pivot and move pivot to new_pivot."""
    if cw_deg == 0:
        return shifted(img, new_pivot[0] - pivot[0], new_pivot[1] - pivot[1])
    o = img.rotate(-cw_deg, resample=Image.NEAREST, center=pivot,
                   translate=(new_pivot[0] - pivot[0], new_pivot[1] - pivot[1]))
    return despeckle(o)


def rot_stamp(stamp, cw_deg):
    if cw_deg == 0:
        return stamp
    big = Image.new('RGBA', (stamp.width * 3, stamp.height * 3), (0, 0, 0, 0))
    big.paste(stamp, (stamp.width, stamp.height))
    return big.rotate(-cw_deg, resample=Image.NEAREST)


def draw_leg(img, hip, knee, ankle, width=7, back=False, boot_rot=0, cuff=True):
    p = img.load()
    if back:
        C_fill, C_shade, C_mid = C['leg_shade'], C['leg_dark'], C['leg_mid']
    else:
        C_fill, C_shade, C_mid = C['leg_fill'], C['leg_shade'], C['leg_mid']
    thick_line(p, hip, knee, width + 2, C['leg_out'])
    thick_line(p, knee, ankle, width + 2, C['leg_out'])
    thick_line(p, hip, knee, width, C_fill)
    thick_line(p, knee, ankle, width, C_fill)
    for seg in ((hip, knee), (knee, ankle)):
        (x0, y0), (x1, y1) = seg
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        vertical = abs(y1 - y0) >= abs(x1 - x0)
        for i in range(n + 1):
            cx = x0 + round((x1 - x0) * i / n); cy = y0 + round((y1 - y0) * i / n)
            if vertical:
                plot(p, cx + width // 2, cy, C_shade); plot(p, cx + width // 2 - 1, cy, C_shade)
                plot(p, cx - width // 2, cy, C_mid)
            else:
                plot(p, cx, cy + width // 2, C_shade); plot(p, cx, cy + width // 2 - 1, C_shade)
                plot(p, cx, cy - width // 2, C_mid)
    if cuff and boot_rot == 0:
        ax, ay = ankle; kx, ky = knee
        for row_off, col in ((-9, C['leg_cuff']), (-6, C['leg_dark'])):
            yy = ay + row_off
            t = (yy - ky) / max(ay - ky, 1)
            cx = round(kx + (ax - kx) * t)
            for k in range(-width // 2 + 1, width // 2):
                plot(p, cx + k, yy, col)
    ax, ay = ankle
    stamp = BACK_BOOT if back else FRONT_BOOT
    ox = ax - 3 - (BOOT_ANCHOR[0] - (64 if back else 61))
    if boot_rot == 0:
        put(img, stamp, ox, ay)
    else:
        big = rot_stamp(stamp, boot_rot)
        # anchor: the stamp's (BOOT_ANCHOR) point sits at (ax-3, ay) -> keep it fixed
        axs, ays = (BOOT_ANCHOR[0] - (64 if back else 61)) + stamp.width, 0 + stamp.height
        # rotate anchor inside the 3x canvas about its centre
        cxb, cyb = big.width / 2, big.height / 2
        r = math.radians(cw := boot_rot)
        dx, dy = axs - cxb, ays - cyb
        rx = cxb + dx * math.cos(r) - dy * math.sin(r)
        ry = cyb + dx * math.sin(r) + dy * math.cos(r)
        put(img, big, round(ax - 3 - rx), round(ay - ry))


def legs_image(front, back, **kw):
    img = blank()
    draw_leg(img, *back, back=True, **kw)
    draw_leg(img, *front, **kw)
    return img


def leg_pose(foot_dx, lift, bend=0, hip=HIP):
    hx, hy = hip
    ankle = (hx + foot_dx, 116 - lift)
    kx = hx + round(foot_dx * 0.45) - round(lift * 0.9) - bend
    ky = hy + 14 - round(lift * 0.6)
    return ((hx, hy), (kx, ky), ankle)


# ------------------------------------------------------------- open coat
def split_hem():
    """Cut the hem into a front flap and a back flap with a drawn cloth edge."""
    front, back = blank(), blank()
    fp, bp = front.load(), back.load()
    hp = PARTS['hem'].load()
    for (x, y) in MASKS['hem']:
        (fp if x <= 70 else bp)[x, y] = hp[x, y]
    for y in range(88, 104):
        if (70, y) in MASKS['hem']:
            fp[70, y] = C['coat_out'] + (255,)
            fp[69, y] = C['coat_dark'] + (255,)
        if (71, y) in MASKS['hem']:
            bp[71, y] = C['coat_out'] + (255,)
    return front, back


HEM_FRONT, HEM_BACK = split_hem()


def split_front_arm():
    fa = PARTS['front_arm']; fp = fa.load()
    glove, sleeve = blank(), blank(); gp, sp = glove.load(), sleeve.load()
    for y in range(H):
        for x in range(W):
            if fp[x, y][3]:
                (gp if y >= 63 else sp)[x, y] = fp[x, y]
    return sleeve, glove


SLEEVE, GLOVE = split_front_arm()


def open_coat_hem(front_swing, back_swing, lift=0, trail=0):
    """front_swing: bottom-row x shift of the front flap (negative = forward).
    back_swing: bottom-row x shift of the back flap. trail: extra rightward drag."""
    f = shear_rows(HEM_FRONT, 88, 103, lambda y: round(front_swing * (y - 88) / 15))
    b = shear_rows(HEM_BACK, 88, 103, lambda y: round((back_swing + trail) * (y - 88) / 15))
    o = blank(); put(o, b, 0, -lift if back_swing > 0 else 0); put(o, f, 0, -lift)
    return o


def cycle(n, stride, max_lift, bend=0):
    """Foot x offsets and lifts for an n-frame gait: first half stance, second swing."""
    A, L = [], []
    half = n // 2
    for i in range(n):
        if i <= half:
            A.append(round(-stride + 2 * stride * i / half)); L.append(0)
        else:
            t = (i - half) / (n - half)
            A.append(round(stride - 2 * stride * t)); L.append(round(max_lift * math.sin(math.pi * t)))
    return A, L


# ================================================================== IDLE (6)
def anim_idle():
    frames = []
    bob = [0, -1, -1, 0, 0, 0]
    # blink: eye pixels -> nearest skin colour (frame 4)
    head_blink = PARTS['head'].copy(); hb = head_blink.load()
    for y in (16, 17):
        for x in (66, 67):
            hb[x, y] = PX[65, y]
    for i in range(6):
        b = bob[i]
        hair = shear_rows(PARTS['hair'], 6, 12, lambda y: 1) if i == 2 else PARTS['hair']
        hem = shear_rows(PARTS['hem'], 98, 103, lambda y: (1 if i in (1, 2) else 0))
        off = body_offsets(0, b, hair=(0, b - (1 if i == 2 else 0)),
                           bag=(0, b + (1 if i in (1, 2) else 0)), hem=(0, 0), strap=(0, b))
        ov = {'hair': hair, 'hem': hem}
        if i == 4:
            ov['head'] = head_blink
        frames.append(compose(off, override=ov))
    return frames, [220, 200, 200, 220, 120, 260]


# ================================================================== WALK (12)
def anim_walk():
    n = 12
    A, L = cycle(n, 8, 6)
    bob = [round(-1.2 * math.sin(math.pi * 2 * i / (n / 2))) for i in range(n)]
    frames = []
    for i in range(n):
        j = (i + n // 2) % n
        legs = legs_image(leg_pose(A[i], L[i]), leg_pose(A[j], L[j]))
        b = bob[i]
        hem = open_coat_hem(front_swing=round(-A[i] / 2), back_swing=round(A[i] / 3), lift=1)
        gdx = round(-A[i] / 4); gdy = abs(A[i]) // 5
        front = blank(); put(front, SLEEVE, 0, b); put(front, GLOVE, gdx, b + gdy)
        off = body_offsets(0, b, hem=(0, b), legs=(0, 0), baton=(gdx, b + gdy), front_arm=(0, 0),
                           back_arm=(round(A[i] / 4), b), bag=(0, b + (1 if i % 6 == 2 else 0)))
        frames.append(compose(off, override={'legs': legs, 'hem': hem, 'front_arm': front}))
    return frames, [75] * n


# ================================================================== RUN (12)
def anim_run():
    n = 12
    A, L = cycle(n, 11, 9)
    # flight: both feet briefly off the ground around the swing start
    bob = [round(-2 * math.sin(math.pi * 2 * i / (n / 2))) for i in range(n)]
    frames = []
    for i in range(n):
        j = (i + n // 2) % n
        fl = L[i] + (2 if i in (6, 7, 0, 1) else 0)
        bl = L[j] + (2 if i in (6, 7, 0, 1) else 0)
        legs = legs_image(leg_pose(A[i], fl, bend=2), leg_pose(A[j], bl, bend=2))
        b = bob[i]
        hem = open_coat_hem(front_swing=round(-A[i] / 2), back_swing=2, lift=2, trail=4)
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: 2 + (1 if i % 6 in (1, 2) else 0))
        gdx = round(-A[i] / 3); gdy = abs(A[i]) // 4
        front = blank(); put(front, SLEEVE, 0, b); put(front, GLOVE, gdx, b + gdy)
        off = body_offsets(0, b, head=(-2, b), hair=(-2, b), hem=(0, b), legs=(0, 0),
                           baton=(gdx, b + gdy), front_arm=(0, 0),
                           back_arm=(round(A[i] / 3), b), bag=(1, b + (1 if i % 6 == 2 else 0)),
                           strap=(0, b))
        f = compose(off, override={'legs': legs, 'hem': hem, 'front_arm': front, 'hair': hair})
        # forward lean by row shear (rows above the hip shift left)
        f = shear_rows(f, 0, 92, lambda y: -round(3 * (92 - y) / 92))
        frames.append(f)
    return frames, [60] * n


# ================================================================== ATTACK (8)
def anim_attack():
    SH = (60, 33)
    poses = [  # hand, tip, body dx, head dx, hem trail, fx
        ((70, 47), (93, 23), 1, 1, -1, None),
        ((72, 45), (96, 22), 2, 2, -2, None),
        ((66, 27), (74, -4), 0, -1, 0, 'arc1'),
        ((44, 54), (12, 60), -3, -4, 3, 'arc2'),
        ((43, 61), (11, 71), -3, -3, 3, 'arc3'),
        ((48, 64), (24, 88), -2, -2, 2, None),
        ((54, 66), (34, 92), -1, -1, 1, None),
        (None, None, 0, 0, 0, None),
    ]
    frames = []
    for i, (hand, tip, bdx, hdx, trail, fx) in enumerate(poses):
        hem = shear_rows(PARTS['hem'], 88, 103, lambda y: round(trail * (y - 88) / 15))
        off = body_offsets(bdx, 0, head=(hdx, 0), hair=(hdx, 0), hem=(0, 0),
                           back_arm=(bdx, 0), bag=(bdx, 1 if i in (3, 4) else 0), strap=(bdx, 0))
        if i in (3, 4, 5):
            legs = legs_image(leg_pose(-8, 0), leg_pose(5, 0))
        elif i in (0, 1, 2):
            legs = legs_image(leg_pose(-2, 0), leg_pose(4, 0))
        else:
            legs = PARTS['legs']
        drop, extra = (), []
        if hand:
            arm = blank(); draw_arm(arm, (SH[0] + bdx, SH[1]), hand, tip)
            drop = ('front_arm', 'baton')
            sm = blank()
            if fx == 'arc1':
                teal_arc(sm, (62, 48), 30, 35, -30, -95, step=1.2)
            elif fx == 'arc2':
                teal_arc(sm, (56, 50), 29, 34, -95, -195, step=1.2)
                teal_arc(sm, (56, 50), 30, 33, -45, -95, white_rim=False, dotted=True, step=2)
            elif fx == 'arc3':
                teal_arc(sm, (56, 50), 30, 34, -150, -205, white_rim=False, dotted=True, step=2)
            extra = [sm, arm]
        if fx == 'arc1':   # baton passes behind the head at the top of the swing
            frames.append(compose(off, override={'hem': hem, 'legs': legs}, extra_back=[arm],
                                  extra_front=[sm], drop=drop)); continue
        frames.append(compose(off, override={'hem': hem, 'legs': legs}, extra_front=extra, drop=drop))
    return frames, [100, 70, 50, 60, 80, 90, 110, 150]


# ================================================================== CAST (8)
def anim_cast():
    import random
    rnd = random.Random(7)
    frames = []
    base_dots = [(rnd.randint(46, 98), rnd.randint(20, 118)) for _ in range(56)]
    hy_l = [0, 0, -1, -1, -2, -2, -1, 0]
    hair_l = [0, -1, -1, -2, -2, -2, -1, 0]
    for i in range(8):
        hy, hairdy = hy_l[i], hair_l[i]
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: -1) if 2 <= i <= 6 else PARTS['hair']
        off = body_offsets(0, hy, hair=(0, hairdy), legs=(0, 0), hem=(0, 0), bag=(0, hy + 1))
        body = compose(off, override={'hair': hair})
        fx_back, fx_front = blank(), blank()
        gp = fx_back.load()
        if 1 <= i <= 6:
            for a in range(0, 360, 6):
                rad = math.radians(a)
                x = 72 + round((17 + i) * math.cos(rad)); y = 121 + round(4 * math.sin(rad))
                if 3 <= i <= 5 or a % 12 == 0:
                    plot(gp, x, y, FX_TEAL)
        pts = [(x, y - i * 4) for (x, y) in base_dots[: 6 + i * 7]]
        if i < 7:
            sparkles(fx_back, pts, plus=(i in (4, 5)))
        if 2 <= i <= 6:
            ring = ring_image(body, thickness=1 if i in (2, 3, 6) else 2,
                              dotted=(i in (2, 6)), inner_col=FX_WHITE if i == 4 else None)
            put(fx_back, ring)
        if 3 <= i <= 6:
            ep = fx_front.load()
            for (x, y) in MASKS['torso']:
                if rig.is_teal(rig.rgb(x, y)):
                    plot(ep, x, y + hy, FX_WHITE if i in (4, 5) else FX_TEAL)
            if i in (4, 5):
                for (x, y) in [(75, 38), (81, 38), (78, 34), (78, 43), (83, 41), (73, 41)]:
                    plot(ep, x, y + hy, FX_TEAL)
        f = blank(); put(f, fx_back); put(f, body); put(f, fx_front)
        frames.append(f)
    return frames, [110, 110, 110, 110, 140, 140, 120, 160]


# ================================================================== HURT (4)
def anim_hurt():
    f0 = compose(body_offsets(2, 0, head=(3, 1), hair=(3, 1), legs=(0, 0), hem=(1, 0)))
    f1 = compose(body_offsets(4, 0, head=(5, 1), hair=(5, 1), legs=(1, 0), hem=(2, 0),
                              front_arm=(3, 1), baton=(3, 1)))
    fl = blank(); fp = fl.load(); sp = f1.load()
    for y in range(H):
        for x in range(W):
            if sp[x, y][3]:
                fp[x, y] = FX_WHITE + (255,)
    f2 = compose(body_offsets(3, 0, head=(4, 1), hair=(4, 1), legs=(1, 0), hem=(2, 0),
                              front_arm=(2, 1), baton=(2, 1)))
    f3 = compose(body_offsets(1, 0, head=(1, 0), hair=(1, 0), legs=(0, 0), hem=(1, 0)))
    return [f0, fl, f2, f3], [70, 70, 100, 120]


# ================================================================== DEATH (12) — backward fall
def upper_body(front_hand=None, baton_tip=None, glove_only=False):
    """Everything above the hips, composed in the standing frame."""
    drop = ('legs',)
    extra = []
    if front_hand:
        arm = blank(); draw_arm(arm, (60, 33), front_hand, baton_tip, baton=baton_tip is not None)
        drop = ('legs', 'front_arm', 'baton'); extra = [arm]
    return compose(body_offsets(0, 0), drop=drop, extra_front=extra)


def anim_death():
    frames = []
    PIV = (73, 96)                      # hip pivot in the standing frame
    # per frame: theta(cw deg), hip x, hip y, hand(local), baton(local tip or None)
    thetas = [0, 0, 6, 15, 27, 42, 58, 73, 85, 90, 90, 90]
    for i, th in enumerate(thetas):
        s = math.sin(math.radians(th))
        hip = (73 - round(41 * s) + (2 if i == 1 else 0), 96 + round(7 * s))
        # arm: thrown forward/up as she tips, baton released at frame 4
        if i == 0:
            hand, tip = None, None
        elif i in (1, 2):
            hand, tip = (54, 60), (34, 88)
        elif i == 3:
            hand, tip = (48, 52), (24, 74)
        else:
            hand, tip = (46, 40), None
        up = upper_body(hand, tip)
        # bag swings out on the way down (rigid with body here)
        rot = rotate_about(up, th, PIV, hip)
        if i == 0:
            rot = shifted(rot, 2, 0)
        # legs: feet slide forward, knees fold, boots tip up as she lands
        boot_rot = 0 if th < 20 else (30 if th < 45 else (60 if th < 75 else 90))
        fx = hip[0] - 8 - round(14 * s); bx = hip[0] + 3 - round(22 * s)
        ay = 116 - round(6 * s)
        kf = (round((hip[0] + fx) / 2) - 3, round((hip[1] + ay) / 2) - round(6 * s))
        kb = (round((hip[0] + bx) / 2) + 1, round((hip[1] + ay) / 2) - round(3 * s))
        legs = legs_image((hip, kf, (fx, ay)), (hip, kb, (bx, ay)), boot_rot=boot_rot)
        f = blank()
        # baton: in hand until frame 3, then flies and lands
        baton = blank()
        flight = {4: ((50, 40), (24, 26)), 5: ((38, 54), (12, 42)), 6: ((28, 74), (8, 58)),
                  7: ((18, 96), (12, 68)), 8: ((14, 114), (32, 92))}
        if i in flight:
            draw_baton(baton, *flight[i])
        elif i >= 9:
            draw_baton(baton, (14, 120), (46, 117))
        put(f, baton)
        put(f, legs)
        dy = 0
        if i == 9:
            dy = -2     # impact bounce
        put(f, rot, 0, dy)
        if i == 9 or i == 10:
            dust = blank()
            pts = [(hip[0] + 30 + k * 9, 118 - (k % 3) * 3 - (2 if i == 10 else 0)) for k in range(6)]
            pts += [(hip[0] - 12 - k * 7, 117 - (k % 2) * 4 - (2 if i == 10 else 0)) for k in range(3)]
            sparkles(dust, pts, col=FX_WHITE if i == 9 else FX_TEAL, plus=(i == 9))
            put(f, dust)
        frames.append(f)
    return frames, [90, 90, 70, 60, 55, 55, 55, 55, 55, 90, 160, 500]


# ================================================================== VICTORY (6)
def anim_victory():
    SH = (60, 33)
    spec = [  # dy, hand, tip, jump legs, sparkle
        (2, (54, 52), (30, 30), 'crouch', False),
        (-5, (50, 26), (34, 0), 2, False),
        (-7, (50, 24), (34, -2), 3, True),
        (-3, (50, 25), (34, -1), 0, True),
        (1, (52, 30), (36, 4), 'crouch', False),
        (0, (50, 27), (34, 1), None, True),
    ]
    frames = []
    for i, (dy, hand, tip, lg, spark) in enumerate(spec):
        arm = blank(); draw_arm(arm, (SH[0], SH[1] + dy), (hand[0], hand[1] + dy), (tip[0], tip[1] + dy))
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
            sparkles(fx, [(tip[0] - 4, tip[1] + dy + 2), (tip[0] + 5, tip[1] + dy - 2),
                          (tip[0] - 1, tip[1] + dy - 6), (tip[0] + 3, tip[1] + dy + 7)], plus=(i == 2))
        frames.append(compose(off, override={'legs': legs, 'hair': hair},
                              drop=('front_arm', 'baton'), extra_front=[arm, fx]))
    return frames, [110, 90, 120, 110, 100, 320]


ANIMS = [('idle', anim_idle), ('walk', anim_walk), ('run', anim_run), ('attack', anim_attack),
         ('cast', anim_cast), ('hurt', anim_hurt), ('death', anim_death), ('victory', anim_victory)]


def main():
    meta = {'frame_size': [W, H], 'facing': 'left', 'fx_colors': ['#3fd0c9', '#f1efe8'],
            'animations': {}}
    rows, files = [], []
    for name, fn in ANIMS:
        frames, durs = fn()
        for k, f in enumerate(frames):
            check_palette(f, f'{name}[{k}]')
        sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
        for k, f in enumerate(frames):
            sheet.paste(f, (k * W, 0))
        sp = f'{OUT}/{name}_sheet.png'; sheet.save(sp); files.append(sp)
        gp = f'{OUT}/{name}_preview.gif'; save_gif(frames, durs, gp); files.append(gp)
        meta['animations'][name] = {'frames': len(frames), 'sheet': f'{name}_sheet.png',
                                    'durations_ms': durs, 'loop': name in ('idle', 'walk', 'run', 'cast')}
        rows.append((name, frames))
        print(name, len(frames), 'frames ok')
    maxn = max(len(f) for _, f in rows)
    cs = Image.new('RGB', (W * maxn + 96, H * len(rows)), BG)
    d = ImageDraw.Draw(cs)
    for r, (name, frames) in enumerate(rows):
        d.text((8, r * H + 8), name, fill=(240, 240, 240))
        for k, f in enumerate(frames):
            cs.paste(f, (96 + k * W, r * H), f)
        d.line([(0, r * H), (cs.width, r * H)], fill=(50, 52, 70))
    cp = f'{OUT}/contact_sheet.png'; cs.save(cp); files.append(cp)
    cs.resize((cs.width * 2, cs.height * 2), Image.NEAREST).save(f'{OUT}/contact_sheet_2x.png')
    files.append(f'{OUT}/contact_sheet_2x.png')
    jp = f'{OUT}/animations.json'; json.dump(meta, open(jp, 'w'), indent=1); files.append(jp)
    files += ['overlay_4x.png', 'rig.json', 'rig.py', 'anim.py', 'anim2.py']
    with zipfile.ZipFile(f'{OUT}/rhea_animations_v2.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for fp in files:
            z.write(fp, os.path.basename(fp))
    print('zipped', len(files))


if __name__ == '__main__':
    main()
