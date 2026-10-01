# anim_archive_release.py — ARCHIVE release: ledger raised facing out (windup, held, glowing) → lean-in thrust
# (present f6-10) → one big impact with a glow burst from the page → return → rest. ~1.2 s
from common import *
from draw import *
from rig import REST
from anim_archive_charge import glow
import json

P = load_sheet('clerk_present')
BOX = (12, 52, 12, 58)   # ledger search box for the present frames

def circle(center, r, dotted=False, color='teal'):
    L = np.zeros((N, N, 4), np.uint8); cx, cy = center; c = (*FX[color], 255)
    for t in range(0, 360, 4):
        x = int(round(cx + r * np.cos(np.radians(t)))); y = int(round(cy + r * np.sin(np.radians(t))))
        if dotted and (t // 4) % 2: continue
        if 0 <= x < N and 0 <= y < N: L[y, x] = c
    return L

def rays(center, length, n=7, color='teal'):
    """Rays fanning out toward -x (the target)."""
    L = np.zeros((N, N, 4), np.uint8); cx, cy = center
    for k in range(n):
        ang = 180 + (k - n // 2) * 16
        x1 = int(round(cx + length * np.cos(np.radians(ang)))); y1 = int(round(cy + length * np.sin(np.radians(ang))))
        x0 = int(round(cx + 6 * np.cos(np.radians(ang)))); y0 = int(round(cy + 6 * np.sin(np.radians(ang))))
        thick_line(L, (x0, y0), (x1, y1), 1, FX[color])
    return L

C = (27, 36)   # page center in present f8 (native)
K = [
    dict(src=REST),                                                              # 0
    dict(src=P[2]),                                                              # 1 ledger up
    dict(src=P[3], fx=[glow(P[3], 1, BOX)]),                                     # 2
    dict(src=P[5], fx=[glow(P[5], 2, BOX)]),                                     # 3 WINDUP (held): ledger facing out, glowing
    dict(src=P[6], fx=[glow(P[6], 3, BOX)]),                                     # 4 lean in
    dict(src=P[8], fx=[fx_flash(C, 12), circle(C, 7), rays(C, 16)]),             # 5 IMPACT: burst
    dict(src=P[9], fx=[circle(C, 11, dotted=True), circle(C, 5, color='white'), rays(C, 22)]),   # 6 expanding
    dict(src=P[10], fx=[circle(C, 15, dotted=True), fx_sparks(C, [(-14, -6), (-18, 2), (-12, 8), (-20, -3), (-9, -12), (-16, 9)])]),  # 7 fading
    dict(src=P[11]),                                                             # 8 return
    dict(src=P[13]),                                                             # 9
    dict(src=P[15]),                                                             # 10
    dict(src=REST),                                                              # 11
]
DUR = [80, 100, 100, 180, 60, 50, 110, 110, 100, 100, 100, 100]   # 1190 ms
WINDUP, IMPACT = 3, [5]

def build():
    return [composite([k['src']] + k.get('fx', [])) for k in K]

if __name__ == '__main__':
    frames = build()
    check_frames(frames, palette_of([REST] + P), 'archive_release', rest=REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_archive_release.png')
    save_gif(frames, DUR, f'{OUT}/clerk_archive_release.gif')
    contact_sheet(frames, f'{OUT}/clerk_archive_release_contact.png', scale=1, cols=6)
    json.dump({'frames': len(frames), 'sheet': 'clerk_archive_release.png', 'durations_ms': DUR, 'loop': False,
               'windupFrame': WINDUP, 'impactFrames': IMPACT}, open(f'{OUT}/_archive_release.json', 'w'))
    print('ok', len(frames), sum(DUR))
