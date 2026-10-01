# anim_idle.py — Clerk idle v2: breathe → lower the ledger → lean in and stare → back to reading. Loop ~2 s
from common import *
from pose import clerk_pose, REST
import json

#        f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11
L   = [ 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,  0]   # chest/shoulders up
LH  = [ 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0,  0]   # head follows the breath (lag)
D   = [ 0, 0, 1, 2, 3, 4, 4, 4, 4, 4, 2,  1]   # ledger far-end drop
LDY = [ 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 2,  1]   # ledger lowered
LEAN= [ 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 1,  0]   # lean in (shoulders forward)
HDX = [ 0, 0, 0, 0, 0, 0,-1,-1,-1,-1, 0,  0]   # chin out (head leads the lean)
HDY = [ 0, 0, 0, 0, 0, 0,-1,-1,-1,-1, 0,  0]   # looks up from the page
HEM = [ 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,  0]   # coat swings back, 1 frame after the lean
DUR = [200,180,160,160,160,160,140,120,180,220,180,140]   # 2000 ms

def build():
    return [clerk_pose(lift=L[i], head_lift=LH[i], dip=D[i], ledger_dy=LDY[i], lean=LEAN[i],
                       head_dx=HDX[i], head_dy=HDY[i], hem_swing=HEM[i]) for i in range(12)]

if __name__ == '__main__':
    frames = build()
    assert np.array_equal(frames[0], REST)
    check_frames(frames, palette_of([REST]), 'idle', loop=True)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_idle.png')
    save_gif(frames, DUR, f'{OUT}/clerk_idle.gif')
    contact_sheet(frames, f'{OUT}/clerk_idle_contact.png', scale=1, cols=6)
    json.dump({'frames': 12, 'sheet': 'clerk_idle.png', 'durations_ms': DUR, 'loop': True},
              open(f'{OUT}/_idle.json', 'w'))
    print('ok', len(frames))
