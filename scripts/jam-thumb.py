#!/usr/bin/env python3
"""Writes thumb.jpg (1280x720, < 500 KB) for the game-jam build.

The title key art (portrait) is cover-cropped to 16:9 and darkened a little,
the logo is centred on it at about 60 % of the width.

  python3 scripts/jam-thumb.py [out.jpg]      (default: dist-jam/thumb.jpg)
"""
import os
import sys

from PIL import Image, ImageEnhance

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
W, H = 1280, 720
DARKEN = 0.8  # 1 = untouched
LOGO_WIDTH_PCT = 0.6
CROP_CENTER_Y = 0.42  # which part of the portrait art stays in the 16:9 band (0 top .. 1 bottom)
MAX_BYTES = 500 * 1024


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist-jam", "thumb.jpg")
    bg = Image.open(os.path.join(ROOT, "public/assets/ui/title_bg.jpg")).convert("RGB")
    scale = max(W / bg.width, H / bg.height)
    bg = bg.resize((round(bg.width * scale), round(bg.height * scale)), Image.LANCZOS)
    left = (bg.width - W) // 2
    top = min(max(round(bg.height * CROP_CENTER_Y - H / 2), 0), bg.height - H)
    bg = bg.crop((left, top, left + W, top + H))
    bg = ImageEnhance.Brightness(bg).enhance(DARKEN)

    logo = Image.open(os.path.join(ROOT, "public/assets/ui/logo.png")).convert("RGBA")
    lw = round(W * LOGO_WIDTH_PCT)
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    bg = bg.convert("RGBA")
    bg.alpha_composite(logo, ((W - logo.width) // 2, (H - logo.height) // 2))

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    quality = 85
    while True:
        bg.convert("RGB").save(out, "JPEG", quality=quality, optimize=True)
        size = os.path.getsize(out)
        if size <= MAX_BYTES or quality <= 60:
            break
        quality -= 5
    print(f"thumb.jpg {W}x{H} q{quality} {size // 1024} KB -> {out}")
    if size > MAX_BYTES:
        sys.exit("thumb.jpg is over 500 KB")


if __name__ == "__main__":
    main()
