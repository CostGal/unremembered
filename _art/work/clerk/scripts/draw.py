# draw.py — procedural pieces: back arm (sleeve + fist), erase boxes, FX
import numpy as np
from common import *

COAT = (53, 42, 59); COAT_SH = (42, 28, 49); COAT_OL = (26, 14, 32); COAT_HI = (59, 51, 65)
SKIN = (227, 169, 132); SKIN_SH = (217, 147, 120); SKIN_HI = (244, 201, 154); SKIN_OL = (201, 103, 103)

def erase_box(frame, x0, x1, y0, y1):
    out = frame.copy(); out[y0:y1+1, x0:x1+1] = 0; return out

def _line_pts(p0, p1):
    x0, y0 = p0; x1, y1 = p1
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    return [(int(round(x0 + (x1 - x0) * t / n)), int(round(y0 + (y1 - y0) * t / n))) for t in range(n + 1)]

def thick_line(layer, p0, p1, w, color):
    r = w // 2
    for x, y in _line_pts(p0, p1):
        for dy in range(-r, w - r):
            for dx in range(-r, w - r):
                X, Y = x + dx, y + dy
                if 0 <= X < N and 0 <= Y < N: layer[Y, X] = (*color, 255)

def back_arm(shoulder, elbow, fist, w=5):
    """Sleeve as two bones with outline + shadow edge. Returns an RGBA layer (no fist)."""
    L = np.zeros((N, N, 4), np.uint8)
    for a, b in ((shoulder, elbow), (elbow, fist)):
        thick_line(L, a, b, w + 2, COAT_OL)
    for a, b in ((shoulder, elbow), (elbow, fist)):
        thick_line(L, a, b, w, COAT)
    # shadow on the lower edge: 1-px line offset down
    for a, b in ((shoulder, elbow), (elbow, fist)):
        thick_line(L, (a[0], a[1] + (w // 2)), (b[0], b[1] + (w // 2)), 1, COAT_SH)
    return L

def fist(center, size=6):
    """Skin fist blob with highlight/shadow."""
    L = np.zeros((N, N, 4), np.uint8)
    cx, cy = center; r = size // 2
    for dy in range(-r, size - r):
        for dx in range(-r, size - r):
            if abs(dx) + abs(dy) > r + 1: continue           # rounded corners
            c = SKIN
            if dx == -r or dy == -r: c = SKIN_HI
            if dx == size - r - 1 or dy == size - r - 1: c = SKIN_SH
            X, Y = cx + dx, cy + dy
            if 0 <= X < N and 0 <= Y < N: L[Y, X] = (*c, 255)
    # outline
    for dy in range(-r - 1, size - r + 1):
        for dx in range(-r - 1, size - r + 1):
            X, Y = cx + dx, cy + dy
            if 0 <= X < N and 0 <= Y < N and L[Y, X, 3] == 0:
                if any(0 <= X+ox < N and 0 <= Y+oy < N and L[Y+oy, X+ox, 3] and (ox or oy) and abs(ox)+abs(oy) == 1 for ox in (-1,0,1) for oy in (-1,0,1)):
                    L[Y, X] = (*SKIN_OL, 255)
    return L

def fx_flash(center, r, core=True):
    """Impact flash: white 4-point star + teal ring points. FX layer."""
    L = np.zeros((N, N, 4), np.uint8); cx, cy = center
    W = (*FX['white'], 255); T = (*FX['teal'], 255)
    def put(x, y, c):
        if 0 <= x < N and 0 <= y < N: L[y, x] = c
    for k in range(-r, r + 1):
        put(cx + k, cy, W); put(cx, cy + k, W)
    for k in range(-r // 2, r // 2 + 1):
        put(cx + k, cy + k, T); put(cx + k, cy - k, T)
    if core:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1): put(cx + dx, cy + dy, W)
    return L

def fx_sparks(center, pts):
    """Scattered teal/white dots at offsets from center."""
    L = np.zeros((N, N, 4), np.uint8); cx, cy = center
    for i, (dx, dy) in enumerate(pts):
        X, Y = cx + dx, cy + dy
        if 0 <= X < N and 0 <= Y < N:
            L[Y, X] = (*(FX['white'] if i % 3 == 0 else FX['teal']), 255)
    return L

def erase_beyond(frame, rows, edge_fn, outline=COAT_OL):
    """Erase everything right of x = edge_fn(y) on `rows` (removes the pixler back arm), then re-outline the edge."""
    out = frame.copy()
    for y in rows:
        xe = int(round(edge_fn(y)))
        out[y, xe + 1:] = 0
        xs = np.where(out[y, :, 3] > 0)[0]
        if len(xs) and xs.max() >= xe - 1:
            out[y, xs.max()] = (*outline, 255)
    return out
