"""Hollow siphon: windup (hollow_windup f1-2, f2 = windupFrame), pull pose from hollow_siphon f2-f6
(sparkles around crystals) with a held frame while the particle stream plays, crystal flash FX at impact,
return to rest. The teal particle stream is a separate FX-only sheet hollow_siphon_fx.png (loop),
anchored at spawn_px = crystal band, never drawn into the character frames."""
from common import *
from rig import REST
import math

W = load_sheet('hollow_windup.png')
S = load_sheet('hollow_siphon.png')
CRYSTAL = (50, 48)            # anchor of the crystal band (frame coords, facing LEFT)

SEQ = [
    (REST, 0, 0),   # 0 rest
    (W[1], 0, 0),   # 1 mouth opening
    (W[2], 0, 0),   # 2 mouth wide = windupFrame
    (S[2], 0, 0),   # 3 crystals start sparkling
    (S[3], -1, 0),  # 4 HOLD: pull pose, stream plays (holdFrame)
    (S[4], -2, 1),  # 5 IMPACT: particles arrive, crystal flash
    (S[5], 1, 0),   # 6 recoil
    (S[6], 0, 0),   # 7 settle
    (REST, 0, 0),   # 8 rest
]
DURS = [90, 100, 160, 100, 140, 60, 90, 100, 140]
WINDUP, HOLD, IMPACT = 2, 4, 5

def glow_fx(f, strength):
    """Teal glow around the crystal band: ring of dots (strength 1) or a 4-point flash (strength 2).
    FX layer, only on transparent px or over the band itself; never despeckled."""
    out = f.copy()
    cx, cy = CRYSTAL
    if strength == 1:
        pts = [(cx + int(round(9 * math.cos(a))), cy + int(round(7 * math.sin(a)))) for a in np.linspace(0, 2*math.pi, 10, endpoint=False)]
    else:
        pts = [(cx - 12, cy), (cx - 13, cy), (cx + 12, cy), (cx + 13, cy), (cx, cy - 9), (cx, cy - 10),
               (cx, cy + 9), (cx, cy + 10), (cx - 8, cy - 6), (cx + 8, cy + 6), (cx - 8, cy + 6), (cx + 8, cy - 6)]
    for x, y in pts:
        if 1 <= x <= 126 and 1 <= y <= 126:
            out[y, x] = (*FX, 255)
    return out

def build():
    frames = []
    for i, (src, dx, dy) in enumerate(SEQ):
        f = np.roll(src, (dy, dx), axis=(0, 1))
        if i in (3, HOLD): f = glow_fx(f, 1)
        if i == IMPACT: f = glow_fx(f, 2)
        frames.append(f)
    return frames

# ---- FX-only particle stream: dots flowing from the target side (-x, left edge) into the crystal band ----
FX_N, FX_DURS = 6, [70] * 6
def build_fx():
    frames = []
    cx, cy = CRYSTAL
    for k in range(FX_N):
        f = np.zeros((FW, FW, 4), np.uint8)
        for p in range(14):                                   # 14 particles on 3 lanes
            t = ((p / 14) + k / FX_N) % 1.0                   # 0 = at left edge, 1 = at crystals
            lane = p % 3 - 1
            x = int(round(2 + (cx - 6 - 2) * t))
            y = int(round(cy + lane * 9 * (1 - t) + 6 * math.sin(2 * math.pi * (t + p / 5)) * (1 - t)))
            for dx in (0, -1) if t > 0.3 else (0,):           # short tail once it speeds up
                xx = x + dx
                if 1 <= xx <= 126 and 1 <= y <= 126: f[y, xx] = (*FX, 255)
        frames.append(f)
    return frames

if __name__ == '__main__':
    frames = build()
    check(frames, DURS, palette(), rest=REST, name='siphon')
    save_png(to_sheet(frames), f'{OUT}/hollow_siphon.png')
    save_gif(frames, DURS, f'{OUT}/hollow_siphon.gif')
    fx = build_fx()
    for f in fx:
        assert set(map(tuple, f[f[..., 3] > 0][..., :3].reshape(-1, 3))) <= {FX}
    save_png(to_sheet(fx), f'{OUT}/hollow_siphon_fx.png')
    # preview: stream composited over the held frame
    prev = []
    for f in fx:
        c = frames[HOLD].copy(); m = f[..., 3] > 0; c[m] = f[m]; prev.append(c)
    save_gif(prev, FX_DURS, f'{OUT}/hollow_siphon_fx_preview.gif')
    Image.fromarray(to_sheet(frames)).resize((FW*len(frames)*3, FW*3), Image.NEAREST).save('siphon_contact3x.png')
    Image.fromarray(to_sheet(prev)).resize((FW*len(prev)*3, FW*3), Image.NEAREST).save('siphon_fx_contact3x.png')
    for i, f in enumerate(frames): print(i, bbox(f))
