# anim_file_away.py — Clerk FILE_AWAY: hand out of the pocket, raised over the ledger (windup, held),
# two page slams (2 impacts) with paper-shred FX, ledger "filed" (pages f13-15 show the mark), back to rest. ~1.5 s
from common import *
from draw import *
from rig import REST
import json

P = load_sheet('clerk_pages')

def windup_pose(hand=(47, 22)):
    """Rest body + procedural back arm reaching across the chest, hand hovering over the ledger (front layer)."""
    body = REST
    arm = back_arm((78, 35), (65, 27), hand)
    return composite([body, arm, fist(hand, 6)])

from pose import IMGS as RIG
_a = REST[..., :3].astype(int)

def _nonbody(f, x0=24, x1=58, y0=22, y1=52):
    """Mask of ledger / hand / page-gap pixels inside the ledger box (everything that is not coat-dark)."""
    a = f[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    coat = (b >= r) & (a.max(-1) < 130)
    m = (f[..., 3] > 0) & ~coat
    box = np.zeros((N, N), bool); box[y0:y1+1, x0:x1+1] = True
    return m & box

def mark_layer(center=(44, 35)):
    """'Filed' mark on the page: red-brown blotch (tie/leather palette colors)."""
    L = np.zeros((N, N, 4), np.uint8); cx, cy = center
    for dy in range(-2, 3):
        for dx in range(-3, 4):
            if abs(dx) + abs(dy) <= 4:
                c = (169, 28, 26) if (dx + dy) % 2 == 0 else (122, 52, 51)
                L[cy + dy, cx + dx] = (*c, 255)
    return L

def slam_frame(src, hand, mark=False):
    """pixler body/arms + the REST ledger (clean page, no pixler page gap) + procedural hand on the page."""
    body = src.copy(); body[_nonbody(src)] = 0
    layers = [body, RIG['ledger'], RIG['hand_front']]
    if mark: layers.append(mark_layer())
    layers.append(fist(hand, 7))
    return composite(layers)

def blank_page(src, x0=36, x1=48, y0=33, y1=47):
    """Erase the pixler 'filed' mark: inside the page box (left of the hand) every non-page pixel is repainted
    with the nearest page pixel (cream / ruled-line grey) on the same row."""
    out = src.copy(); a = src[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    page = (src[..., 3] > 0) & (r > 160) & (g > 140) & (b > 120)
    for y in range(y0, y1 + 1):
        xs = np.where(page[y, x0 - 2:x1 + 3])[0] + x0 - 2
        if len(xs) == 0: continue
        for x in range(x0, x1 + 1):
            if src[y, x, 3] and not page[y, x]:
                out[y, x] = src[y, xs[np.abs(xs - x).argmin()]]
    return out

def blank_page_open(src, x0=28, x1=60, y0=20, y1=50):
    """For frames with no hand on the page (pages f13-15): any non-page pixel that has page pixels on both
    sides of it in the same row (i.e. lies inside the page) is repainted with the nearest page pixel."""
    out = src.copy(); a = src[..., :3].astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    page = (src[..., 3] > 0) & (r > 160) & (g > 140) & (b > 120)
    for y in range(y0, y1 + 1):
        xs = np.where(page[y, x0:x1 + 1])[0] + x0
        if len(xs) < 2: continue
        for x in range(xs.min(), xs.max() + 1):
            if src[y, x, 3] and not page[y, x]:
                out[y, x] = src[y, xs[np.abs(xs - x).argmin()]]
    return out

PB = {11: blank_page(P[11]), 12: blank_page(P[12]), 13: blank_page_open(P[13]),
      14: blank_page_open(P[14]), 15: blank_page_open(P[15])}
P12_BLANK = PB[12]
SHREDS = [(-8, -4), (-12, -1), (-10, 4), (-14, -6), (-16, 2), (-6, -9), (-11, 8), (-18, -2)]

K = [
    dict(src=REST),                                                             # 0
    # approach = pages f15 → f11 reversed, page blank (no mark yet)
    dict(src=PB[15]),                                                           # 1 hand leaves the pocket
    dict(src=PB[14]),                                                           # 2 hand out
    dict(src=PB[13]),                                                           # 3 WINDUP (held): hand over the page
    dict(src=PB[12], fx=('flash', (40, 36), 7), fx2=('shreds', (38, 36))),      # 4 IMPACT 1
    dict(src=PB[11]),                                                           # 5 hold
    # second slam: same approach, faster
    dict(src=PB[14]),                                                           # 6 hand lifts
    dict(src=PB[13]),                                                           # 7
    dict(src=PB[12], fx=('flash', (40, 36), 7), fx2=('shreds', (38, 36))),      # 8 IMPACT 2
    dict(src=P[12]),                                                            # 9 the mark appears: filed
    dict(src=P[13]),                                                            # 10 hand lifts
    dict(src=P[14]),                                                            # 11
    dict(src=P[15]),                                                            # 12 back to the pocket
    dict(src=REST),                                                             # 13
]
DUR = [80, 110, 110, 200, 50, 110, 90, 80, 50, 130, 110, 110, 110, 100]   # 1440 ms
WINDUP, IMPACT = 3, [4, 8]
def build():
    frames = []
    for k in K:
        layers = [k['src']]
        if 'fx' in k: layers.append(fx_flash(k['fx'][1], k['fx'][2]))
        if 'fx2' in k: layers.append(fx_sparks(k['fx2'][1], SHREDS))
        frames.append(composite(layers))
    return frames

if __name__ == '__main__':
    frames = build()
    check_frames(frames, palette_of([REST] + P), 'file_away', rest=REST)
    for i, f in enumerate(frames): assert ground_row(f) == GROUND, (i, ground_row(f))
    save_sheet(frames, f'{OUT}/clerk_file_away.png')
    save_gif(frames, DUR, f'{OUT}/clerk_file_away.gif')
    contact_sheet(frames, f'{OUT}/clerk_file_away_contact.png', scale=1, cols=8)
    json.dump({'frames': len(frames), 'sheet': 'clerk_file_away.png', 'durations_ms': DUR, 'loop': False,
               'windupFrame': WINDUP, 'impactFrames': IMPACT}, open(f'{OUT}/_file_away.json', 'w'))
    print('ok', len(frames), sum(DUR))
