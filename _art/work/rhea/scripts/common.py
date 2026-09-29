# common.py - shared helpers for the Rhea pipeline (Python + PIL, pixel-perfect)
import json, os, numpy as np
from PIL import Image

UP = '/mnt/user-data/uploads/'
OUT = '/mnt/user-data/outputs/rhea/'
os.makedirs(OUT, exist_ok=True)
FX = {(0x3f,0xd0,0xc9), (0xf1,0xef,0xe8)}
TEAL = (0x48,0xe8,0xc5)  # badge teal actually used in rhea.png

def load(path):
    return np.array(Image.open(path).convert('RGBA'))

RAW = load(UP+'rhea.png')
PAL = set(map(tuple, RAW[RAW[:,:,3]>0][:,:3]))
BADGE_OFF = (0x67,0x71,0x8d)   # inactive shoulder badge (muted grey-blue, in palette); teal only during Echo/cast
def badge_mask(a):
    return (a[:,:,3]>0)&(a[:,:,1]>140)&(a[:,:,2]>140)&(a[:,:,0]<130)
BASE = RAW.copy(); BASE[badge_mask(RAW)] = [*BADGE_OFF,255]   # canonical rest pose

def frames_of(sheet):
    n = sheet.shape[1]//sheet.shape[0]
    return [sheet[:, i*128:(i+1)*128].copy() for i in range(n)]

def assert_frame(fr, pal=None):
    pal = pal or PAL
    assert fr.shape == (128,128,4), fr.shape
    a = fr[:,:,3]
    assert set(np.unique(a)) <= {0,255}, 'alpha not 0/255'
    cols = set(map(tuple, fr[a>0][:,:3]))
    bad = cols - pal - FX
    assert not bad, f'off-palette colors: {list(bad)[:5]}'
    # transparent pixels must be pure 0
    assert (fr[a==0]==0).all()

def clean(fr):
    fr = fr.copy(); fr[fr[:,:,3]==0] = 0; return fr

def shift(part, dx=0, dy=0):
    out = np.zeros_like(part)
    H,W = part.shape[:2]
    ys, xs = slice(max(0,dy), min(H,H+dy)), slice(max(0,dx), min(W,W+dx))
    ys2, xs2 = slice(max(0,-dy), min(H,H-dy)), slice(max(0,-dx), min(W,W-dx))
    out[ys, xs] = part[ys2, xs2]
    return out

def over(dst, src):
    m = src[:,:,3]>0
    dst[m] = src[m]
    return dst

def row_shear(part, y0, y1, dx):
    """shift rows y0..y1 (inclusive) horizontally by dx (integer)."""
    out = part.copy()
    out[y0:y1+1] = shift(part[y0:y1+1], dx=dx)
    return out

def insert_row(part, y):
    """duplicate row y: everything above y moves up 1 (canvas height kept)."""
    out = np.zeros_like(part)
    out[:y-1] = part[1:y]
    out[y-1:] = part[y-1:]
    return out

def delete_row(part, y):
    """remove row y: everything above moves down 1."""
    out = np.zeros_like(part)
    out[1:y+1] = part[:y]
    out[y+1:] = part[y+1:]
    return out

def sheet(frames):
    s = np.zeros((128,128*len(frames),4), np.uint8)
    for i,f in enumerate(frames): s[:, i*128:(i+1)*128] = f
    return s

def save_png(arr, path):
    Image.fromarray(arr).save(path)

def save_gif(frames, durs, path, scale=2):
    ims = []
    for f in frames:
        bg = np.zeros_like(f); bg[:,:,:3] = (38,38,44); bg[:,:,3] = 255
        im = Image.fromarray(over(bg, f)).convert('RGB')
        im = im.resize((128*scale,128*scale), Image.NEAREST)
        ims.append(im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=durs, loop=0, disposal=2)

def contact(frames, path, scale=3, cols=None):
    cols = cols or len(frames)
    rows = (len(frames)+cols-1)//cols
    out = Image.new('RGBA', (cols*128, rows*128), (38,38,44,255))
    for i,f in enumerate(frames):
        im = Image.fromarray(f); out.paste(im, ((i%cols)*128, (i//cols)*128), im)
    out.resize((out.width*scale, out.height*scale), Image.NEAREST).save(path)
