"""
Portrait processing for Unremembered (issue #47).
Input : Gemini portraits (JPG/PNG) on a ~#FF00FF background, one base image + expressions.
Output: PNG, colors matched to the base, background keyed to transparent (with tolerance), resized.

usage: python normalize_portraits.py <in_dir> <out_dir> <base_name> [target_height=560] [--flip] [--crop]
       (base_name = file stem of the reference expression, e.g. rhea_serious)
"""
import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter

HEAD_FRAC = (0.251, 0.05, 0.647, 0.30)   # x0,y0,x1,y1 as fractions of the frame; the head area is excluded from the color fit

def is_bg(a):
    return (a[:,:,0] > 200) & (a[:,:,1] < 90) & (a[:,:,2] > 190)

def fit_color(expr, base):
    h,w = base.shape[:2]
    x0,y0,x1,y1 = int(HEAD_FRAC[0]*w), int(HEAD_FRAC[1]*h), int(HEAD_FRAC[2]*w), int(HEAD_FRAC[3]*h)
    valid = ~is_bg(base) & ~is_bg(expr)
    valid[y0:y1, x0:x1] = False
    out = expr.copy()
    for c in range(3):
        e = expr[:,:,c][valid]; b = base[:,:,c][valid]
        g, o = np.linalg.lstsq(np.vstack([e, np.ones_like(e)]).T, b, rcond=None)[0]
        out[:,:,c] = np.clip(expr[:,:,c]*g + o, 0, 255)
    return out

def key_magenta(rgb, bg=(253.0, 15.0, 252.0)):
    """Matte against a flat magenta background.
    - dist = distance to the bg color; solid interior = clearly not bg, eroded by 2px
    - every other non-bg pixel (outer edge, thin features like whiskers) gets a local matte:
        a = dist / |nearest solid color - bg|,  C = (obs - (1-a)*bg) / a
      so the color is un-mixed from the magenta instead of being replaced (thin light lines survive)."""
    from scipy import ndimage as ndi
    bgc = np.array(bg, np.float32)
    dist = np.sqrt(((rgb - bgc)**2).sum(axis=2))
    alpha0 = np.clip((dist-40)/110.0, 0, 1)
    solid = ndi.binary_erosion(alpha0 >= 0.999, iterations=2)
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    nearest = rgb[idx[0], idx[1]]
    dloc = np.maximum(np.sqrt(((nearest - bgc)**2).sum(axis=2)), 90.0)
    a = np.clip(dist / dloc, 0, 1)
    a = np.where(dist < 45, 0.0, a)          # background noise / slight color drift between generations
    a = np.where(a > 0.97, 1.0, a)
    a_safe = np.maximum(a, 1e-3)[:,:,None]
    unmixed = ((rgb - (1-a_safe)*bgc) / a_safe).clip(0, 255)
    out = np.where(solid[:,:,None], rgb, unmixed)
    alpha = np.where(solid, 1.0, a)
    return out, alpha

def main(inp, outp, base_name, target_h=560, flip=False, crop=False, pad=8):
    os.makedirs(outp, exist_ok=True)
    files = sorted(glob.glob(os.path.join(inp,'*.jpg'))+glob.glob(os.path.join(inp,'*.jpeg'))+glob.glob(os.path.join(inp,'*.png')))
    load = lambda p: np.array(Image.open(p).convert('RGB')).astype(np.float32)
    base_path = [f for f in files if os.path.splitext(os.path.basename(f))[0]==base_name][0]
    base = load(base_path)
    results = []
    for f in files:
        n = os.path.splitext(os.path.basename(f))[0]
        a = load(f)
        a = a if f==base_path else fit_color(a, base)
        rgb, alpha = key_magenta(a)
        im = Image.fromarray(np.dstack([rgb, alpha*255]).astype(np.uint8), 'RGBA')
        if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)      # e.g. Dov: generated facing right, used facing left
        w = round(im.width*target_h/im.height)
        im = im.resize((w, target_h), Image.LANCZOS)
        results.append((n, im))
    if crop:   # same crop box for the whole set, so expressions stay aligned when swapped in game
        boxes = [im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox() for _, im in results]
        x0 = max(0, min(b[0] for b in boxes)-pad); y0 = max(0, min(b[1] for b in boxes)-pad)
        x1 = min(results[0][1].width, max(b[2] for b in boxes)+pad); y1 = min(target_h, max(b[3] for b in boxes)+pad)
        results = [(n, im.crop((x0, y0, x1, y1))) for n, im in results]
    for n, im in results:
        im.save(os.path.join(outp, n+'.png'), optimize=True)
        print(n, im.size)

if __name__ == '__main__':
    args=[x for x in sys.argv[1:] if not x.startswith('--')]
    main(args[0], args[1], args[2], int(args[3]) if len(args)>3 else 560, flip='--flip' in sys.argv, crop='--crop' in sys.argv)
