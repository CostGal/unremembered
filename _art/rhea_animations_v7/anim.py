"""Rhea animation set: builds every frame from the rig with integer offsets,
procedurally drawn limbs and palette-locked FX, then exports sheets/GIFs."""
import json, math, os, zipfile
from PIL import Image, ImageDraw
import rig
from rig import W, H, PARTS, MASKS, PX, ALLOWED, FX_TEAL, FX_WHITE

OUT = 'out'
os.makedirs(OUT, exist_ok=True)
BG = (0x1a, 0x1c, 0x28)

# ------------------------------------------------------------ palette colours
C = dict(
    leg_out=(0x0b, 0x04, 0x25), leg_fill=(0x35, 0x32, 0x47), leg_shade=(0x24, 0x1b, 0x39),
    leg_dark=(0x12, 0x06, 0x27), leg_mid=(0x29, 0x23, 0x3e), leg_cuff=(0x1a, 0x07, 0x22),
    coat=(26, 49, 74), coat_dark=(16, 29, 59), coat_out=(10, 6, 41), coat_deep=(7, 5, 41),
    glove=(89, 68, 98), glove_dark=(5, 5, 25), glove_hi=(100, 87, 115),
    baton=(1, 1, 6), baton_hi=(25, 26, 34), baton_hi2=(39, 40, 48), baton_tip=(250, 251, 252),
    black=(2, 2, 10),
)
for v in C.values():
    assert v in ALLOWED, v

FRONT_BOOT = rig.SRC.crop((61, 116, 74, 122))          # toe-left boot stamp
BOOT_ANCHOR = (70, 116)
BACK_BOOT = FRONT_BOOT.crop((3, 0, 13, 6))              # shorter toe for the far boot
_bb = BACK_BOOT.load()
for _y in range(6):                                    # darken far boot one shade
    for _x in range(10):
        _c = _bb[_x, _y][:3]
        if _c == C['leg_fill']:
            _bb[_x, _y] = C['leg_shade'] + (255,)
        elif _c == C['leg_shade'] or _c == C['leg_mid']:
            _bb[_x, _y] = C['leg_dark'] + (255,)                                # shin bottom-centre-ish in stamp coords


# --------------------------------------------------------------- primitives
def blank():
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))


def put(dst, src, dx=0, dy=0):
    dst.paste(src, (dx, dy), src)


def shifted(img, dx, dy):
    o = blank(); put(o, img, dx, dy); return o


def plot(p, x, y, col):
    if 0 <= x < W and 0 <= y < H:
        p[x, y] = col + (255,)


def thick_line(p, a, b, width, col):
    """Bresenham-ish thick line: perpendicular-ish fill by stepping along the
    major axis and painting `width` pixels across the minor axis."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    n = max(abs(dx), abs(dy), 1)
    half = width // 2
    for i in range(n + 1):
        cx = x0 + round(dx * i / n); cy = y0 + round(dy * i / n)
        if abs(dy) >= abs(dx):
            for k in range(-half, -half + width):
                plot(p, cx + k, cy, col)
        else:
            for k in range(-half, -half + width):
                plot(p, cx, cy + k, col)


def outline_of(img, col, conn8=True):
    """Return set of empty pixels adjacent to opaque pixels of img."""
    p = img.load(); ring = set()
    op = {(x, y) for y in range(H) for x in range(W) if p[x, y][3]}
    nb = [(1, 0), (-1, 0), (0, 1), (0, -1)] + ([(1, 1), (-1, 1), (1, -1), (-1, -1)] if conn8 else [])
    for (x, y) in op:
        for ddx, ddy in nb:
            q = (x + ddx, y + ddy)
            if q not in op and 0 <= q[0] < W and 0 <= q[1] < H:
                ring.add(q)
    return ring


def shear_rows(img, y0, y1, fn):
    """Shift every row y in [y0,y1] horizontally by integer fn(y)."""
    o = blank(); src = img.load(); d = o.load()
    for y in range(H):
        s = fn(y) if y0 <= y <= y1 else 0
        for x in range(W):
            if src[x, y][3]:
                nx = x + s
                if 0 <= nx < W:
                    d[nx, y] = src[x, y]
    return o


# ---------------------------------------------------------- procedural leg
def draw_leg(img, hip, knee, ankle, width=7, cuff=True, back=False):
    """Draw one leg (thigh, shin, boot) into img. Ankle = bottom-centre of shin."""
    p = img.load()
    if back:   # far leg: one shade darker so the pair reads as two legs
        C_fill, C_shade, C_mid = C['leg_shade'], C['leg_dark'], C['leg_mid']
    else:
        C_fill, C_shade, C_mid = C['leg_fill'], C['leg_shade'], C['leg_mid']
    # outline pass
    thick_line(p, hip, knee, width + 2, C['leg_out'])
    thick_line(p, knee, ankle, width + 2, C['leg_out'])
    # fill pass
    thick_line(p, hip, knee, width, C_fill)
    thick_line(p, knee, ankle, width, C_fill)
    # shading: back (right) column darker, front (left) column mid
    for seg in ((hip, knee), (knee, ankle)):
        (x0, y0), (x1, y1) = seg
        n = max(abs(y1 - y0), 1)
        for i in range(n + 1):
            cx = x0 + round((x1 - x0) * i / n); cy = y0 + round((y1 - y0) * i / n)
            plot(p, cx + width // 2, cy, C_shade)
            plot(p, cx + width // 2 - 1, cy, C_shade)
            plot(p, cx - width // 2, cy, C_mid)
    # boot-shaft cuff band a few rows above the ankle
    if cuff:
        ax, ay = ankle
        kx, ky = knee
        for row_off, col in ((-9, C['leg_cuff']), (-6, C['leg_dark'])):
            yy = ay + row_off
            # x centre along shin at that row
            t = (yy - ky) / max(ay - ky, 1)
            cx = round(kx + (ax - kx) * t)
            for k in range(-width // 2 + 1, width // 2):
                plot(p, cx + k, yy, col)
    # boot stamp
    ax, ay = ankle
    if back:
        put(img, BACK_BOOT, ax - 3 - (BOOT_ANCHOR[0] - 64), ay)
    else:
        put(img, FRONT_BOOT, ax - 3 - (BOOT_ANCHOR[0] - 61), ay)


def legs_image(front, back, body_dy=0):
    """front/back = (hip, knee, ankle) tuples. Back leg drawn first."""
    img = blank()
    draw_leg(img, *back, back=True)
    draw_leg(img, *front)
    return img


# ---------------------------------------------------------- procedural arm
def draw_arm(img, shoulder, hand, tip=None, sleeve_w=5, baton=True):
    p = img.load()
    thick_line(p, shoulder, hand, sleeve_w + 2, C['coat_out'])
    thick_line(p, shoulder, hand, sleeve_w, C['coat'])
    # dark edge on the underside/back
    (sx, sy), (hx, hy) = shoulder, hand
    n = max(abs(hx - sx), abs(hy - sy), 1)
    for i in range(n + 1):
        cx = sx + round((hx - sx) * i / n); cy = sy + round((hy - sy) * i / n)
        if abs(hy - sy) >= abs(hx - sx):
            plot(p, cx + sleeve_w // 2 - 1, cy, C['coat_dark'])
        else:
            plot(p, cx, cy + sleeve_w // 2 - 1, C['coat_dark'])
    # glove: 6x6 rounded blob
    for yy in range(-3, 3):
        for xx in range(-3, 3):
            if abs(xx + 0.5) + abs(yy + 0.5) <= 4.2:
                edge = abs(xx + 0.5) + abs(yy + 0.5) > 3.0
                plot(p, hx + xx, hy + yy, C['glove_dark'] if edge else C['glove'])
    plot(p, hx - 1, hy - 1, C['glove_hi'])
    if baton and tip:
        draw_baton(img, hand, tip)


def draw_baton(img, hand, tip):
    p = img.load()
    thick_line(p, hand, tip, 3, C['baton'])
    (hx, hy), (tx, ty) = hand, tip
    n = max(abs(tx - hx), abs(ty - hy), 1)
    for i in range(n + 1):
        cx = hx + round((tx - hx) * i / n); cy = hy + round((ty - hy) * i / n)
        # highlight strip on the upper/left side
        if abs(ty - hy) >= abs(tx - hx):
            plot(p, cx - 1, cy, C['baton_hi'] if i % 2 else C['baton_hi2'])
        else:
            plot(p, cx, cy - 1, C['baton_hi'] if i % 2 else C['baton_hi2'])
    # white tip (3 px cap)
    for i in range(n - 2, n + 1):
        cx = hx + round((tx - hx) * i / n); cy = hy + round((ty - hy) * i / n)
        plot(p, cx, cy, C['baton_tip'])
    plot(p, tx, ty, C['baton_tip'])


# ------------------------------------------------------------------- FX
def teal_arc(img, centre, r_in, r_out, a0, a1, white_rim=True, step=1.5, dotted=False):
    p = img.load(); cx, cy = centre
    a = a0; k = 0
    while (a >= a1 if a0 > a1 else a <= a1):
        rad = math.radians(a)
        for r in range(r_in, r_out + 1):
            x = cx + round(r * math.cos(rad)); y = cy + round(r * math.sin(rad))
            if dotted and (x + y) % 2:
                continue
            col = FX_WHITE if (white_rim and r == r_out) else FX_TEAL
            plot(p, x, y, col)
        a += -step if a0 > a1 else step; k += 1


def sparkles(img, pts, col=FX_TEAL, plus=False):
    p = img.load()
    for (x, y) in pts:
        plot(p, x, y, col)
        if plus:
            for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                plot(p, x + ddx, y + ddy, FX_TEAL)


def ring_image(base, thickness=1, col=FX_TEAL, dotted=False, inner_col=None):
    """Glow ring around a composed body image."""
    o = blank(); p = o.load()
    cur = base
    for t in range(thickness):
        ring = outline_of(cur, col)
        tmp = cur.copy(); tp = tmp.load()
        for (x, y) in ring:
            if dotted and (x + y + t) % 2:
                continue
            c = inner_col if (inner_col and t == 0) else col
            plot(p, x, y, c)
        for (x, y) in ring:
            tp[x, y] = (0, 0, 0, 255)
        cur = tmp
    return o


# ------------------------------------------------------------- composing
Z = ['strap', 'legs', 'hem', 'torso', 'bag', 'back_arm', 'head', 'hair', 'front_arm', 'baton']


def compose(offsets, override=None, extra_front=None, extra_back=None, drop=()):
    """offsets: part -> (dx,dy). override: part -> image (already positioned).
    extra_back/extra_front: images pasted before/after the body."""
    o = blank()
    if extra_back:
        for e in extra_back:
            put(o, e)
    for name in Z:
        if name in drop:
            continue
        img = override.get(name) if override and name in override else PARTS[name]
        dx, dy = offsets.get(name, offsets.get('*', (0, 0)))
        put(o, img, dx, dy)
    if extra_front:
        for e in extra_front:
            put(o, e)
    return o


def body_offsets(dx=0, dy=0, **kw):
    """Uniform upper-body offset, legs stay put unless given."""
    d = {'*': (dx, dy), 'legs': (0, 0)}
    d.update(kw)
    return d


# rest-pose leg key points (procedural legs that match the source stance)
HIP = (73, 96)


def leg_pose(foot_dx, lift, bend=0):
    """Return (hip, knee, ankle) for a foot horizontal offset and lift."""
    hx, hy = HIP
    ankle = (hx + foot_dx, 116 - lift)
    kx = hx + round(foot_dx * 0.45) - round(lift * 0.9) - bend
    ky = hy + 11 - round(lift * 0.6)
    return ((hx, hy), (kx, ky), ankle)


# ================================================================== IDLE
def anim_idle():
    frames = []
    bob = [0, -1, -1, 0]
    for i in range(4):
        b = bob[i]
        hair = PARTS['hair']
        if i == 2:
            hair = shear_rows(hair, 6, 12, lambda y: 1)   # top strands drift back
        hem = shear_rows(PARTS['hem'], 98, 103, lambda y: (1 if i in (1, 2) else 0))
        off = body_offsets(0, b, hair=(0, b - (1 if i == 2 else 0)),
                           bag=(0, b + (1 if i in (1, 2) else 0)), hem=(0, 0), strap=(0, b))
        frames.append(compose(off, override={'hair': hair, 'hem': hem}))
    return frames, [200, 200, 200, 200]


# ================================================================== WALK
def anim_walk():
    A = [-8, -5, -1, 3, 7, 4, 0, -4]
    L = [0, 0, 0, 0, 0, 3, 5, 2]
    bob = [1, 0, -1, 0, 1, 0, -1, 0]
    frames = []
    for i in range(8):
        j = (i + 4) % 8
        legs = legs_image(leg_pose(A[i], L[i]), leg_pose(A[j], L[j]))
        b = bob[i]
        s = [-1, -1, 0, 1, 1, 1, 0, -1][i]
        hem = shear_rows(PARTS['hem'], 92, 103, lambda y: round(s * (y - 92) / 11))
        gdx = round(-A[i] / 4); gdy = abs(A[i]) // 5
        off = body_offsets(0, b, hem=(0, b - 2), legs=(0, 0),
                           baton=(gdx, b + gdy), front_arm=(0, b),
                           back_arm=(round(A[i] / 4), b), bag=(0, b + (1 if i in (1, 5) else 0)))
        # glove follows baton
        fa = PARTS['front_arm']
        glove = blank(); sleeve = blank()
        fp = fa.load(); gp = glove.load(); sp = sleeve.load()
        for y in range(H):
            for x in range(W):
                if fp[x, y][3]:
                    (gp if y >= 63 else sp)[x, y] = fp[x, y]
        front = blank(); put(front, sleeve, 0, b); put(front, glove, gdx, b + gdy)
        frames.append(compose(off, override={'legs': legs, 'hem': hem, 'front_arm': front}))
    return frames, [110] * 8


# ================================================================== RUN
def anim_run():
    A = [-11, -7, -2, 4, 9, 6, 1, -5]
    L = [0, 0, 0, 1, 2, 4, 6, 3]
    bob = [1, 0, -2, -1, 1, 0, -2, -1]
    frames = []
    for i in range(8):
        j = (i + 4) % 8
        legs = legs_image(leg_pose(A[i], L[i], bend=1), leg_pose(A[j], L[j], bend=1))
        b = bob[i]
        trail = [3, 4, 4, 3, 3, 4, 4, 3][i]
        hem = shear_rows(PARTS['hem'], 88, 103, lambda y: round(trail * (y - 88) / 15))
        hair = shear_rows(PARTS['hair'], 6, 14, lambda y: 1 + (1 if i % 4 in (1, 2) else 0))
        gdx = round(-A[i] / 3); gdy = abs(A[i]) // 4
        fa = PARTS['front_arm']
        glove = blank(); sleeve = blank()
        fp = fa.load(); gp = glove.load(); sp = sleeve.load()
        for y in range(H):
            for x in range(W):
                if fp[x, y][3]:
                    (gp if y >= 63 else sp)[x, y] = fp[x, y]
        front = blank(); put(front, sleeve, -1, b); put(front, glove, gdx - 1, b + gdy)
        off = body_offsets(-1, b, head=(-3, b), hair=(-3, b), hem=(0, b - 3),
                           baton=(gdx - 1, b + gdy), front_arm=(0, 0),
                           back_arm=(round(A[i] / 3), b), bag=(1, b + (1 if i in (1, 5) else 0)),
                           strap=(0, b))
        frames.append(compose(off, override={'legs': legs, 'hem': hem, 'front_arm': front, 'hair': hair}))
    return frames, [80] * 8


# ================================================================== ATTACK
def anim_attack():
    SH = (60, 33)
    frames = []
    # (hand, tip, body dx, head dx, hem trail, fx)
    poses = [
        ((70, 47), (93, 23), 1, 1, -1, None),
        ((71, 46), (95, 24), 2, 2, -2, None),
        ((44, 54), (12, 60), -3, -4, 3, 'smear'),
        ((43, 61), (11, 71), -3, -3, 3, 'smear2'),
        ((52, 64), (30, 90), -1, -1, 1, None),
        (None, None, 0, 0, 0, None),
    ]
    for i, (hand, tip, bdx, hdx, trail, fx) in enumerate(poses):
        hem = shear_rows(PARTS['hem'], 88, 103, lambda y: round(trail * (y - 88) / 15))
        off = body_offsets(bdx, 0, head=(hdx, 0), hair=(hdx, 0), hem=(0, 0),
                           back_arm=(bdx, 0), bag=(bdx, 1 if i in (2, 3) else 0), strap=(bdx, 0))
        if i == 2 or i == 3:
            legs = legs_image(leg_pose(-7, 0), leg_pose(4, 0))
        elif i in (0, 1):
            legs = legs_image(leg_pose(-2, 0), leg_pose(3, 0))
        else:
            legs = PARTS['legs']
        override = {'hem': hem, 'legs': legs}
        drop = ()
        extra_front = []
        if hand:
            arm = blank(); draw_arm(arm, (SH[0] + bdx, SH[1]), hand, tip)
            drop = ('front_arm', 'baton')
            if fx == 'smear':
                sm = blank()
                teal_arc(sm, (56, 50), 29, 34, -40, -195, step=1.2)
                teal_arc(sm, (56, 50), 24, 27, -70, -170, white_rim=False, dotted=True, step=2)
                extra_front = [sm, arm]
            elif fx == 'smear2':
                sm = blank()
                teal_arc(sm, (56, 48), 30, 34, -150, -200, white_rim=False, dotted=True, step=2)
                extra_front = [sm, arm]
            else:
                extra_front = [arm]
        frames.append(compose(off, override=override, extra_front=extra_front, drop=drop))
    return frames, [110, 70, 60, 90, 120, 160]


# ================================================================== CAST
def anim_cast():
    import random
    rnd = random.Random(7)
    frames = []
    base_dots = [(rnd.randint(48, 96), rnd.randint(20, 118)) for _ in range(40)]
    for i in range(6):
        hy = [0, 0, -1, -1, -2, -1][i]
        hairdy = [0, -1, -1, -2, -2, -1][i]
        hair = PARTS['hair']
        if i >= 2:
            hair = shear_rows(hair, 6, 14, lambda y: -1)
        off = body_offsets(0, hy, hair=(0, hairdy), legs=(0, 0), hem=(0, 0), bag=(0, hy + 1))
        body = compose(off, override={'hair': hair})
        fx_back, fx_front = blank(), blank()
        # ground circle
        gp = fx_back.load()
        if i >= 1:
            for a in range(0, 360, 6):
                rad = math.radians(a)
                x = 72 + round((18 + i) * math.cos(rad)); y = 121 + round(4 * math.sin(rad))
                if i >= 3 or a % 12 == 0:
                    plot(gp, x, y, FX_TEAL)
        # rising motes
        pts = [(x, y - i * 4) for (x, y) in base_dots[: 6 + i * 6]]
        sparkles(fx_back, pts, plus=(i >= 4))
        if i >= 2:
            ring = ring_image(body, thickness=1 if i < 4 else 2,
                              dotted=(i == 2 or i == 5), inner_col=FX_WHITE if i == 4 else None)
            put(fx_back, ring)
        # emblem flare on chest
        if i >= 3:
            ep = fx_front.load()
            for (x, y) in MASKS['torso']:
                if rig.is_teal(rig.rgb(x, y)):
                    plot(ep, x, y + hy, FX_WHITE if i == 4 else FX_TEAL)
            if i == 4:
                for (x, y) in [(75, 38), (81, 38), (78, 34), (78, 43), (83, 41), (73, 41)]:
                    plot(ep, x, y + hy, FX_TEAL)
        # arm: back hand lifts a little (palm up) during the build
        f = blank(); put(f, fx_back); put(f, body); put(f, fx_front)
        frames.append(f)
    return frames, [120, 120, 120, 120, 160, 200]


# ================================================================== HURT
def anim_hurt():
    frames = []
    f0 = compose(body_offsets(2, 0, head=(3, 1), hair=(3, 1), legs=(0, 0), hem=(1, 0)))
    f1 = compose(body_offsets(4, 0, head=(5, 1), hair=(5, 1), legs=(1, 0), hem=(2, 0),
                              front_arm=(3, 1), baton=(3, 1)))
    # flash: silhouette in FX white
    fl = blank(); fp = fl.load(); sp = f1.load()
    for y in range(H):
        for x in range(W):
            if sp[x, y][3]:
                fp[x, y] = FX_WHITE + (255,)
    # keep dark outline pixels so the flash still reads as her shape
    ring = outline_of(f1, None)
    f2 = compose(body_offsets(2, 0, head=(2, 0), hair=(2, 0), legs=(0, 0), hem=(1, 0)))
    return [f0, fl, f2], [80, 90, 140]


# ================================================================== DEATH
def draw_pool(img, cx, y0, y1, w0, w1, skew=0):
    """New body piece: the coat hem pooling on the ground (flared trapezoid)."""
    p = img.load()
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(y1 - y0, 1)
        w = round(w0 + (w1 - w0) * t)
        c = cx + round(skew * t)
        x0, x1 = c - w // 2, c + w - w // 2 - 1
        for x in range(x0, x1 + 1):
            col = C['coat']
            if x >= x1 - w // 3:
                col = C['coat_dark']
            if x in (x0, x1) or y == y1:
                col = C['coat_out']
            # two soft folds
            if (x - x0) in (w // 4, w // 4 + 1) and y > y0 + 2:
                col = C['coat_dark']
            if (x1 - x) in (w // 5,) and y > y0 + 1:
                col = C['coat_deep']
            plot(p, x, y, col)
    # bottom row outline pass extends 1px under the previous row
    for x in range(cx - w1 // 2, cx + w1 - w1 // 2):
        plot(p, x + round(skew), y1, C['coat_out'])


def lean(img, y_pivot, amount):
    """Forward (left) lean by integer row shear: rows above y_pivot shift left."""
    return shear_rows(img, 0, y_pivot, lambda y: -round(amount * (y_pivot - y) / y_pivot))


def anim_death():
    frames = []
    SH = (60, 33)
    # f0 stagger back
    frames.append(compose(body_offsets(2, 0, head=(3, 1), hair=(3, 1), legs=(0, 0), hem=(1, 0))))
    # f1 knees buckle, torso begins to pitch forward (row-shear lean)
    legs = legs_image(leg_pose(-3, 0, bend=3), leg_pose(4, 0, bend=3))
    arm = blank(); draw_arm(arm, (60, 37), (57, 72), (39, 100))
    f = compose(body_offsets(0, 4, head=(0, 5), hair=(0, 5), legs=(0, 0), hem=(0, 4)),
                override={'legs': legs}, drop=('front_arm', 'baton'), extra_front=[arm])
    frames.append(lean(f, 100, 3))
    # f2 kneel: coat pools on the ground (new hem piece), back boot heel pokes out
    pool = blank(); draw_pool(pool, 71, 99, 121, 30, 46, skew=2)
    heel = blank(); put(heel, BACK_BOOT, 84, 115)
    arm = blank(); draw_arm(arm, (59, 44), (52, 80), (33, 105))
    f = compose(body_offsets(-1, 11, head=(-2, 12), hair=(-2, 12)),
                override={'hem': pool, 'legs': heel}, drop=('front_arm', 'baton', 'strap'),
                extra_front=[arm])
    strap = shifted(PARTS['strap'], -1, 11); f2 = blank(); put(f2, strap); put(f2, f)
    frames.append(lean(f2, 99, 5))
    # f3 slump: head bows, hand to the ground, baton dropped
    pool = blank(); draw_pool(pool, 69, 103, 121, 30, 50, skew=4)
    arm = blank(); draw_arm(arm, (56, 52), (44, 98), None, baton=False)
    baton = blank(); draw_baton(baton, (58, 120), (26, 118))
    f = compose(body_offsets(-3, 15, head=(-7, 21), hair=(-7, 21)),
                override={'hem': pool, 'legs': heel}, drop=('front_arm', 'baton', 'strap'),
                extra_front=[arm])
    strap = shifted(PARTS['strap'], -3, 15); f3 = blank(); put(f3, baton); put(f3, strap); put(f3, f)
    frames.append(lean(f3, 103, 7))
    # f4/f5 fallen: rig rotated 90 deg CCW (integer-exact) -> face down, head to the left
    arm = blank(); draw_arm(arm, SH, (56, 70), None, baton=False)
    stand = compose(body_offsets(0, 0), drop=('front_arm', 'baton'), extra_front=[arm])
    lying = stand.rotate(90, expand=False, resample=Image.NEAREST)
    lying = shifted(lying, 0, 29)
    baton = blank(); draw_baton(baton, (14, 120), (46, 117))
    for k, dy in ((0, -1), (1, 0)):
        f = blank(); put(f, baton); put(f, lying, 0, dy)
        frames.append(f)
    return frames, [90, 100, 130, 160, 220, 400]


# ================================================================== VICTORY
def anim_victory():
    frames = []
    SH = (60, 33)
    spec = [  # dy, hand, tip, legs lift, sparkle
        (2, (54, 52), (30, 30), None, False),
        (-5, (50, 26), (34, 0), 2, False),
        (-3, (50, 24), (34, -2), 0, True),
        (0, (50, 27), (34, 1), None, True),
    ]
    for i, (dy, hand, tip, lift, spark) in enumerate(spec):
        arm = blank(); draw_arm(arm, (SH[0], SH[1] + dy), (hand[0], hand[1] + dy), (tip[0], tip[1] + dy))
        if lift is not None:
            legs = legs_image(leg_pose(-2, lift + 2), leg_pose(2, lift + 2))
            legs = shifted(legs, 0, dy)
        elif i == 0:
            legs = legs_image(leg_pose(-4, 0, bend=2), leg_pose(4, 0, bend=2))
        else:
            legs = PARTS['legs']
        hair = shear_rows(PARTS['hair'], 6, 12, lambda y: (1 if i in (1, 2) else 0))
        hairdy = dy - (1 if i in (2, 3) else 0)
        off = body_offsets(0, dy, hair=(0, hairdy), legs=(0, 0), hem=(0, dy + (1 if i == 1 else 0)),
                           bag=(0, dy + (2 if i == 1 else 1 if i == 2 else 0)))
        fx = blank()
        if spark:
            sparkles(fx, [(tip[0] - 4, tip[1] + dy + 2), (tip[0] + 5, tip[1] + dy - 2),
                          (tip[0] - 1, tip[1] + dy - 6), (tip[0] + 3, tip[1] + dy + 7)], plus=(i == 2))
        frames.append(compose(off, override={'legs': legs, 'hair': hair},
                              drop=('front_arm', 'baton'), extra_front=[arm, fx]))
    return frames, [120, 100, 140, 320]


# ================================================================== EXPORT
ANIMS = [('idle', anim_idle), ('walk', anim_walk), ('run', anim_run), ('attack', anim_attack),
         ('cast', anim_cast), ('hurt', anim_hurt), ('death', anim_death), ('victory', anim_victory)]


def check_palette(img, name):
    p = img.load()
    bad = set()
    for y in range(H):
        for x in range(W):
            if p[x, y][3] and p[x, y][:3] not in ALLOWED:
                bad.add(p[x, y][:3])
            if 0 < p[x, y][3] < 255:
                bad.add(('alpha', p[x, y][3]))
    assert not bad, (name, bad)


def save_gif(frames, durations, path, scale=3):
    # exact-palette GIF: build a global palette from all colours used
    cols = {BG}
    for f in frames:
        p = f.load()
        cols |= {p[x, y][:3] for y in range(H) for x in range(W) if p[x, y][3]}
    cols = sorted(cols)
    assert len(cols) <= 256
    pal = Image.new('P', (1, 1)); flat = [c for col in cols for c in col] + [0] * (768 - 3 * len(cols))
    pal.putpalette(flat)
    idx = {c: i for i, c in enumerate(cols)}
    out = []
    for f in frames:
        bg = Image.new('RGB', (W, H), BG); bg.paste(f, (0, 0), f)
        q = Image.new('P', (W, H)); qp = q.load(); bp = bg.load()
        for y in range(H):
            for x in range(W):
                qp[x, y] = idx[bp[x, y]]
        q.putpalette(flat)
        out.append(q.resize((W * scale, H * scale), Image.NEAREST))
    out[0].save(path, save_all=True, append_images=out[1:], duration=durations, loop=0, disposal=1)


def main():
    meta = {'frame_size': [W, H], 'facing': 'left', 'fx_colors': ['#3fd0c9', '#f1efe8'],
            'animations': {}}
    contact_rows = []
    files = []
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
        contact_rows.append((name, frames))
        print(name, len(frames), 'frames ok')
    # contact sheet
    cs = Image.new('RGB', (W * 8 + 96, H * len(contact_rows)), BG)
    d = ImageDraw.Draw(cs)
    for r, (name, frames) in enumerate(contact_rows):
        d.text((8, r * H + 8), name, fill=(240, 240, 240))
        for k, f in enumerate(frames):
            cs.paste(f, (96 + k * W, r * H), f)
        d.line([(0, r * H), (cs.width, r * H)], fill=(50, 52, 70))
    cp = f'{OUT}/contact_sheet.png'; cs.save(cp); files.append(cp)
    cs.resize((cs.width * 2, cs.height * 2), Image.NEAREST).save(f'{OUT}/contact_sheet_2x.png')
    files.append(f'{OUT}/contact_sheet_2x.png')
    jp = f'{OUT}/animations.json'; json.dump(meta, open(jp, 'w'), indent=1); files.append(jp)
    for extra in ('overlay_4x.png', 'rig.json'):
        files.append(extra)
    with zipfile.ZipFile(f'{OUT}/rhea_animations.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for fp in files:
            z.write(fp, os.path.basename(fp))
    print('zipped', len(files), 'files')


if __name__ == '__main__':
    main()
