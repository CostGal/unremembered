import sys, zipfile
from anim import *
from PIL import ImageDraw
OUT = '/home/claude/rhea/out'; os.makedirs(OUT, exist_ok=True)
ALLOWED = set(PALETTE) | {FX_TEAL, FX_WHITE}
BG = hx('1a1c28')

def validate(name, frames):
    bad = []
    for i, f in enumerate(frames):
        assert f.shape == (128, 128, 4)
        al = set(np.unique(f[:, :, 3]).tolist()); assert al <= {0, 255}, (name, i, al)
        cols = {tuple(int(v) for v in p) for p in f[f[:, :, 3] > 0][:, :3]}
        extra = cols - ALLOWED
        if extra: bad.append((i, extra))
    return bad

def save_all(only=None):
    meta = {'frame_size': [128, 128], 'facing': 'left', 'fx_colors': ['#3fd0c9', '#f1efe8'], 'animations': {}}
    all_frames = {}
    for name, (fn, durs) in ANIMS.items():
        if only and name not in only: continue
        frames = fn()
        assert len(frames) == len(durs), name
        bad = validate(name, frames)
        print(f'{name:8s} frames={len(frames)} palette_violations={bad}')
        all_frames[name] = frames
        sheet = Image.new('RGBA', (128 * len(frames), 128), (0, 0, 0, 0))
        for i, f in enumerate(frames): sheet.paste(Image.fromarray(f), (128 * i, 0))
        sheet.save(f'{OUT}/rhea_{name}.png')
        # GIF at 3x on dark bg, exact palette
        cols = sorted(ALLOWED | {BG})
        pal = []
        for c in cols: pal += list(c)
        pal += [0] * (768 - len(pal))
        pimg = Image.new('P', (1, 1)); pimg.putpalette(pal)
        gf = []
        for f in frames:
            bg = Image.new('RGBA', (128, 128), BG + (255,)); bg.alpha_composite(Image.fromarray(f))
            q = bg.convert('RGB').quantize(palette=pimg, dither=Image.Dither.NONE)
            gf.append(q.resize((384, 384), Image.NEAREST))
        gf[0].save(f'{OUT}/rhea_{name}_preview.gif', save_all=True, append_images=gf[1:], duration=durs, loop=0,
                   disposal=1, optimize=False)
        meta['animations'][name] = {'sheet': f'rhea_{name}.png', 'frames': len(frames), 'loop': name not in ('attack', 'hurt', 'death', 'cast'),
                                    'durations_ms': durs}
    return all_frames, meta

if __name__ == '__main__':
    all_frames, meta = save_all()
    json.dump(meta, open(f'{OUT}/animations.json', 'w'), indent=2)
    # contact sheet
    S = 2; pad = 70
    rows = list(all_frames.items()); maxn = max(len(f) for _, f in rows)
    cs = Image.new('RGBA', (pad + maxn * 128 * S, len(rows) * 128 * S), BG + (255,))
    d = ImageDraw.Draw(cs)
    for r, (name, frames) in enumerate(rows):
        d.text((6, r * 128 * S + 120), name, fill=(230, 230, 230, 255))
        for i, f in enumerate(frames):
            cell = Image.fromarray(f).resize((128 * S, 128 * S), Image.NEAREST)
            x, y = pad + i * 128 * S, r * 128 * S
            d.rectangle([x, y, x + 128 * S - 1, y + 128 * S - 1], outline=(45, 48, 66, 255))
            cs.alpha_composite(cell, (x, y))
    cs.save(f'{OUT}/rhea_contact_sheet.png')
    print('done')
