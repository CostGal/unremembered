"""Common loader + palette + checks for Hollow. Source faces RIGHT -> flip once at load."""
from PIL import Image
import numpy as np, glob, os, json

SRC = '/mnt/user-data/uploads'
OUT = '/mnt/user-data/outputs/hollow'
os.makedirs(OUT, exist_ok=True)
FX = (0x3f, 0xd0, 0xc9)  # teal, FX layer only
FW = 128

def load_sheet(name):
    """Load a sheet, flip horizontally (exact), return list of 128x128 RGBA arrays (facing LEFT)."""
    im = Image.open(f'{SRC}/{name}').convert('RGBA')
    a = np.array(im)
    n = a.shape[1] // FW
    frames = [a[:, i*FW:(i+1)*FW] for i in range(n)]
    return [f[:, ::-1].copy() for f in frames]  # horizontal flip, pixel exact

def all_frames():
    d = {}
    for f in sorted(glob.glob(f'{SRC}/*.png')):
        d[os.path.basename(f)[:-4]] = load_sheet(os.path.basename(f))
    return d

def palette():
    cols = set()
    for frs in all_frames().values():
        for f in frs:
            cols |= set(map(tuple, f[f[..., 3] > 0][..., :3].reshape(-1, 3)))
    cols.add(FX)
    return cols

def bbox(f):
    ys, xs = np.where(f[..., 3] > 0)
    if len(ys) == 0: return None
    return xs.min(), xs.max(), ys.min(), ys.max()

def to_sheet(frames):
    sh = np.zeros((FW, FW*len(frames), 4), np.uint8)
    for i, f in enumerate(frames): sh[:, i*FW:(i+1)*FW] = f
    return sh

def save_gif(frames, durs, path, scale=3):
    ims = []
    for f in frames:
        im = Image.fromarray(f, 'RGBA').resize((FW*scale, FW*scale), Image.NEAREST)
        bg = Image.new('RGBA', im.size, (40, 40, 40, 255)); bg.alpha_composite(im)
        ims.append(bg.convert('P', palette=Image.ADAPTIVE, colors=255))
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=durs, loop=0, disposal=2)

def save_png(arr, path):
    Image.fromarray(arr, 'RGBA').save(path)

def check(frames, durs, pal, rest=None, loop=False, name=''):
    """Script check: palette ∪ FX, alpha 0/255, 1 component w/o FX, frames==durs, rest in/out, no clipping."""
    from scipy import ndimage
    assert len(frames) == len(durs), f'{name}: frames {len(frames)} != durs {len(durs)}'
    for i, f in enumerate(frames):
        assert set(np.unique(f[..., 3])) <= {0, 255}, f'{name} f{i}: alpha'
        cols = set(map(tuple, f[f[..., 3] > 0][..., :3].reshape(-1, 3)))
        bad = cols - pal
        assert not bad, f'{name} f{i}: off-palette {list(bad)[:5]}'
        x0, x1, y0, y1 = bbox(f)
        assert x0 >= 1 and x1 <= 126 and y0 >= 1 and y1 <= 126, f'{name} f{i}: clips canvas {bbox(f)}'
        body = (f[..., 3] > 0) & ~np.all(f[..., :3] == FX, axis=-1)
        lab, n = ndimage.label(body, structure=np.ones((3, 3)))
        sizes = ndimage.sum(body, lab, range(1, n+1))
        big = (sizes > 4).sum()
        assert big == 1, f'{name} f{i}: {big} body components >4px'
    if rest is not None and not loop:
        assert np.array_equal(frames[0], rest), f'{name}: frame0 != rest'
        assert np.array_equal(frames[-1], rest), f'{name}: last != rest'
    print(f'{name}: OK ({len(frames)} frames, {sum(durs)} ms)')
