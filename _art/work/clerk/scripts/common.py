# common.py — shared helpers for the Clerk pipeline (256x256, source faces RIGHT -> flip to LEFT)
import numpy as np, json, os, glob
from PIL import Image, ImageOps

SRC = '/mnt/user-data/uploads'
OUT = '/mnt/user-data/outputs/clerk'
os.makedirs(OUT, exist_ok=True)
F = 256                # output frame
N = 128                # native art resolution: every pixler sheet is 128x128 art at exact 2x
GROUND = 120           # last ground-contact row (native). Output row = 241
FX = {'teal': (63, 208, 201), 'white': (241, 239, 232)}   # #3fd0c9, #f1efe8

def load_sheet(name):
    """Load a pixler sheet, flip every frame once (exact), return list of RGBA arrays."""
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    a = np.array(im)
    n = a.shape[1] // F
    frames = [a[:, i*F:(i+1)*F].copy() for i in range(n)]
    out = []
    for f in frames:
        assert (f.reshape(N,2,N,2,4) == f.reshape(N,2,N,2,4)[:, :1, :, :1]).all(), '2x2 block structure broken'
        out.append(f[::2, ::-2].copy())          # downscale to native (exact) + horizontal flip (exact)
    return out

def up2(a):
    """Native 128 -> output 256, NEAREST (exact)."""
    return np.repeat(np.repeat(a, 2, axis=0), 2, axis=1)

def bbox(a):
    ys, xs = np.where(a[..., 3] > 0)
    if len(ys) == 0: return None
    return xs.min(), xs.max(), ys.min(), ys.max()

def palette_of(frames):
    s = set()
    for f in frames:
        s |= set(map(tuple, f[f[..., 3] > 0][..., :3]))
    return s

def shift(a, dx, dy):
    """Integer shift of an RGBA array on the same canvas (clips at edges)."""
    out = np.zeros_like(a)
    H, W = a.shape[:2]
    xs, xd = (0, dx) if dx >= 0 else (-dx, 0)
    ys, yd = (0, dy) if dy >= 0 else (-dy, 0)
    w, h = W - abs(dx), H - abs(dy)
    if w > 0 and h > 0:
        out[yd:yd+h, xd:xd+w] = a[ys:ys+h, xs:xs+w]
    return out

def over(dst, src):
    """Alpha-over with hard alpha (0/255)."""
    m = src[..., 3] > 0
    dst = dst.copy()
    dst[m] = src[m]
    return dst

def composite(layers):
    out = np.zeros((N, N, 4), np.uint8)
    for l in layers:
        out = over(out, l)
    return out

def row_shear(a, rows, fn):
    """Shift each row y in `rows` by int(fn(y)) px in x. Exact."""
    out = a.copy()
    for y in rows:
        d = int(round(fn(y)))
        if d:
            out[y] = np.roll(a[y], d, axis=0)
            if d > 0: out[y, :d] = 0
            else: out[y, d:] = 0
    return out

def ground_row(a):
    b = bbox(a); return b[3] if b else None

def pin_ground(a, g=GROUND):
    """Shift the frame vertically so its lowest opaque row == g."""
    gr = ground_row(a)
    return shift(a, 0, g - gr) if gr is not None else a

def save_sheet(frames, path):
    """frames are native 128; sheet is written at 256 per frame."""
    sheet = np.concatenate([up2(f) for f in frames], axis=1)
    Image.fromarray(sheet).save(path)

def save_gif(frames, durations, path, scale=2):
    """GIF with the exact palette (quantize to the frame's own colors, no dithering)."""
    ims = []
    for f in frames:
        im = Image.fromarray(up2(f)).resize((F*scale, F*scale), Image.NEAREST)
        bg = Image.new('RGBA', im.size, (30, 30, 36, 255))
        bg.alpha_composite(im)
        ims.append(bg.convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=durations, loop=0, disposal=2)

def check_frames(frames, palette, name, allow_fx=True, ground=GROUND, rest=None, loop=False):
    """Script check: palette ∪ FX, alpha 0/255, ground line, rest in/out."""
    pal = set(palette) | (set(FX.values()) if allow_fx else set())
    for i, f in enumerate(frames):
        assert f.shape == (N, N, 4), (name, i, f.shape)
        assert set(np.unique(f[..., 3])) <= {0, 255}, (name, i, 'alpha')
        cols = set(map(tuple, f[f[..., 3] > 0][..., :3]))
        bad = cols - pal
        assert not bad, (name, i, 'off-palette', list(bad)[:5])
    if rest is not None and not loop:
        assert np.array_equal(frames[0], rest), (name, 'frame0 != rest')
        assert np.array_equal(frames[-1], rest), (name, 'last != rest')
    return True

def contact_sheet(frames, path, scale=2, cols=8):
    n = len(frames); rows = (n + cols - 1) // cols
    sh = Image.new('RGBA', (cols*F*scale, rows*F*scale), (30, 30, 36, 255))
    for i, f in enumerate(frames):
        im = Image.fromarray(up2(f)).resize((F*scale, F*scale), Image.NEAREST)
        sh.alpha_composite(im, ((i % cols)*F*scale, (i // cols)*F*scale))
    sh.save(path)
