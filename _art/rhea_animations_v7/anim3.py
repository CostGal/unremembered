"""Attack v3: the torso/head/bag lean, twist and dip with the swing, and the arm is
drawn in body space *before* the body is rotated, so it stays attached."""
import os, math
from PIL import Image
import anim2
from anim2 import (blank, put, shifted, shear_rows, draw_arm, teal_arc, compose, body_offsets,
                   legs_image, leg_pose, rotate_about, PARTS, C, plot)

PIV = (73, 96)      # hip pivot

L_UP, L_FORE = 18, 18                  # upper arm / forearm lengths in px
SH = (69, 34)                          # near shoulder, seated inside the torso


def ik_elbow(shoulder, hand, side=+1):
    """Two-bone IK. side=+1 bends the elbow to the clockwise side of the
    shoulder->hand line (screen coords), i.e. down/back for a forward reach."""
    sx, sy = shoulder; hx, hy = hand
    dx, dy = hx - sx, hy - sy
    d = math.hypot(dx, dy)
    d = min(d, L_UP + L_FORE - 0.5)
    ux, uy = dx / max(math.hypot(dx, dy), 1e-6), dy / max(math.hypot(dx, dy), 1e-6)
    a = (L_UP ** 2 - L_FORE ** 2 + d * d) / (2 * d)
    h = math.sqrt(max(L_UP ** 2 - a * a, 0))
    ex = sx + ux * a - side * uy * h
    ey = sy + uy * a + side * ux * h
    hand2 = (round(sx + ux * d), round(sy + uy * d))
    return (round(ex), round(ey)), hand2


def draw_arm2(img, shoulder, hand, tip=None, side=+1, elbow=None, w=5):
    """Shoulder -> elbow -> hand sleeve with a crease at the elbow, then glove + baton."""
    from anim2 import thick_line
    if elbow is None:
        elbow, hand = ik_elbow(shoulder, hand, side)
    p = img.load()
    for a, b in ((shoulder, elbow), (elbow, hand)):
        thick_line(p, a, b, w + 2, C['coat_out'])
    for a, b in ((shoulder, elbow), (elbow, hand)):
        thick_line(p, a, b, w, C['coat'])
    # shading strip on the lower/back side of each bone
    for a, b in ((shoulder, elbow), (elbow, hand)):
        (x0, y0), (x1, y1) = a, b
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            cx = x0 + round((x1 - x0) * i / n); cy = y0 + round((y1 - y0) * i / n)
            if abs(y1 - y0) >= abs(x1 - x0):
                plot(p, cx + w // 2 - 1, cy, C['coat_dark'])
            else:
                plot(p, cx, cy + w // 2 - 1, C['coat_dark'])
    # elbow crease: a short dark fold across the joint
    ex, ey = elbow
    for k in (-1, 0, 1):
        plot(p, ex + k, ey + 1, C['coat_dark'])
    plot(p, ex, ey, C['coat_deep'])
    # glove
    hx, hy = hand
    for yy in range(-3, 3):
        for xx in range(-3, 3):
            if abs(xx + 0.5) + abs(yy + 0.5) <= 4.2:
                edge = abs(xx + 0.5) + abs(yy + 0.5) > 3.0
                plot(p, hx + xx, hy + yy, C['glove_dark'] if edge else C['glove'])
    plot(p, hx - 1, hy - 1, C['glove_hi'])
    if tip:
        # keep baton length constant from the (possibly clamped) hand
        tx, ty = tip
        L = 33
        dx, dy = tx - hx, ty - hy
        n = max(math.hypot(dx, dy), 1e-6)
        tip = (round(hx + dx / n * L), round(hy + dy / n * L))
        from anim2 import draw_baton
        draw_baton(img, hand, tip)
    return elbow, hand


def anim_attack():
    # theta (cw deg: + = lean back, - = lean forward), hip (x,y), hand, tip, bag(dx,dy),
    # head extra dx, hem trail, fx, legs (front dx, back dx, bend)
    poses = [
        (+4, (75, 96), (68, 50), (93, 27), (+1, 0), +1, -1, None, (-2, 4, 0), (83, 43)),
        (+7, (76, 97), (69, 51), (95, 27), (+2, 0), +2, -2, None, (-1, 5, 1), (85, 43)),
        (+2, (74, 95), (66, 25), (72, -7), (+1, -1), 0, 0, 'arc1', (-3, 4, 0), (83, 28)),
        (-7, (69, 96), (44, 54), (12, 60), (-2, +1), -2, 3, 'arc2', (-9, 5, 2), None),
        (-10, (68, 97), (44, 60), (11, 71), (-3, +2), -3, 4, 'arc3', (-10, 5, 3), None),
        (-6, (70, 96), (49, 63), (24, 88), (-2, +1), -1, 2, None, (-8, 5, 2), None),
        (-2, (72, 96), (54, 66), (34, 92), (-1, 0), 0, 1, None, (-4, 4, 1), None),
        (0, (73, 96), None, None, (0, 0), 0, 0, None, None, None),
    ]
    frames = []
    for i, (th, hip, hand, tip, bag, hdx, trail, fx, lg, elbow) in enumerate(poses):
        hem = shear_rows(PARTS['hem'], 88, 103, lambda y: round(trail * (y - 88) / 15))
        off = body_offsets(0, 0, head=(hdx, 0), hair=(hdx, 0), hem=(0, 0), bag=bag, legs=(0, 0),
                           strap=(0, 0))
        drop, extra = ('legs',), []
        # smear drawn in body space, behind the body, so it rotates with the swing
        sm = blank()
        if fx == 'arc1':
            teal_arc(sm, (62, 48), 30, 35, -35, -85, step=1.2)
        elif fx == 'arc2':
            teal_arc(sm, (56, 50), 29, 34, -95, -195, step=1.2)
            teal_arc(sm, (56, 50), 30, 33, -45, -95, white_rim=False, dotted=True, step=2)
        elif fx == 'arc3':
            teal_arc(sm, (56, 50), 30, 34, -150, -205, white_rim=False, dotted=True, step=2)
        back = [sm]
        if hand:
            arm = blank(); draw_arm2(arm, SH, hand, tip, side=+1, elbow=elbow)
            drop = ('legs', 'front_arm', 'baton')
            if fx == 'arc1':
                back = [sm, arm]          # baton passes behind the head
            else:
                extra = [arm]
        upper = compose(off, override={'hem': hem}, extra_back=back[1:], extra_front=extra, drop=drop)
        upper = rotate_about(upper, th, PIV, hip)
        # rotate the smear on its own (no orphan clean-up, or the dotted trail dies)
        if th:
            sm = sm.rotate(-th, resample=Image.NEAREST, center=PIV,
                           translate=(hip[0] - PIV[0], hip[1] - PIV[1]))
        else:
            sm = shifted(sm, hip[0] - PIV[0], hip[1] - PIV[1])
        upper = (lambda u: (put(u, upper), u)[1])(sm.copy())
        if lg:
            fdx, bdx, bend = lg
            legs = legs_image(leg_pose(fdx, 0, bend=bend, hip=(hip[0], 90)),
                              leg_pose(bdx, 0, bend=0, hip=(hip[0], 90)))
        else:
            legs = PARTS['legs']
        f = blank(); put(f, legs); put(f, upper)
        frames.append(f)
    return frames, [100, 70, 50, 60, 80, 90, 110, 150]


if __name__ == '__main__':
    anim2.OUT = 'out3'; os.makedirs('out3', exist_ok=True)
    anim2.ANIMS = [(n, anim_attack if n == 'attack' else fn) for n, fn in anim2.ANIMS]
    anim2.main()
    os.rename('out3/rhea_animations_v2.zip', 'out3/rhea_animations_v3.zip')
