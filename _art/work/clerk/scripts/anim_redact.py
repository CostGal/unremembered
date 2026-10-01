# anim_redact.py — Clerk REDACT (feint): hand to the ledger as if writing (windup, held) → hand rises
# (holdFrame: the feint, game waits) → strike across the page (impact, teal slash) → page redacted → rest. ~1.5 s
from common import *
from draw import *
from rig import REST
from pose import IMGS as RIG
import json

W = load_sheet('clerk_write')

def _skin(f):
    """skin incl. hand shadow tones; excludes page cream (high g and b)."""
    a = f[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (f[..., 3] > 0) & (r >= 180) & (g >= 90) & (r > b + 40) & ~((g >= 205) & (b >= 170))

def _coat(f):
    a = f[..., :3].astype(int)
    return (f[..., 3] > 0) & (a[..., 2] >= a[..., 0]) & (a.max(-1) < 130)

def clean_ledger(src, redacted=False, x0=24, x1=57, y0=20, y1=50):
    """pixler write f12-15 draw a grey scribbled page: replace the ledger with the REST ledger (clean),
    keep the pixler body and the writing hand (skin, x>=38). redacted=True draws black bars on the ruled lines."""
    body = src.copy()
    box = np.zeros((N, N), bool); box[y0:y1+1, x0:x1+1] = True
    X = np.arange(N)[None, :]; Y = np.arange(N)[:, None]
    hm = _skin(src) & box & (X >= 40) & (Y <= 38)          # the writing hand (pixler), above the page
    keep = _coat(src) | hm
    body[box & ~keep] = 0
    hand = np.zeros_like(src); hand[hm] = src[hm]
    ledger = RIG['ledger'].copy()
    if redacted: ledger = redact_bars(ledger)
    return composite([body, ledger, RIG['hand_front'], hand])

def redact_bars(ledger, x0=38, x1=52):
    """Black bars that follow the page's ruled lines (grey line pixels + the pixel below), palette dark."""
    out = ledger.copy(); a = ledger[..., :3].astype(int)
    line = (ledger[..., 3] > 0) & (a.max(-1) < 200) & (a.min(-1) > 120)     # ruled-line greys
    ys, xs = np.where(line)
    for y, x in zip(ys, xs):
        if x0 <= x <= x1:
            for dy in (-1, 0, 1):
                if ledger[y + dy, x, 3]: out[y + dy, x] = (25, 13, 30, 255)
    return out

def fx_slash(p0, p1, w=2):
    """Teal slash with white core along the page."""
    L = np.zeros((N, N, 4), np.uint8)
    thick_line(L, p0, p1, w + 2, FX['teal'])
    thick_line(L, p0, p1, w - 1 if w > 1 else 1, FX['white'])
    return L

SPARKS = [(-6, -3), (-9, 1), (-7, 5), (-4, -7), (-11, -2), (-13, 4), (-3, 8), (-9, 7)]

K = [
    dict(src=REST),                                              # 0
    dict(src=W[3]),                                              # 1 hand out of the pocket
    dict(src=W[5]),                                              # 2 hand on the hip
    dict(src=W[7]),                                              # 3 reaching the page
    dict(src=W[9]),                                              # 4 WINDUP (held): "writing"
    dict(src=W[10]),                                             # 5 writes
    dict(src=W[11]),                                             # 6 writes
    # pixler write f12-15 used as-is (the pixler hand can't be separated cleanly; its grey page reads as 'redacted')
    dict(src=W[12]),                                             # 7 hand rises
    dict(src=W[13], fx='charge'),                                # 8 HOLD (feint): hand raised, teal charge on the fingers
    dict(src=W[14], fx='slash'),                                 # 9 IMPACT: the strike, teal slash across the page
    dict(src=W[15], fx='sparks'),                                # 10 redacted
    dict(src=W[15]),                                             # 11 hold
    dict(src=W[6]),                                              # 12 hand back (page as pixler drew it — clean)
    dict(src=W[4]),                                              # 13
    dict(src=W[2]),                                              # 14
    dict(src=REST),                                              # 15
]
DUR = [80, 100, 100, 100, 180, 90, 90, 90, 170, 50, 110, 80, 90, 90, 90, 100]   # 1610 ms (holdFrame pauses on f8)
WINDUP, HOLD, IMPACT = 4, 8, [9]

def build():
    frames = []
    for k in K:
        layers = [k['src']]
        fx = k.get('fx')
        if fx == 'charge': layers.append(fx_sparks((50, 26), [(0, 0), (1, 1), (-1, 1), (0, -1), (2, -2), (-2, -2)]))
        if fx == 'slash': layers += [fx_slash((36, 31), (52, 41), 2), fx_flash((34, 30), 5)]
        if fx == 'sparks': layers.append(fx_sparks((34, 32), SPARKS))
        frames.append(composite(layers))
    return frames

if __name__ == '__main__':
    frames = build()
    check_frames(frames, palette_of([REST] + W), 'redact', rest=REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_redact.png')
    save_gif(frames, DUR, f'{OUT}/clerk_redact.gif')
    contact_sheet(frames, f'{OUT}/clerk_redact_contact.png', scale=1, cols=8)
    json.dump({'frames': len(frames), 'sheet': 'clerk_redact.png', 'durations_ms': DUR, 'loop': False,
               'windupFrame': WINDUP, 'holdFrame': HOLD, 'impactFrames': IMPACT}, open(f'{OUT}/_redact.json', 'w'))
    print('ok', len(frames), sum(DUR))
