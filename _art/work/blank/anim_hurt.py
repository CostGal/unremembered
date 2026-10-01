# anim_hurt.py — Blank hurt: ~0.5 s, doubles over from the blow, knocked back +x, returns to rest.
# Keyframes: pixler blank_hurt.png f1..f4 (the sheet is a forward hunch with no knockback;
# the knockback is added as whole-frame integer shifts in +x, hit comes from -x).
# f5..f7 of the sheet (crouch, arms out) are NOT used — they read as "ready to pounce".
# Return (derived): f3 → f1 → rest with the shift easing back to 0.
from common import *

H = SHEETS['hurt']
p = {i: clean_orphans(pin_ground(H[i])) for i in [1, 2, 3, 4]}
seq =  [('rest', 0), (2, 3), (3, 6), (4, 8), (3, 5), (1, 2), ('rest', 0)]
durs = [60,          60,     70,     100,    90,     100,    60]       # 540 ms
frames = [REST if k == 'rest' else shift(p[k], dx, 0) for k, dx in seq]

check_frames(frames, 'hurt')
entries = load_json()
entries['hurt'] = export('hurt', frames, durs, {'loop': False})
save_json(entries)
print('hurt ok', len(frames), sum(durs), 'ms')
