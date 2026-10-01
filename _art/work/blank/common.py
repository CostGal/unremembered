# common.py — shared helpers: ground pin, orphan cleanup, checks, sheet/GIF/JSON export.
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage
from rig import REST, SHEETS, PAL, FS, GROUND, OUT

OUTDIR = '/mnt/user-data/outputs/blank'
os.makedirs(OUTDIR, exist_ok=True)

def shift(a, dx=0, dy=0):
    """Integer shift of an RGBA frame; pixels leaving the canvas are dropped."""
    out = np.zeros_like(a)
    H, W = a.shape[:2]
    ys, xs = slice(max(0, dy), min(H, H + dy)), slice(max(0, dx), min(W, W + dx))
    yd, xd = slice(max(0, -dy), min(H, H - dy)), slice(max(0, -dx), min(W, W - dx))
    out[ys, xs] = a[yd, xd]
    return out

def bottom(a):
    return int(np.where(a[..., 3] > 0)[0].max())

def pin_ground(a, ground=GROUND):
    """Shift vertically so the lowest opaque row == ground (integer)."""
    return shift(a, 0, ground - bottom(a))

def clean_orphans(a, max_px=3):
    """Remove connected components of <= max_px pixels (pixler stray dots off the silhouette)."""
    lab, n = ndimage.label(a[..., 3] > 0)
    out = a.copy()
    if n <= 1: return out
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    for i, s in enumerate(sizes, 1):
        if s <= max_px:
            out[lab == i] = 0
    return out

def components(a):
    return ndimage.label(a[..., 3] > 0)[1]

def over(dst, src):
    """Alpha-composite src over dst (alpha is 0/255 so this is a plain mask copy)."""
    m = src[..., 3] > 0
    out = dst.copy(); out[m] = src[m]
    return out

def check_frames(frames, name, rest_in_out=True, ground=True, airborne=()):
    for i, f in enumerate(frames):
        assert f.shape == (FS, FS, 4), (name, i, f.shape)
        assert set(np.unique(f[..., 3])) <= {0, 255}, (name, i, 'alpha')
        op = f[f[..., 3] > 0][:, :3]
        bad = set(map(tuple, np.unique(op, axis=0))) - PAL
        assert not bad, (name, i, 'palette', list(bad)[:5])
        assert components(f) == 1, (name, i, 'components', components(f))
        if ground and i not in airborne:
            assert bottom(f) == GROUND, (name, i, 'ground', bottom(f))
    if rest_in_out:
        assert (frames[0] == REST).all(), (name, 'frame0 != rest')
        assert (frames[-1] == REST).all(), (name, 'last != rest')

def export(name, frames, durations, meta):
    """Sheet PNG + GIF 3x (exact palette) + strip 4x for review. Returns JSON entry."""
    assert len(frames) == len(durations), (name, len(frames), len(durations))
    sheet = np.concatenate(frames, axis=1)
    Image.fromarray(sheet).save(f'{OUTDIR}/blank_{name}.png')
    # GIF: 3x nearest, exact palette (<=256 colours incl. transparent)
    gifs = []
    for f in frames:
        im = Image.fromarray(f).resize((FS * 3, FS * 3), Image.NEAREST)
        bg = Image.new('RGBA', im.size, (46, 46, 52, 255)); bg.paste(im, (0, 0), im)
        gifs.append(bg.convert('RGB').quantize(colors=256, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE))
    gifs[0].save(f'{OUTDIR}/blank_{name}.gif', save_all=True, append_images=gifs[1:],
                 duration=durations, loop=0, disposal=1)
    # review strip 4x (crop to union bbox)
    xs = np.where(sheet[..., 3] > 0)[1] % FS
    x0, x1 = max(0, xs.min() - 2), min(FS, xs.max() + 3)
    strip = np.concatenate([f[:, x0:x1] for f in frames], axis=1)
    strip = Image.fromarray(strip)
    strip = strip.resize((strip.width * 4, strip.height * 4), Image.NEAREST)
    bg = Image.new('RGBA', strip.size, (60, 60, 60, 255)); bg.paste(strip, (0, 0), strip)
    bg.save(f'{OUT}/review_{name}_4x.png')
    entry = {'frames': len(frames), 'sheet': f'blank_{name}.png', 'durations_ms': durations}
    entry.update(meta)
    return entry

def save_json(entries):
    data = {'frame_size': [FS, FS], 'facing': 'left', 'animations': entries}
    with open(f'{OUTDIR}/blank_animations.json', 'w') as fh:
        json.dump(data, fh, indent=2)
    return data

def load_json():
    p = f'{OUTDIR}/blank_animations.json'
    return json.load(open(p))['animations'] if os.path.exists(p) else {}
