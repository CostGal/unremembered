# anim_lunge.py — Blank lunge: fast leap, lands crouched on all fours, 1 impact at landing.
# Keyframes: pixler blank_lunge.png f1..f7 (f0 replaced by rest).
#   f1 arms drop · f2 crouch · f3 deep crouch, arms forward (WINDUP, held 600 ms by the game) ·
#   f4 airborne leap (lifted 4 px more to sell the jump) · f5 landing on all fours (IMPACT) ·
#   f6 lowest crouch · f7 pushes up on hands.
# Return (derived — the sheet has none): f7 → f3 (crouch) → f1 → rest, reverse of the lift.
from common import *

L = SHEETS['lunge']
p = {i: clean_orphans(pin_ground(L[i])) for i in [1, 2, 3, 5, 6, 7]}
p[4] = clean_orphans(shift(L[4], 0, -4))                     # airborne: bottom 115 → 111
seq =  ['rest', 1,  2,  3,   4,  5,  6,  7,   3,   1,  'rest']
durs = [80,     90, 80, 150, 60, 60, 90, 110, 120, 130, 80]   # 1050 ms
frames = [REST if k == 'rest' else p[k] for k in seq]

check_frames(frames, 'lunge', airborne={4})
entries = load_json()
entries['lunge'] = export('lunge', frames, durs, {'loop': False, 'windupFrame': 3, 'impactFrames': [5]})
save_json(entries)
print('lunge ok', len(frames), sum(durs), 'ms')
