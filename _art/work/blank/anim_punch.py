# anim_punch.py — Blank punch: slow, ~1.2 s, held windup, 1 impact, return to rest.
# Keyframes: pixler blank_punch.png f1..f7 (f0 replaced by rest).
#   f1 fists up · f2 lean back, fists at hip (WINDUP, held by the game) · f3 step in ·
#   f4 fist leaves guard · f5 full extension (IMPACT) · f6 micro-move hold · f7 retract.
# Return (derived): f7 → f3 → f1 → rest  (reverse of the lift, as the learnings say).
from common import *

p = [clean_orphans(pin_ground(f)) for f in SHEETS['punch']]   # f1,f2 sit at 117 → pinned to 119
seq =   ['rest', 1,   2,   3,  4,  5,  6,  7,   3,   1,  'rest']
durs =  [100,   120, 180, 100, 60, 50, 80, 120, 140, 150, 100]        # 1200 ms, slow-fast-slow
frames = [REST if k == 'rest' else p[k] for k in seq]

check_frames(frames, 'punch')
entries = load_json()
entries['punch'] = export('punch', frames, durs, {'loop': False, 'windupFrame': 2, 'impactFrames': [5]})
save_json(entries)
print('punch ok', len(frames), sum(durs), 'ms')
