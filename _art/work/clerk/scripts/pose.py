# pose.py — derived poses from the rig (integer ops only)
import numpy as np
from common import *
from rig import rig, Z, REST

PARTS, IMGS = rig()

def col_shear(a, cols, fn):
    """Shift each column x in `cols` by int(fn(x)) px in y. Exact (transpose of row_shear)."""
    out = a.copy()
    for x in cols:
        d = int(round(fn(x)))
        if d:
            out[:, x] = np.roll(a[:, x], d, axis=0)
            if d > 0: out[:d, x] = 0
            else: out[d:, x] = 0
    return out

def lift_above(a, row, n):
    """Breathing: rows < row move up n px, row..row+n-1 become copies of `row` (clean stretch)."""
    if n == 0: return a
    out = a.copy()
    out[:row] = 0
    out[:row - n] = a[n:row]
    for k in range(n): out[row - n + k] = a[row]
    return out

def idle_pose(lift=0, head_lift=0, dip=0, sleeve_dy=0):
    """lift: chest/shoulders up (px). head_lift: head up (lagged). dip: ledger far-end drop (px)."""
    P = IMGS
    torso = lift_above(P['torso'], 46, lift)
    sleeve = shift(P['sleeve_front'], 0, -lift + sleeve_dy)
    head = shift(P['head'], 0, -head_lift)
    fn = lambda x: dip * (55 - x) / 25.0
    ledger = col_shear(shift(P['ledger'], 0, -lift), range(30, 56), fn)
    hand = shift(P['hand_front'], 0, -lift + int(round(fn(37))))
    return composite([P['hem_back'], P['legs'], P['hem_front'], torso, head, sleeve, ledger, hand])

def clerk_pose(lift=0, head_lift=0, dip=0, ledger_dy=0, lean=0, head_dx=0, head_dy=0, hem_swing=0, shoulder_dx=None):
    """General derived pose.
    lift: chest stretch up. dip: ledger far-end drop. ledger_dy: whole ledger+hand down.
    lean: torso row shear forward (-x) — 0 at the hip (y=60), `lean` px at the shoulders.
    head_dx/dy: extra head offset on top of the lean. hem_swing: hem_back bottom rows swing back (+x)."""
    P = IMGS
    sh = lambda y: -lean * min(1.0, (60 - y) / 35.0)          # shear profile (hip→shoulders)
    torso = row_shear(lift_above(P['torso'], 46, lift), range(12, 61), sh)
    sdx = int(round(sh(27))) if shoulder_dx is None else shoulder_dx
    sleeve = shift(P['sleeve_front'], sdx, -lift)
    head = shift(P['head'], sdx + head_dx, -head_lift + head_dy)
    fn = lambda x: dip * (55 - x) / 25.0
    ledger = col_shear(shift(P['ledger'], sdx, -lift + ledger_dy), range(20, 60), fn)
    hand = shift(P['hand_front'], sdx, -lift + ledger_dy + int(round(fn(37))))
    hem_back = row_shear(P['hem_back'], range(61, 112), lambda y: hem_swing * max(0.0, (y - 80) / 31.0))
    return composite([hem_back, P['legs'], P['hem_front'], torso, head, sleeve, ledger, hand])
