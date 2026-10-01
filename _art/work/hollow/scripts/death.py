"""Hollow death: pixler death keyframes f1-f6 (sinks into a wide pile; shadow blob removed, clipped edges
turned into dust and re-centered), then a 4-frame procedural dissolve: the pile burns away top-down,
removed pixels drift out as dust (own dark palette + #3fd0c9 teal). Last frame = low dust pile, held."""
from common import *
from rig import REST
from scipy import ndimage

D = load_sheet('hollow_death.png')
rng = np.random.RandomState(7)

def largest_component(f):
    m = f[..., 3] > 0
    lab, n = ndimage.label(m, structure=np.ones((3, 3)))
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = lab == (int(np.argmax(sizes)) + 1)
    out = f.copy(); out[~keep] = 0
    return out

def edge_to_dust(f, left, right, dx):
    """Columns < left or > right were clipped by pixler: erase them, re-center by dx, scatter ~35 % of the
    erased pixels back as single dust dots (own colours) just inside the new edge."""
    m = f[..., 3] > 0
    ys, xs = np.where(m & ((np.arange(FW)[None, :] < left) | (np.arange(FW)[None, :] > right)))
    out = f.copy(); out[ys, xs] = 0
    out = np.roll(out, dx, axis=1)
    taken = set()
    for y, x in zip(ys, xs):
        if rng.rand() > 0.35: continue
        nx = x + dx + (rng.randint(-3, 4) if x < 64 else rng.randint(-3, 4))
        ny = y + rng.randint(-2, 3)
        if 2 <= nx <= 125 and 2 <= ny <= 125 and out[ny, nx, 3] == 0 and \
           all((ny + a, nx + b) not in taken for a in (-1, 0, 1) for b in (-1, 0, 1)):
            out[ny, nx] = f[y, x]; taken.add((ny, nx))
    return out

def dissolve(base, k, total=4):
    """Step k of total: the pile crumbles top-down (rows above a sinking threshold vanish), the remainder is
    thinned with a hash pattern, and ~6 % of the removed pixels become dust that drifts a little up/out
    (own colours, ~30 % teal). Dust lift is small and capped so it settles instead of towering."""
    y0, y1 = bbox(base)[2], bbox(base)[3]
    thresh = y1 - 10 if k == total else y0 + int((y1 - y0 + 1) * [0.20, 0.42, 0.68][k - 1])
    m = base[..., 3] > 0
    yy, xx = np.mgrid[0:FW, 0:FW]
    ragged = thresh + ((xx * 5 + xx // 3) % 7) - 3            # per-column jitter: no flat cut line
    keep = m & (yy >= ragged)
    if k >= 2:
        # isolated-hole patterns (no two holes touch, even diagonally) so the pile stays 8-connected
        hole = {2: (xx + 2 * yy) % 6 == 0, 3: (xx + 2 * yy) % 4 == 0, 4: (xx + yy) % 2 == 0}[k]
        keep &= ~hole | (yy > y1 - 2)
    out = np.zeros_like(base); out[keep] = base[keep]
    removed = m & ~keep
    ys, xs = np.where(removed)
    taken = set()
    emit = 0.06 if k < total else 0.025
    for y, x in zip(ys, xs):
        if rng.rand() > emit: continue
        band = max(0, thresh - y)                      # how far above the live edge this pixel was
        lift = rng.randint(0, 4 + k) + band // 6       # old dust drifts a bit further, but slowly
        nx = x + rng.randint(-(2 + 2 * k), 3 + 2 * k)
        ny = max(y0 - 2, y - lift)
        if ny < thresh - 14 - 3 * k: continue           # cap: nothing floats far above the crumbling edge
        if 2 <= nx <= 125 and 2 <= ny <= 125 and out[ny, nx, 3] == 0 and \
           all((ny + a, nx + b) not in taken for a in (-1, 0, 1) for b in (-1, 0, 1)):
            out[ny, nx] = (*FX, 255) if rng.rand() < 0.3 else base[y, x]
            taken.add((ny, nx))
    return out

def build():
    frames = [REST.copy()]
    frames.append(largest_component(D[1]))
    frames.append(largest_component(D[2]))                 # drops the detached ground shadow (rows 116-125)
    frames.append(largest_component(D[3]))
    frames.append(np.roll(largest_component(D[4]), 3, axis=1))
    frames.append(edge_to_dust(largest_component(D[5]), 4, 125, 0))
    settled = edge_to_dust(largest_component(D[6]), 5, 122, 0)
    frames.append(settled)
    for k in range(1, 5):
        frames.append(dissolve(settled, k))
    return frames

DURS = [80, 90, 90, 100, 100, 110, 120, 90, 90, 110, 160]

if __name__ == '__main__':
    frames = build()
    check(frames, DURS, palette(), rest=None, name='death')
    assert np.array_equal(frames[0], REST)
    save_png(to_sheet(frames), f'{OUT}/hollow_death.png')
    save_gif(frames, DURS, f'{OUT}/hollow_death.gif')
    Image.fromarray(to_sheet(frames)).resize((FW*len(frames)*3, FW*3), Image.NEAREST).save('death_contact3x.png')
    for i, f in enumerate(frames): print(i, bbox(f), (f[..., 3] > 0).sum())
