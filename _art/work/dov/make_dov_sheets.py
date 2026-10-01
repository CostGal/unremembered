"""Dov: idle + attack sheets (docs/ANIMATION.md, docs/ART_BRIEF.md).

Reproducible: run `python3 _art/work/dov/make_dov_sheets.py` from the repo root.
Inputs (untouched pixler exports):
  _art/raw/sprites/Dov_pixler.png   rest pose, 128x128, facing left
  _art/raw/sprites/man-attack.png   pixler punch, 8 frames (frame 0 ~ rest)
Outputs:
  public/assets/sprites/dov_idle.png, dov_attack.png (horizontal strips, facing left)

Rules kept: integer moves only (row shifts), no resampling, alpha 0/255,
first and last frame of the attack == rest (clean cut to/from idle).
"""
from PIL import Image

REST = '_art/raw/sprites/Dov_pixler.png'
PUNCH = '_art/raw/sprites/man-attack.png'
OUT = 'public/assets/sprites/'
SIZE = 128
# Rows above this line (head, shoulders, both fists) breathe; the coat skirt and legs stay planted.
BREATH_SPLIT = 74


def frames(path):
    im = Image.open(path).convert('RGBA')
    return [im.crop((i * SIZE, 0, (i + 1) * SIZE, SIZE)) for i in range(im.size[0] // SIZE)]


def sink(img, px):
    """The upper body sinks px rows (exhale): rows above BREATH_SPLIT move down, the
    rows they land on are replaced, rows below stay put."""
    out = img.copy()
    src = img.load()
    dst = out.load()
    for y in range(BREATH_SPLIT, -1, -1):
        for x in range(SIZE):
            dst[x, y] = src[x, y - px] if y - px >= 0 else (0, 0, 0, 0)
    return out


def strip(imgs):
    sheet = Image.new('RGBA', (SIZE * len(imgs), SIZE), (0, 0, 0, 0))
    for i, im in enumerate(imgs):
        sheet.paste(im, (i * SIZE, 0))
    return sheet


def check(name, imgs, rest):
    for i, im in enumerate(imgs):
        assert im.size == (SIZE, SIZE), (name, i)
        hist = im.getchannel('A').histogram()
        alphas = {a for a, n in enumerate(hist) if n}
        assert alphas <= {0, 255}, (name, i, alphas)
    if name == 'attack':
        assert imgs[0].tobytes() == rest.tobytes(), 'attack must start at rest'
        assert imgs[-1].tobytes() == rest.tobytes(), 'attack must end at rest'


def main():
    rest = Image.open(REST).convert('RGBA')

    # Idle: heavy, slow breath. rest -> sink 1 -> sink 2 -> sink 1 (loop back to rest).
    idle = [rest, sink(rest, 1), sink(rest, 2), sink(rest, 1)]

    # Attack: pixler frame 0 is rest with quantization noise, so the real rest
    # replaces it. 1-3 windup, 4 impact, 5-7 hold, then pull back through the
    # windup poses (3, 1) to rest.
    p = frames(PUNCH)
    attack = [rest, p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[3], p[1], rest]

    for name, imgs in (('idle', idle), ('attack', attack)):
        check(name, imgs, rest)
        strip(imgs).save(f'{OUT}dov_{name}.png', optimize=True)
        print(f'dov_{name}.png: {len(imgs)} frames')


if __name__ == '__main__':
    main()
