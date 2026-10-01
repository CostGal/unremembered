# common.py — shared helpers for the Dov animation pipeline (Python + PIL only)
import json, os
from PIL import Image, ImageDraw

SRC = '/mnt/user-data/uploads'
OUT = '/home/claude/dov/out'
os.makedirs(OUT, exist_ok=True)

W = H = 128
FX = {(0xe0, 0xa0, 0x40), (0xf1, 0xef, 0xe8)}  # amber + white
CHAR = 'dov'

REST = Image.open(f'{SRC}/man.png').convert('RGBA')


def palette(im):
    return {p[:3] for p in im.getdata() if p[3] == 255}


PALETTE = palette(REST)


def load_sheet(name):
    """pixler sheet -> list of 128x128 frames"""
    sh = Image.open(f'{SRC}/man-{name}.png').convert('RGBA')
    n = sh.width // W
    return [sh.crop((i * W, 0, (i + 1) * W, H)) for i in range(n)]


def new_frame():
    return Image.new('RGBA', (W, H), (0, 0, 0, 0))


def paste(dst, src, dx=0, dy=0):
    """integer-offset alpha paste"""
    dst.alpha_composite(src, (dx, dy)) if dx >= 0 and dy >= 0 else _paste_neg(dst, src, dx, dy)
    return dst


def _paste_neg(dst, src, dx, dy):
    tmp = new_frame()
    x0 = max(0, -dx); y0 = max(0, -dy)
    tmp.alpha_composite(src.crop((x0, y0, W, H)), (max(0, dx), max(0, dy)))
    dst.alpha_composite(tmp)


def shift(im, dx, dy):
    return paste(new_frame(), im, dx, dy)


def assert_frame(fr, pal=None, allow_fx=True):
    pal = pal or PALETTE
    ok = pal | (FX if allow_fx else set())
    bad = set(); alpha = set()
    for p in fr.getdata():
        alpha.add(p[3])
        if p[3] == 255 and p[:3] not in ok:
            bad.add(p[:3])
    assert alpha <= {0, 255}, f'alpha {alpha}'
    assert not bad, f'off-palette {sorted(bad)[:8]}'


def components(fr, ignore_fx=True):
    """count 8-connected opaque components (FX pixels excluded)"""
    px = fr.load(); seen = set(); n = 0
    for y in range(H):
        for x in range(W):
            if px[x, y][3] == 255 and (x, y) not in seen and not (ignore_fx and px[x, y][:3] in FX):
                n += 1; st = [(x, y)]; seen.add((x, y))
                while st:
                    cx, cy = st.pop()
                    for nx in (cx - 1, cx, cx + 1):
                        for ny in (cy - 1, cy, cy + 1):
                            if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen:
                                q = px[nx, ny]
                                if q[3] == 255 and not (ignore_fx and q[:3] in FX):
                                    seen.add((nx, ny)); st.append((nx, ny))
    return n


def save_sheet(name, frames):
    sh = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        assert f.size == (W, H)
        sh.paste(f, (i * W, 0))
    sh.save(f'{OUT}/{CHAR}_{name}.png')
    return sh


def save_gif(name, frames, durations, scale=3, bg=(40, 40, 48)):
    """GIF preview at exact palette (bg + palette + FX, all <=256)"""
    out = []
    for f in frames:
        b = Image.new('RGBA', (W * scale, H * scale), bg + (255,))
        b.alpha_composite(f.resize((W * scale, H * scale), Image.NEAREST))
        out.append(b.convert('RGB').quantize(colors=256, dither=Image.NONE))
    out[0].save(f'{OUT}/{CHAR}_{name}.gif', save_all=True, append_images=out[1:],
                duration=durations, loop=0, disposal=2)


def contact(name, frames, scale=4, cols=None, bg=(40, 40, 48)):
    n = len(frames); cols = cols or n
    rows = (n + cols - 1) // cols
    sh = Image.new('RGB', (W * scale * cols, H * scale * rows), bg)
    d = ImageDraw.Draw(sh)
    for i, f in enumerate(frames):
        x = (i % cols) * W * scale; y = (i // cols) * H * scale
        b = Image.new('RGBA', (W * scale, H * scale), bg + (255,))
        b.alpha_composite(f.resize((W * scale, H * scale), Image.NEAREST))
        sh.paste(b.convert('RGB'), (x, y))
        d.text((x + 4, y + 4), str(i), fill=(255, 255, 0))
    sh.save(f'{OUT}/contact_{name}.png')
    return f'{OUT}/contact_{name}.png'


def diff_px(a, b):
    return sum(1 for p, q in zip(a.getdata(), b.getdata()) if p != q)


def write_json(anims):
    j = {'frame_size': [W, H], 'facing': 'left', 'animations': anims}
    with open(f'{OUT}/{CHAR}_animations.json', 'w') as f:
        json.dump(j, f, indent=2)


# ---- keyframe helpers (pixler sheets) -------------------------------------------------
from rig import split as _split
_PARTS, _ = _split()
HEAD = _PARTS['head']
HEAD_BOX = HEAD.getbbox()
_HEAD_CROP = HEAD.crop(HEAD_BOX)


def locate_head(frame, search=22):
    """best integer offset (dx,dy) of the rest head inside frame; returns (dx,dy,score 0..1)"""
    hp = _HEAD_CROP.load(); fp = frame.load()
    hw, hh = _HEAD_CROP.size; x0, y0 = HEAD_BOX[:2]
    pts = [(x, y) for y in range(hh) for x in range(hw) if hp[x, y][3]]
    best = (0, 0, -1)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            ok = 0
            for x, y in pts:
                fx, fy = x0 + x + dx, y0 + y + dy
                if 0 <= fx < W and 0 <= fy < H:
                    q = fp[fx, fy]; c = hp[x, y]
                    if q[3] and abs(q[0] - c[0]) + abs(q[1] - c[1]) + abs(q[2] - c[2]) < 60:
                        ok += 1
            if ok > best[2]:
                best = (dx, dy, ok)
    return best[0], best[1], best[2] / len(pts)


def patch_head(frame, min_score=0.85):
    dx, dy, s = locate_head(frame)
    if s < min_score:
        return frame, (dx, dy, s, False)
    out = frame.copy()
    # clear only where the shifted rest head is opaque, then paste it
    m = shift(HEAD, dx, dy)
    out.paste((0, 0, 0, 0), (0, 0), m.split()[3])
    out.alpha_composite(m)
    return out, (dx, dy, s, True)


SHEET_PALETTE = set(PALETTE)
for _n in ['attack', 'cast', 'brace', 'parry', 'dodge', 'idle', 'hurt', 'death', 'victory']:
    for _f in load_sheet(_n):
        SHEET_PALETTE |= palette(_f)
