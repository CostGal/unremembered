# anim_idle.py — Blank idle: slow hunched sway, loop ~1.6 s.
# Keyframes: pixler idle.png f1..f7 (hunch down). Frame 0 = rest (replaces pixler f0).
# Return (rise) = pixler frames in reverse order (f6..f1), i.e. derived ping-pong.
from common import *

src = SHEETS['idle']
down = [clean_orphans(pin_ground(f)) for f in src[1:8]]      # f1..f7
frames = [REST] + down + down[-2::-1]                          # rest, f1..f7, f6..f1  (14 frames)
# slow–fast–slow: holds at the top (rest) and the bottom (f7)
durations = [150, 110, 100, 100, 100, 110, 130, 170, 130, 110, 100, 100, 110, 130]  # 1650 ms

check_frames(frames, 'idle', rest_in_out=False)
assert (frames[0] == REST).all()
entries = load_json()
entries['idle'] = export('idle', frames, durations, {'loop': True})
save_json(entries)
print('idle ok', len(frames), sum(durations), 'ms')
