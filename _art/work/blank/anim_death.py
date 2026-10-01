# anim_death.py — Blank death: slumps, falls forward, collapses on the floor. Last frame held.
# Keyframes: pixler blank_death.png f1..f7 (f0 replaced by rest).
#   f1 slump · f2 deeper · f3 topples forward, head down · f4..f7 collapsed, settling.
# Derived: one in-between between f3 and f4 (f4 lifted 8 px, mid-fall, airborne) so the
# 31 px height drop doesn't pop. f4..f7 sit at y=121 in the sheet → pinned to 119.
from common import *

D = SHEETS['death']
p = {i: clean_orphans(pin_ground(D[i])) for i in range(1, 8)}
mid = shift(p[4], 0, -8)                                        # mid-fall in-between
frames = [REST, p[1], p[2], p[3], mid, p[4], p[5], p[6], p[7]]
durs   = [80,   110,  100,  90,   60,  90,   120,  160,  220]  # 1030 ms

check_frames(frames, 'death', rest_in_out=False, airborne={4})
assert (frames[0] == REST).all()
entries = load_json()
entries['death'] = export('death', frames, durs, {'loop': False, 'holdLastFrame': True})
save_json(entries)
print('death ok', len(frames), sum(durs), 'ms')
