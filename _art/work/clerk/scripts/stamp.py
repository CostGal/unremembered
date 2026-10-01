# stamp.py — the Clerk's brass stamp: procedural prop, fixed size, palette colors only.
# Not in the pixler sprites. Drawn attached to the free (back) fist, handle inside the fist,
# plate continuing the forearm line. Grip point = top-center of the fist.
import numpy as np
from common import *

# colors sampled from the rest palette (ledger highlights = brass, leather = handle)
B_HI = (249, 213, 154)   # brass highlight
B_MID = (227, 164, 122)  # brass
B_DK = (116, 52, 44)     # brass shadow / plate edge
H_LT = (122, 55, 45)     # handle highlight
H_MD = (108, 45, 39)     # handle wood
H_DK = (41, 11, 7)       # handle shadow / outline
GOLD = (248, 182, 3)     # 1-px glint (the coat button color)

_UP = [  # plate at top, grip (handle) at bottom; 9 x 11
    '.BBBBBBB.',
    'bMMMMMMMg',
    'bMMMMMMMM',
    '.DDDDDDD.',
    '...mMm...',
    '...lHd...',
    '...lHd...',
    '...lHd...',
    '...lHd...',
    '..lHHHd..',
    '..dddddd.',
]
_MAP = {'B': B_HI, 'M': B_MID, 'm': B_MID, 'D': B_DK, 'b': B_DK, 'g': GOLD,
        'H': H_MD, 'l': H_LT, 'd': H_DK}
GRIP_UP = (4, 6)   # pixel of the sprite that sits on the fist top-center (handle enters the fist here)

def _render(rows):
    h, w = len(rows), len(rows[0])
    a = np.zeros((h, w, 4), np.uint8)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.': a[y, x] = (*_MAP[ch], 255)
    return a

def stamp_sprite(direction):
    """direction = where the PLATE points: 'up','down','left','right' (left = forward, the game faces left).
    Returns (rgba, grip_xy) with grip = the pixel that goes on the fist top-center."""
    up = _render(_UP); gx, gy = GRIP_UP
    if direction == 'up':    return up, (gx, gy)
    if direction == 'down':  a = up[::-1].copy();              return a, (gx, up.shape[0]-1-gy)
    if direction == 'left':  a = np.rot90(up, 1).copy();       return a, (gy, up.shape[1]-1-gx)   # rot90 ccw: (x,y)->(y, w-1-x)
    if direction == 'right': a = np.rot90(up, -1).copy();      return a, (up.shape[0]-1-gy, gx)   # rot90 cw: (x,y)->(h-1-y, x)
    raise ValueError(direction)

def place_stamp(direction, anchor):
    """Full 128x128 layer with the stamp placed so its grip pixel == anchor (x, y)."""
    spr, (gx, gy) = stamp_sprite(direction)
    layer = np.zeros((N, N, 4), np.uint8)
    x0, y0 = anchor[0] - gx, anchor[1] - gy
    h, w = spr.shape[:2]
    for y in range(h):
        for x in range(w):
            X, Y = x0 + x, y0 + y
            if 0 <= X < N and 0 <= Y < N and spr[y, x, 3]:
                layer[Y, X] = spr[y, x]
    return layer

def find_back_fist(frame, xmin=84):
    """Bbox of skin pixels on the back-hand side (x >= xmin), i.e. the free fist. None if in the pocket."""
    a = frame[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    skin = (frame[..., 3] > 0) & (r >= 200) & (g >= 120) & (g <= 200) & (r > b + 40)
    skin[:, :xmin] = False
    ys, xs = np.where(skin)
    if len(xs) < 6: return None
    return xs.min(), xs.max(), ys.min(), ys.max()

def unglow(frame, mask, to=None):
    """Repaint pixler-tinted fist pixels back to the hand colors (nearest palette skin tone)."""
    out = frame.copy()
    if to is None: to = (227, 169, 132)
    out[mask] = (*to, 255)
    return out
