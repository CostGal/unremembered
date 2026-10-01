import numpy as np
from PIL import Image
from collections import deque

SRC = np.array(Image.open('/home/claude/rhea.png').convert('RGBA'))
H = W = 128
OP = SRC[:, :, 3] > 0
PALETTE = sorted({tuple(int(v) for v in SRC[y, x, :3]) for y in range(H) for x in range(W) if OP[y, x]})
FX_TEAL = (0x3f, 0xd0, 0xc9)
FX_WHITE = (0xf1, 0xef, 0xe8)

def hx(s): s = s.lstrip('#'); return tuple(int(s[i:i+2], 16) for i in (0, 2, 4))

def lum(c): return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]

def cls(y, x):
    r, g, b = [int(v) for v in SRC[y, x, :3]]
    import colorsys
    h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)
    if g > 200 and r < 120: return 'teal'
    if l > 0.8 and b >= r: return 'white'
    if r > 200 and g > 150: return 'skin'
    if r > 180: return 'red'
    if 0.05 < h < 0.15 and l > 0.2: return 'brown'
    if b > 150 and l > 0.5: return 'hairshade'
    if l < 0.06: return 'outline'
    if r > g and r > b and r > 40: return 'maroon'
    if abs(r - b) < 25 and l > 0.25: return 'grey'
    if r > 70 and b > 90: return 'purple'
    if b > g and g > r*1.3 and l > 0.1: return 'coat'
    return 'dark'

YY, XX = np.mgrid[0:H, 0:W]
CLS = np.empty((H, W), dtype=object)
for y in range(H):
    for x in range(W):
        CLS[y, x] = cls(y, x) if OP[y, x] else None

def seam(y):  # inner seam between baton-arm sleeve and coat body
    return 65 - (y - 36) * 5 / 26.0

def coat_right_edge(y):  # coat body edge hidden under the bag
    return 81 + (y - 53) * 2 / 25.0

def build_masks():
    m = {}
    head = OP & ((YY <= 23) | ((YY == 24) & np.isin(CLS, ['skin', 'red'])))
    hair = head & np.isin(CLS, ['white', 'hairshade'])
    # small detached hair pixels around face that are hair colored count as hair; tuft = back hair that sways
    tuft = hair & (XX >= 77) & (YY >= 14)
    m['head'] = head
    m['hair_tuft'] = tuft
    legs = OP & (YY >= 104)
    m['legs'] = legs
    front = OP & (((XX <= 58) & (YY >= 62) & (YY <= 70)) | ((XX <= 55) & (YY > 70)) |
                  ((YY >= 36) & (YY <= 62) & (XX < np.vectorize(seam)(YY).astype(float)) & (XX <= 66)))
    front &= ~head
    m['front_arm'] = front
    baton = front & (YY >= 63) & ~((XX >= 53) & (YY <= 70))
    m['baton'] = baton
    back = OP & (XX >= 69) & (XX <= 78) & (YY >= 62) & (YY <= 73) & np.isin(CLS, ['grey', 'dark', 'white', 'outline', 'purple', 'hairshade'])
    # keep only the glove blob: bounded region where grey dominates
    back &= ~((XX >= 77) & ~np.isin(CLS, ['grey', 'white']))
    m['back_arm'] = back
    bag = OP & (YY >= 53) & (YY <= 77) & np.isin(CLS, ['brown', 'maroon', 'outline', 'dark', 'grey', 'white', 'hairshade', 'purple'])
    bag &= (XX >= 77) | ((YY >= 71) & (XX >= 69))
    bag &= ~back & ~front
    m['bag'] = bag
    rest = OP & ~head & ~legs & ~front & ~back & ~bag
    m['torso'] = rest & (YY < 60)
    m['coat'] = rest & (YY >= 60) & (YY < 90)
    m['hem'] = rest & (YY >= 90)
    return m

MASKS = build_masks()

def layer_from_mask(mask):
    L = np.zeros((H, W, 4), np.uint8)
    L[mask] = SRC[mask]
    return L

def bfs_fill(L, fillmask):
    """Fill transparent pixels inside fillmask by copying the nearest opaque pixel of L (palette-preserving)."""
    L = L.copy()
    q = deque()
    have = L[:, :, 3] > 0
    for y, x in zip(*np.where(have)):
        q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ny, nx = y+dy, x+dx
            if 0 <= ny < H and 0 <= nx < W and fillmask[ny, nx] and L[ny, nx, 3] == 0:
                L[ny, nx] = L[y, x]
                q.append((ny, nx))
    return L

def build_layers():
    Ls = {k: layer_from_mask(v) for k, v in MASKS.items()}
    # --- body fill: behind sleeve, back hand, bag, head, and underlap between torso/coat/hem
    body_fill = np.zeros((H, W), bool)
    sv = np.vectorize(seam)(YY)
    body_fill |= (YY >= 36) & (YY <= 62) & (XX >= np.ceil(sv) - 2) & (XX < sv)
    body_fill |= MASKS['back_arm']
    ce = np.vectorize(coat_right_edge)(YY)
    body_fill |= MASKS['bag'] & (XX <= ce) & (YY < 78)
    body_fill |= (YY >= 20) & (YY <= 24) & (XX >= 66) & (XX <= 75)  # neck/collar under head
    body_fill &= ~OP | MASKS['bag'] | MASKS['back_arm'] | MASKS['front_arm'] | MASKS['head']
    # torso
    tf = body_fill & (YY < 60)
    Ls['torso'] = bfs_fill(Ls['torso'], tf)
    # coat underlay extends 3 rows up under torso; hem underlay 3 rows up under coat
    coat_fill = (body_fill & (YY >= 60) & (YY < 90)) | ((YY >= 56) & (YY < 60) & (MASKS['torso'] | tf))
    Ls['coat'] = bfs_fill(Ls['coat'], coat_fill)
    hem_fill = (YY >= 86) & (YY < 90) & MASKS['coat']
    Ls['hem'] = bfs_fill(Ls['hem'], hem_fill)
    # re-outline filled edges of body layers where they meet transparency on the outer silhouette
    OUT = np.array(hx('0e1c3a') + (255,), np.uint8)
    for k in ('torso', 'coat'):
        L = Ls[k]
        newpx = (L[:, :, 3] > 0) & ~MASKS[k]
        a = L[:, :, 3] > 0
        edge = np.zeros_like(a)
        edge[:, 1:] |= ~a[:, :-1]; edge[:, :-1] |= ~a[:, 1:]
        L[newpx & edge & a] = OUT
    # legs: extend boot shaft up under the hem so bobbing never shows a gap
    leg_fill = (YY >= 96) & (YY < 104) & (XX >= 71) & (XX <= 78)
    Ls['legs'] = bfs_fill(Ls['legs'], leg_fill)
    # head: nothing hidden. hair tuft is a sub-layer; head layer minus tuft keeps tuft underlay
    Ls['head_base'] = Ls['head'].copy()
    Ls['head_base'][MASKS['hair_tuft']] = SRC[MASKS['hair_tuft']]  # tuft drawn separately on top
    Ls['hair_tuft'] = layer_from_mask(MASKS['hair_tuft'])
    Ls['arm_nobaton'] = Ls['front_arm'].copy(); Ls['arm_nobaton'][MASKS['baton']] = 0
    return Ls

LAYERS = build_layers()

PIVOTS = {
    'head': (70, 23), 'hair_tuft': (78, 15), 'torso': (71, 59), 'coat': (71, 89), 'hem': (72, 90),
    'legs': (74, 103), 'front_arm': (64, 38), 'baton': (56, 66), 'back_arm': (75, 34), 'bag': (80, 30),
}
DRAW_ORDER = ['legs', 'hem', 'coat', 'torso', 'bag', 'back_arm', 'head', 'front_arm']
