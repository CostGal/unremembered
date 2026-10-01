# anim_hurt.py — Clerk HURT: derived from rest. Hit from -x → lean back (row shear to +x), head snaps back,
# whole-body knockback +x up to 4 px, coat swings forward with 1-frame lag, settles. ~0.55 s
from common import *
from pose import clerk_pose, REST
import json

#        f0 f1 f2 f3 f4 f5 f6 f7
LEAN = [ 0,-3,-4,-4,-3,-2,-1, 0]    # negative = lean back (+x at the shoulders)
HDX  = [ 0, 2, 3, 2, 1, 1, 0, 0]    # head snaps back a bit more
HDY  = [ 0,-1,-1, 0, 0, 0, 0, 0]    # chin up on the hit
KB   = [ 0, 2, 4, 5, 4, 3, 1, 0]    # knockback +x
HEM  = [ 0, 0,-1,-2,-1,-1, 0, 0]    # coat tail swings forward (lag)
DUR  = [40, 60, 80, 90, 80, 70, 60, 60]   # 540 ms

def build():
    out = []
    for i in range(8):
        f = clerk_pose(lean=LEAN[i], head_dx=HDX[i], head_dy=HDY[i], hem_swing=HEM[i])
        out.append(shift(f, KB[i], 0))
    return out

if __name__ == '__main__':
    frames = build()
    check_frames(frames, palette_of([REST]), 'hurt', rest=REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_hurt.png')
    save_gif(frames, DUR, f'{OUT}/clerk_hurt.gif')
    contact_sheet(frames, f'{OUT}/clerk_hurt_contact.png', scale=1, cols=8)
    json.dump({'frames': 8, 'sheet': 'clerk_hurt.png', 'durations_ms': DUR, 'loop': False}, open(f'{OUT}/_hurt.json', 'w'))
    print('ok', sum(DUR))
