import math, json, os
from rig import *

C = lambda s: np.array(hx(s) + (255,), np.uint8)
# ---------- basic raster ops (integer only) ----------
def blank(): return np.zeros((H, W, 4), np.uint8)

def blit(dst, L, dx=0, dy=0):
    a = L[:, :, 3] > 0
    ys, xs = np.where(a)
    ny, nx = ys + dy, xs + dx
    k = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
    dst[ny[k], nx[k]] = L[ys[k], xs[k]]
    return dst

def shift(L, dx=0, dy=0): return blit(blank(), L, dx, dy)

def shear_rows(L, f):
    """row-wise integer x offset f(y) -> int"""
    out = blank()
    for y in range(H):
        d = int(f(y))
        row = L[y]
        a = row[:, 3] > 0
        xs = np.where(a)[0]; nx = xs + d; k = (nx >= 0) & (nx < W)
        out[y, nx[k]] = row[xs[k]]
    return out

def squash_rows(L, y0, y1, new_h, anchor_bottom=True):
    """nearest-neighbour row drop: rows y0..y1 -> new_h rows; bottom anchored"""
    out = blank()
    n = y1 - y0 + 1
    top = y1 - new_h + 1 if anchor_bottom else y0
    for i in range(new_h):
        src = y0 + int(i * n / new_h)
        out[top + i] = L[src]
    return out

def recolor(L, mapping):
    out = L.copy()
    for s, d in mapping.items():
        m = np.all(L[:, :, :3] == np.array(hx(s)), axis=2) & (L[:, :, 3] > 0)
        out[m] = C(d)
    return out

def alpha(L): return L[:, :, 3] > 0

def dilate4(m, n=1):
    for _ in range(n):
        m2 = m.copy()
        m2[1:] |= m[:-1]; m2[:-1] |= m[1:]; m2[:, 1:] |= m[:, :-1]; m2[:, :-1] |= m[:, 1:]
        m = m2
    return m

def line_pts(x0, y0, x1, y1):
    x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
    pts = []; dx = abs(x1-x0); dy = -abs(y1-y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1: break
        e2 = 2*err
        if e2 >= dy: err += dy; x0 += sx
        if e2 <= dx: err += dx; y0 += sy
    return pts

def put(L, x, y, col):
    if 0 <= x < W and 0 <= y < H: L[y, x] = col

# ---------- legs ----------
LEG = LAYERS['legs']
FAR_MAP = {'353247': '241b39', '322c45': '231937', '29233e': '1b1534', '241b39': '140a28', '231937': '120627',
           '1b1534': '120627', '140a28': '0b0425', '190a2a': '0b0425', '1a0722': '0b0425', '120627': '0b0425'}
LEG_FAR = recolor(LEG, FAR_MAP)
ANK_X, ANK_Y = 75, 116

def draw_leg(dst, ax, ay, hip_x=74, hip_y=94, heel=0, toe=0, dark=False):
    S = LEG_FAR if dark else LEG
    span = max(ay - hip_y, 1)
    # shin: rows 94..115 of stamp, sheared so top of shin reaches the hip
    for y0 in range(94, 116):
        k = ANK_Y - y0
        ox = (ax - ANK_X) + int(round((hip_x - ax) * k / span))
        row = S[y0]; xs = np.where(row[:, 3] > 0)[0]
        for x in xs:
            put(dst, x + ox, ay - k, row[x])
    # foot: rows 116..121, column-wise lift (heel raise / toe raise)
    for y0 in range(116, 122):
        row = S[y0]
        for x in np.where(row[:, 3] > 0)[0]:
            t = (x - 61) / 18.0  # 0 = toe, 1 = heel
            dy = -int(round(heel * t)) - int(round(toe * (1 - t)))
            put(dst, x + ax - ANK_X, y0 + (ay - ANK_Y) + dy, row[x])
    return dst

# ---------- procedural arm + baton ----------
SLV, SLV_SH, SLV_OUT, CUFF = C('1a314a'), C('101d3b'), C('0a0629'), C('0e1c3a')
GLV, GLV_L, GLV_SH = C('594462'), C('645773'), C('473559')
BAT, BAT_HI, BAT_OUT, TIP, TIP_SH = C('12131c'), C('272830'), C('010106'), C('fafbfc'), C('8b96a7')

def draw_arm(dst, sx, sy, hx_, hy_, ang, blen=36, show_baton=True):
    L = blank()
    # sleeve: thick stroke shoulder->wrist
    pts = line_pts(sx, sy, hx_, hy_)
    m = np.zeros((H, W), bool)
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        r = 3 if i < n * 0.55 else 2
        for oy in range(-r, r+1):
            for ox in range(-r, r+1):
                if ox*ox + oy*oy <= r*r + 1 and 0 <= y+oy < H and 0 <= x+ox < W: m[y+oy, x+ox] = True
    vx, vy = hx_ - sx, hy_ - sy
    ys, xs = np.where(m)
    for y, x in zip(ys, xs):
        cross = (x - sx) * vy - (y - sy) * vx
        L[y, x] = SLV_SH if cross > 0 else SLV
    edge = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
    L[edge] = SLV_OUT
    # baton
    B = blank()
    if show_baton:
        dx, dy = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        bp = line_pts(hx_ - 3*dx, hy_ - 3*dy, hx_ + blen*dx, hy_ + blen*dy)
        bm = np.zeros((H, W), bool)
        for x, y in bp:
            for ox, oy in ((0,0),(1,0),(-1,0),(0,1),(0,-1)):
                if 0 <= y+oy < H and 0 <= x+ox < W: bm[y+oy, x+ox] = True
        bm2 = dilate4(bm, 0)
        B[bm] = BAT_OUT
        for i, (x, y) in enumerate(bp):
            if 0 <= y < H and 0 <= x < W:
                if i >= len(bp) - 6: B[y, x] = TIP if i < len(bp) - 1 else TIP_SH
                else: B[y, x] = BAT_HI if i % 5 == 2 else BAT
    # glove at hand
    G = blank()
    gm = np.zeros((H, W), bool)
    for oy in range(-2, 3):
        for ox in range(-2, 3):
            if abs(ox) + abs(oy) <= 3 and 0 <= hy_+oy < H and 0 <= hx_+ox < W: gm[hy_+oy, hx_+ox] = True
    G[gm] = GLV
    ge = gm & ~(np.roll(gm, 1, 0) & np.roll(gm, -1, 0) & np.roll(gm, 1, 1) & np.roll(gm, -1, 1))
    G[ge] = SLV_OUT
    put(G, hx_ - 1, hy_ - 1, GLV_L); put(G, hx_ + 1, hy_ + 1, GLV_SH)
    blit(dst, L); blit(dst, B); blit(dst, G)
    return dst

# ---------- FX ----------
TEAL, WHITE = C('3fd0c9'), C('f1efe8')

def aura(frame, rings, dither_outer=False, phase=0):
    """rings: list of colors from inside out. drawn behind the sprite."""
    sil = alpha(frame)
    out = blank(); prev = sil
    for i, col in enumerate(rings):
        d = dilate4(prev, 1)
        ring = d & ~prev
        if dither_outer and i == len(rings) - 1:
            ring &= ((YY + XX + phase) % 2 == 0)
        out[ring] = col
        prev = d
    blit(out, frame)
    return out

def sparkle(dst, x, y, size, col=None):
    col = WHITE if col is None else col
    put(dst, x, y, col)
    for i in range(1, size + 1):
        c = col if i < size else TEAL
        for ox, oy in ((i,0),(-i,0),(0,i),(0,-i)): put(dst, x+ox, y+oy, c)

def smear(dst, cx, cy, r_in, a_trail, a_lead, wmax, bright=True):
    """crescent swept from a_trail to a_lead (decreasing screen angle = over the top toward the front),
    thin at the trailing end, thick at the leading end."""
    span = (a_trail - a_lead) % 360
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            r = math.hypot(dx, dy)
            th = math.degrees(math.atan2(dy, dx))
            t = (a_trail - th) % 360
            if t > span: continue
            f = t / span
            w = 1 + (wmax - 1) * f * f
            if r_in <= r <= r_in + w:
                inner = (r - r_in) < w * 0.45
                dst[y, x] = WHITE if (bright and inner and f > 0.45) else TEAL
    return dst

# ---------- body composition ----------
def body(dst=None, up_dy=0, up_dx=0, head_dx=0, head_dy=0, tuft=(0, 0), torso_shear=None, coat_dx=0, coat_dy=0,
         hem_shear=None, hem_dy=0, bag=(0, 0), back=(0, 0), legs='stand', leg_args=None, arm='cut', arm_dxy=(0, 0),
         arm_args=None, arm_behind_head=False, draw_bag=True, legs_dy=0):
    F = blank() if dst is None else dst
    # legs
    if legs == 'stand':
        blit(F, LEG, 0, legs_dy)
    elif legs == 'pose':
        (na, fa) = leg_args
        draw_leg(F, *fa, dark=True)
        draw_leg(F, *na)
    hem = LAYERS['hem']
    if hem_shear: hem = shear_rows(hem, hem_shear)
    blit(F, hem, coat_dx, coat_dy + hem_dy)
    blit(F, LAYERS['coat'], coat_dx, coat_dy)
    torso = LAYERS['torso']
    if torso_shear: torso = shear_rows(torso, torso_shear)
    blit(F, torso, up_dx, up_dy)
    if draw_bag: blit(F, LAYERS['bag'], up_dx + bag[0], up_dy + bag[1])
    blit(F, LAYERS['back_arm'], up_dx + back[0], up_dy + back[1])
    if arm == 'proc' and arm_behind_head:
        draw_arm(F, *arm_args)
    blit(F, LAYERS['head_base'], up_dx + head_dx, up_dy + head_dy)
    blit(F, LAYERS['hair_tuft'], up_dx + head_dx + tuft[0], up_dy + head_dy + tuft[1])
    if arm == 'cut':
        blit(F, LAYERS['front_arm'], up_dx + arm_dxy[0], up_dy + arm_dxy[1])
    elif arm == 'proc' and not arm_behind_head:
        draw_arm(F, *arm_args)
    return F

def lean_shear(amount, y_top=24, y_bot=60):
    # stepped lean: top rows move by -amount, bottom rows 0 (integer steps)
    return lambda y: -int(round(amount * max(0, min(1, (y_bot - y) / (y_bot - y_top)))))

def hem_sway(s):
    return lambda y: int(round(s * max(0, y - 92) / 11.0))

# ================= ANIMATIONS =================
def anim_idle():
    fr = []
    ups = [0, 0, 1, 1]; tufts = [(0, 0), (1, 0), (1, 0), (0, 0)]; sway = [0, 1, 1, 0]
    for i in range(4):
        fr.append(body(up_dy=ups[i], tuft=tufts[i], hem_shear=hem_sway(sway[i]),
                       bag=(0, 1 if i == 3 else 0)))
    return fr

def anim_walk():
    # (near, far) leg args: (ax, ay, hip_x, hip_y, heel, toe)
    cyc = [((66, 116, 72, 94, 0, 2), (84, 116, 76, 94, 4, 0)),   # contact
           ((69, 116, 73, 95, 0, 0), (81, 114, 75, 95, 4, 0)),   # down
           ((73, 116, 74, 94, 0, 0), (77, 111, 74, 94, 1, 0)),   # passing
           ((78, 116, 75, 93, 2, 0), (71, 113, 73, 93, 0, 1))]   # up
    cyc = cyc + [(f, n) for (n, f) in cyc]
    bob = [0, 1, 0, -1] * 2
    arm = [-2, -1, 0, 1, 2, 1, 0, -1]
    sway = [-1, 0, 1, 1, 1, 0, -1, -1]
    fr = []
    for i in range(8):
        b = bob[i]
        fr.append(body(up_dy=b, coat_dy=b, legs='pose', leg_args=cyc[i], arm_dxy=(arm[i], 0),
                       back=(-arm[i] // 2, 0), tuft=(1 if b < 0 else 0, 0), bag=(0, bob[(i - 1) % 8] - b),
                       hem_shear=hem_sway(sway[i])))
    return fr

def anim_run():
    cyc = [((60, 116, 70, 94, 0, 3), (90, 110, 78, 94, 5, 0)),   # contact
           ((66, 116, 71, 95, 0, 0), (84, 106, 76, 95, 2, 0)),   # down/compress
           ((74, 114, 73, 93, 3, 0), (74, 104, 72, 93, 0, 0)),   # push-off
           ((84, 110, 76, 92, 5, 0), (64, 108, 70, 92, 0, 2))]   # flight
    cyc = cyc + [(f, n) for (n, f) in cyc]
    bob = [0, 2, 0, -2] * 2
    arm = [-4, -2, 1, 3, 4, 2, -1, -3]
    fr = []
    for i in range(8):
        b = bob[i]
        fr.append(body(up_dy=b, up_dx=-2, head_dx=-2, coat_dy=b, coat_dx=-1, legs='pose', leg_args=cyc[i],
                       torso_shear=lean_shear(3), arm_dxy=(arm[i], 0), back=(-arm[i] // 2, 0),
                       tuft=(2, -1 if b < 0 else 0), bag=(1, bob[(i - 1) % 8] - b),
                       hem_shear=lambda y, i=i: int(round((0.40 + 0.05 * (i % 2)) * max(0, y - 86))),
                       hem_dy=-1 if b < 0 else 0))
    return fr

SH = (64, 38)  # shoulder of baton arm
STANCE = ((68, 116, 72, 94, 0, 1), (80, 116, 76, 94, 1, 0))
LUNGE = ((62, 116, 70, 95, 0, 1), (86, 116, 77, 95, 4, 0))

def anim_attack():
    fr = []
    # 0 anticipation: crouch, arm starts back
    fr.append(body(up_dy=1, coat_dy=1, legs='pose', leg_args=STANCE, arm='proc',
                   arm_args=(SH[0], SH[1] + 1, 62, 58, 115)))
    # 1 windup: baton raised behind head
    fr.append(body(up_dy=1, up_dx=1, coat_dy=1, legs='pose', leg_args=STANCE, arm='proc', arm_behind_head=True,
                   torso_shear=lambda y: int(round(1.5 * max(0, (60 - y) / 36))), tuft=(1, 0),
                   arm_args=(SH[0] + 2, SH[1] + 1, 80, 7, 25)))
    # 2 strike: lunge, baton forward, big smear
    F = blank()
    smear(F, SH[0] - 3, SH[1] + 1, 38, -75, 160, 10)
    body(F, up_dx=-3, head_dx=-1, coat_dx=-1, up_dy=1, coat_dy=1, legs='pose', leg_args=LUNGE, arm='proc',
         torso_shear=lean_shear(2), tuft=(2, 0), hem_shear=hem_sway(2),
         arm_args=(SH[0] - 3, SH[1] + 1, 40, 50, 165))
    fr.append(F)
    # 3 follow-through: smear fading, baton down-forward
    F = blank()
    smear(F, SH[0] - 3, SH[1] + 2, 36, 200, 140, 4, bright=False)
    body(F, up_dx=-3, head_dx=-1, coat_dx=-1, up_dy=2, coat_dy=1, legs='pose', leg_args=LUNGE, arm='proc',
         torso_shear=lean_shear(2), tuft=(1, 0), hem_shear=hem_sway(1),
         arm_args=(SH[0] - 3, SH[1] + 2, 46, 60, 135))
    fr.append(F)
    # 4 recover
    fr.append(body(up_dx=-1, up_dy=1, coat_dy=1, legs='pose', leg_args=STANCE, arm='proc', tuft=(1, 0),
                   hem_shear=hem_sway(1), arm_args=(SH[0] - 1, SH[1] + 1, 54, 64, 122)))
    # 5 settle = rest pose
    fr.append(body())
    return fr

GEM = MASKS['torso'] & (CLS == 'teal')

def anim_cast():
    fr = []
    motes = [(52, 100), (90, 96), (60, 80), (96, 70), (46, 60), (88, 40), (56, 30), (98, 20)]
    arm_poses = [(56, 66, 124), (54, 52, 175), (55, 44, -95), (55, 44, -95), (55, 43, -95), (55, 43, -95)]
    for i in range(6):
        hx_, hy_, ang = arm_poses[i]
        F = body(up_dy=0 if i < 2 else -1 if i > 3 else 0, coat_dy=0, tuft=(1 if i >= 3 else 0, -1 if i >= 3 else 0),
                 hem_shear=hem_sway([0, 0, 1, -1, 1, -1][i]), arm='proc',
                 arm_args=(SH[0], SH[1] + (0 if i < 4 else -1), hx_, hy_, ang))
        # gem charges up
        if i >= 1:
            g = np.where(GEM); dy = 0 if i < 4 else -1
            for y, x in zip(*g): put(F, x, y + dy, WHITE if i >= 3 else TEAL)
        if i == 0: G = F
        elif i == 1: G = aura(F, [TEAL], dither_outer=True, phase=0)
        elif i == 2: G = aura(F, [TEAL], dither_outer=False)
        elif i == 3: G = aura(F, [TEAL, TEAL], dither_outer=True, phase=1)
        elif i == 4: G = aura(F, [TEAL, TEAL, TEAL], dither_outer=True, phase=0)
        else: G = aura(F, [WHITE, TEAL, TEAL], dither_outer=True, phase=1)
        # rising motes
        for j, (mx, my) in enumerate(motes[:2 + i]):
            yy = my - i * 6 - (j % 3) * 2
            if 0 <= yy < H and not alpha(G)[yy, mx]:
                put(G, mx, yy, TEAL if (i + j) % 2 else WHITE)
        # baton tip star
        tipx = int(round(hx_ + 36 * math.cos(math.radians(ang))))
        tipy = int(round(hy_ + 36 * math.sin(math.radians(ang))))
        if i >= 2: sparkle(G, tipx, tipy, [0, 0, 1, 1, 2, 3][i])
        fr.append(G)
    return fr

def flash(L):
    """hit flash: interior -> #f1efe8, outer silhouette outline kept"""
    out = L.copy(); a = alpha(L)
    inner = a & np.roll(a, 1, 0) & np.roll(a, -1, 0) & np.roll(a, 1, 1) & np.roll(a, -1, 1)
    out[inner] = WHITE
    return out

def hurt_pose(k=1.0):
    return body(up_dx=int(3*k), head_dx=int(2*k), head_dy=int(1*k), coat_dx=int(2*k), legs='pose',
                leg_args=((66, 116, 73, 94, 0, 2), (82, 116, 77, 94, 2, 0)),
                torso_shear=lambda y: int(round(2*k*max(0, (60 - y) / 36))), tuft=(1, 1), arm_dxy=(-2, -2),
                hem_shear=hem_sway(-2*k), bag=(1, -1))

def anim_hurt():
    return [flash(hurt_pose(1.0)), hurt_pose(1.0), hurt_pose(0.34)]

def standing_no_baton_bag():
    F = body(arm='cut', draw_bag=False)
    F[MASKS['baton']] = 0
    return F

def lying():
    S = standing_no_baton_bag()
    R = np.rot90(S, k=-1).copy()   # clockwise: head -> right, face up (lossless)
    a = alpha(R); ys, xs = np.where(a)
    R = shift(R, -xs.min() + 4, 121 - ys.max())
    return R

def anim_death():
    fr = []
    fr.append(hurt_pose(1.0))
    # buckle: knees give, upper body drops, head drops
    fr.append(body(up_dx=2, up_dy=5, coat_dy=5, coat_dx=1, head_dy=1, legs='pose',
                   leg_args=((68, 116, 72, 99, 0, 0), (82, 116, 77, 99, 3, 0)), arm_dxy=(-1, 0),
                   hem_shear=hem_sway(-1), bag=(0, 1), tuft=(0, 1)))
    # kneel: coat squashed and pooled, leaning on the planted baton
    F = blank()
    draw_leg(F, 90, 121, 84, 110, heel=5, dark=True)   # back foot, toe planted
    draw_leg(F, 64, 116, 68, 104, 0, 0)                # front foot
    coatfull = blank(); blit(coatfull, LAYERS['hem']); blit(coatfull, LAYERS['coat'])
    sq = squash_rows(coatfull, 60, 103, 30)
    blit(F, sq, 0, 16)
    up = blank(); blit(up, LAYERS['torso']); blit(up, LAYERS['bag']); blit(up, LAYERS['back_arm'])
    blit(up, LAYERS['head_base'], -1, 2); blit(up, LAYERS['hair_tuft'], -1, 3)
    blit(F, up, -1, 30)
    draw_arm(F, SH[0] - 1, SH[1] + 30, 52, 92, 95, blen=26)
    fr.append(F)
    # topple backward: kneel frame leaned back with stepped shear, baton slipping
    G = blank(); blit(G, F)
    G = shear_rows(G, lambda y: int(round(10 * max(0, (116 - y) / 80) ** 1.5)))
    G = shift(G, 2, 1)
    fr.append(G)
    # impact: lying, dust puffs, dropped baton
    Lr = lying()
    def ground_baton(D, x0):
        bp = line_pts(x0, 119, x0 + 34, 117)
        for x, y in bp:
            for ox, oy in ((0,0),(0,1),(0,-1)): put(D, x+ox, y+oy, BAT_OUT)
        for i, (x, y) in enumerate(bp):
            put(D, x, y, TIP if i < 5 else BAT)
    D = blank(); ground_baton(D, 8); blit(D, shift(Lr, 0, -2))
    for (x, y, s) in [(20, 118, 1), (108, 116, 1), (60, 120, 0), (116, 119, 0)]:
        sparkle(D, x, y, s, WHITE)
    fr.append(D)
    D = blank(); ground_baton(D, 8); blit(D, Lr)
    fr.append(D)
    return fr

def anim_victory():
    fr = []
    bobs = [0, -1, -1, 0]
    for i in range(4):
        b = bobs[i]
        F = body(up_dy=b, coat_dy=0, tuft=(1 if i in (1, 2) else 0, -1 if i == 1 else 0), arm='proc',
                 hem_shear=hem_sway([0, 1, 0, -1][i]), bag=(0, 1 if i == 2 else 0),
                 arm_args=(SH[0], SH[1] + b, 56, 26 + b - (1 if i in (1, 2) else 0), -145))
        tipx = int(round(56 + 36 * math.cos(math.radians(-145))))
        tipy = int(round(26 + b - (1 if i in (1, 2) else 0) + 36 * math.sin(math.radians(-145))))
        if i == 1: sparkle(F, tipx - 1, tipy - 1, 1)
        if i == 2: sparkle(F, tipx - 1, tipy - 1, 2)
        fr.append(F)
    return fr

ANIMS = {
    'idle': (anim_idle, [220, 200, 220, 200]),
    'walk': (anim_walk, [110] * 8),
    'run': (anim_run, [75] * 8),
    'attack': (anim_attack, [110, 160, 70, 90, 110, 160]),
    'cast': (anim_cast, [110, 100, 100, 90, 90, 140]),
    'hurt': (anim_hurt, [60, 130, 160]),
    'death': (anim_death, [110, 120, 220, 90, 140, 900]),
    'victory': (anim_victory, [180, 160, 160, 180]),
}

# ================= DEATH v2 (improvement pass) =================
def flare_bottom(L, y_from, y_to, left, right):
    """spread the bottom rows sideways by copying edge pixels outward (coat pooling on the floor)."""
    out = L.copy()
    for y in range(y_from, y_to + 1):
        t = (y - y_from) / max(1, (y_to - y_from))
        xs = np.where(L[y, :, 3] > 0)[0]
        if len(xs) == 0: continue
        x0, x1 = xs.min(), xs.max()
        nl, nr = int(round(left * t)), int(round(right * t))
        for k in range(1, nl + 1): put(out, x0 - k, y, L[y, x0 + 1])
        for k in range(1, nr + 1): put(out, x1 + k, y, L[y, x1 - 1])
        put(out, x0 - nl, y, L[y, x0]); put(out, x1 + nr, y, L[y, x1])
    return out

def kneel_frame(drop=34, lean=-3, head=(-2, 3)):
    F = blank()
    draw_leg(F, 92, 121, 84, 108, heel=6, dark=True)             # back foot: toe planted, heel up
    coatfull = blank(); blit(coatfull, LAYERS['hem']); blit(coatfull, LAYERS['coat'])
    sq = squash_rows(coatfull, 60, 103, 103 - 60 + 1 - drop + 16)  # coat shortened, bottom at ground
    sq = shift(sq, 0, 121 - 103 - 1)
    sq = flare_bottom(sq, 112, 120, 5, 6)
    blit(F, sq)
    up = blank(); blit(up, shear_rows(LAYERS['torso'], lean_shear(-lean))); blit(up, LAYERS['bag'], 0, 1)
    blit(up, LAYERS['back_arm'])
    blit(up, LAYERS['head_base'], head[0], head[1]); blit(up, LAYERS['hair_tuft'], head[0], head[1] + 1)
    blit(F, up, 0, drop)
    # front knee raised under the coat: shin + boot in front of the hem
    draw_leg(F, 58, 116, 60, 104, 0, 0)
    draw_arm(F, SH[0] + lean, SH[1] + drop, 50, 96, 97, blen=22)  # leaning on planted baton
    return F

def lying_v2():
    S = body(arm='cut', draw_bag=False)
    S[MASKS['baton']] = 0
    R = np.rot90(S, k=-1).copy()          # lossless 90deg: head right, face up
    a = alpha(R); ys, xs = np.where(a)
    dx, dy = -xs.min() + 4, 121 - ys.max()
    R = shift(R, dx, dy)
    # slump: let the chest/head end settle 1-2px lower and the legs sag -> less plank-like
    R = np.stack([R[:, :, c] for c in range(4)], 2)
    out = blank()
    for x in range(W):
        col = R[:, x]
        sag = 2 if x > 96 else 1 if x > 70 else 0
        if x < 24: sag = 1
        ys = np.where(col[:, 3] > 0)[0]
        for y in ys:
            ny = min(121, y + sag)
            out[ny, x] = col[y]
    # the satchel slid off and rests upright on the floor behind her
    base = blank(); blit(base, LAYERS['bag'], -20, 108 - 77); blit(base, out)
    return base

def tilt_columns(L, pivot_x, rise_per_px, ground=121):
    """vertical shear: columns right of pivot lifted -> body falling diagonally (integer column offsets)."""
    out = blank()
    for x in range(W):
        d = -int(round(max(0, x - pivot_x) * rise_per_px))
        col = L[:, x]; ys = np.where(col[:, 3] > 0)[0]
        for y in ys:
            if 0 <= y + d < H: out[y + d, x] = col[y]
    return out

def ground_baton(D, x0, y0=119):
    bp = line_pts(x0, y0, x0 + 34, y0 - 2)
    for x, y in bp:
        for ox, oy in ((0, 0), (0, 1), (0, -1)): put(D, x + ox, y + oy, BAT_OUT)
    for i, (x, y) in enumerate(bp):
        put(D, x, y, TIP if i < 5 else BAT)

def anim_death_v2():
    fr = [hurt_pose(1.0)]
    # buckle: knees give, head drops, baton tip swings down to the floor
    fr.append(body(up_dx=1, up_dy=8, coat_dy=8, head_dy=2, head_dx=-1, legs='pose',
                   leg_args=((64, 116, 70, 104, 0, 0), (86, 116, 78, 104, 5, 0)), arm='proc',
                   arm_args=(SH[0] + 1, SH[1] + 8, 54, 78, 105, 36),
                   hem_shear=hem_sway(-2), bag=(0, 2), tuft=(0, 1)))
    fr.append(kneel_frame())
    # topple back: lying pose lifted on the head side (column shear), baton falling
    Lr = lying_v2()
    T = tilt_columns(Lr, 20, 0.55)
    D = blank(); ground_baton(D, 10); blit(D, T)
    fr.append(D)
    # impact: dust puffs, 1px bounce
    D = blank(); ground_baton(D, 8); blit(D, shift(Lr, 0, -1))
    for (x, y, s) in [(16, 119, 1), (104, 118, 1), (122, 117, 0), (58, 120, 0)]:
        sparkle(D, x, y, s, WHITE)
    fr.append(D)
    D = blank(); ground_baton(D, 8); blit(D, Lr)
    fr.append(D)
    return fr

ANIMS['death'] = (anim_death_v2, [110, 120, 240, 80, 140, 900])
