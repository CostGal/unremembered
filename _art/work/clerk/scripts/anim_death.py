# anim_death.py — Clerk DEATH: pixler death f2-15 (hunch → kneel → collapse, lying 10-15), paper-shred FX
# at the collapse, last frame held.
from common import *
from draw import fx_sparks
from rig import REST
import json

D = load_sheet('clerk_death')
SHREDS1 = [(-6, -10), (2, -14), (10, -9), (-12, -4), (16, -6), (-2, -18)]
SHREDS2 = [(-10, -14), (4, -19), (14, -12), (-16, -6), (20, -8), (-4, -24), (8, -22)]
SRC = [REST, D[2], D[4], D[5], D[6], D[7], D[8], D[9], D[10], D[11], D[12], D[13], D[14], D[15]]
FXL = {8: SHREDS1, 9: SHREDS2}
DUR = [90, 110, 110, 100, 90, 80, 70, 60, 50, 60, 90, 120, 160, 220]   # 1410 ms, last frame held

def build():
    out = []
    for i, s in enumerate(SRC):
        f = pin_ground(s)
        if i in FXL: f = composite([f, fx_sparks((60, 108), FXL[i])])
        out.append(f)
    return out

if __name__ == '__main__':
    frames = build()
    pal = palette_of([REST] + D)
    check_frames(frames, pal, 'death')
    assert np.array_equal(frames[0], REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_death.png')
    save_gif(frames, DUR, f'{OUT}/clerk_death.gif')
    contact_sheet(frames, f'{OUT}/clerk_death_contact.png', scale=1, cols=7)
    json.dump({'frames': len(frames), 'sheet': 'clerk_death.png', 'durations_ms': DUR, 'loop': False, 'holdLastFrame': True},
              open(f'{OUT}/_death.json', 'w'))
    print('ok', len(frames), sum(DUR))
