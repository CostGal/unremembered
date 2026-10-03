"""Nala pipeline — shared helpers. Source faces RIGHT; everything flipped once at load, work faces LEFT."""
import numpy as np, json, os, glob
from PIL import Image

SRC = '/mnt/user-data/uploads'
OUT = '/home/claude/nala'
W = 64
FX_ORANGE = (232, 136, 58)   # #e8883a
FX_TEAL   = (63, 208, 201)   # #3fd0c9
FX = [FX_ORANGE, FX_TEAL]
GROUND = 55   # last opaque body row (index); user said y=56 1-based

def load_sheet(name, flip=True):
    im = Image.open(f'{SRC}/{name}.png').convert('RGBA')
    n = im.width // W
    frames = []
    for i in range(n):
        f = im.crop((i*W, 0, (i+1)*W, W))
        if flip: f = f.transpose(Image.FLIP_LEFT_RIGHT)
        frames.append(np.array(f))
    return frames

def sheet_palette():
    cols = set()
    for p in glob.glob(f'{SRC}/nala_*.png'):
        a = np.array(Image.open(p).convert('RGBA'))
        m = a[..., 3] > 0
        cols |= set(map(tuple, a[m][:, :3]))
    return sorted(cols)

def quantize(arr, pal):
    """nearest-colour map, no dithering; alpha untouched."""
    pal = np.array(pal, dtype=np.int32)
    out = arr.copy()
    m = arr[..., 3] > 0
    px = arr[m][:, :3].astype(np.int32)
    d = ((px[:, None, :] - pal[None, :, :]) ** 2).sum(-1)
    out[m, :3] = pal[d.argmin(1)]
    return out

def bbox(arr):
    ys, xs = np.where(arr[..., 3] > 0)
    return xs.min(), ys.min(), xs.max(), ys.max()

def shift(arr, dx, dy):
    """integer shift on same canvas"""
    out = np.zeros_like(arr)
    h, w = arr.shape[:2]
    sy = slice(max(0, dy), min(h, h+dy)); ty = slice(max(0, -dy), min(h, h-dy))
    sx = slice(max(0, dx), min(w, w+dx)); tx = slice(max(0, -dx), min(w, w-dx))
    out[sy, sx] = arr[ty, tx]
    return out

def over(base, top):
    out = base.copy()
    m = top[..., 3] > 0
    out[m] = top[m]
    return out

def diff(a, b):
    return int((a != b).any(-1).sum())

def save_sheet(frames, path):
    sh = Image.new('RGBA', (W*len(frames), W))
    for i, f in enumerate(frames): sh.paste(Image.fromarray(f), (i*W, 0))
    sh.save(path)

def save_gif(frames, durations, path, scale=4):
    pal = sheet_palette() + FX
    ims = []
    for f in frames:
        im = Image.fromarray(f).resize((W*scale, W*scale), Image.NEAREST)
        bg = Image.new('RGBA', im.size, (40, 40, 40, 255))
        bg.alpha_composite(im)
        p = Image.new('P', (1, 1))
        flat = []
        for c in [(40, 40, 40)] + pal: flat += list(c)
        flat += [0, 0, 0] * (256 - len(pal) - 1)
        p.putpalette(flat)
        ims.append(bg.convert('RGB').quantize(palette=p, dither=Image.NONE))
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=durations, loop=0, disposal=2)

def contact(frames, path, scale=4, labels=None):
    n = len(frames); cols = min(n, 8); rows = (n + cols - 1) // cols
    sh = Image.new('RGBA', (cols*W*scale, rows*W*scale), (40, 40, 40, 255))
    for i, f in enumerate(frames):
        im = Image.fromarray(f).resize((W*scale, W*scale), Image.NEAREST)
        sh.alpha_composite(im, ((i % cols)*W*scale, (i // cols)*W*scale))
    sh.save(path)

def check(frames, name, pal, rest=None, loop=False, durations=None):
    from scipy import ndimage
    palset = set(pal) | set(FX)
    errs = []
    for i, f in enumerate(frames):
        assert f.shape == (W, W, 4), f'{name} f{i} size'
        al = set(np.unique(f[..., 3])) - {0, 255}
        if al: errs.append(f'f{i} alpha {al}')
        m = f[..., 3] > 0
        bad = set(map(tuple, f[m][:, :3])) - palset
        if bad: errs.append(f'f{i} off-palette {len(bad)}')
        body = m.copy()
        for c in FX: body &= ~((f[..., :3] == c).all(-1))
        _, nc = ndimage.label(body)
        if nc != 1: errs.append(f'f{i} components {nc}')
        ys = np.where(body.any(1))[0]
        if ys.max() != GROUND: errs.append(f'f{i} ground {ys.max()}')
    if durations is not None and len(durations) != len(frames): errs.append('frames!=durations')
    if rest is not None and not loop:
        if diff(frames[0], rest): errs.append(f'f0 != rest ({diff(frames[0], rest)})')
        if diff(frames[-1], rest): errs.append(f'last != rest ({diff(frames[-1], rest)})')
    print(f'[{name}] {len(frames)} frames:', 'OK' if not errs else errs)
    return errs
