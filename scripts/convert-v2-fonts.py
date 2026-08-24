#!/usr/bin/env python3
"""
Optional: build the QPC v2 (1423H) font set into public/fonts/v2.

v2 is only published as TTF, so it cannot be fetched during a cloud build the
way v1 can — it has to be converted locally. Requires `pip install fonttools
brotli` and a checkout of the font source.

Afterwards set NEXT_PUBLIC_MUSHAF_EDITION=v2 to use it. The corpus already
carries v2 glyph codes, so nothing else changes.

    git clone --depth 1 https://github.com/nuqayah/qpc-fonts /tmp/qpc-fonts
    QPC_SRC=/tmp/qpc-fonts/mushaf-v2 python3 scripts/convert-v2-fonts.py
"""
import glob
import os
import sys
from concurrent.futures import ProcessPoolExecutor

try:
    from fontTools.ttLib import TTFont
except ImportError:
    sys.exit("fonttools is required:  pip install fonttools brotli")

SRC = os.environ.get("QPC_SRC", "/tmp/qpc-fonts/mushaf-v2")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "fonts", "v2")


def convert(src):
    page = int(os.path.basename(src)[4:7])          # QCF2001.ttf -> 1
    dst = os.path.join(OUT, f"p{page}.woff2")
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return os.path.getsize(dst)
    font = TTFont(src)
    font.flavor = "woff2"
    font.save(dst)
    font.close()
    return os.path.getsize(dst)


if __name__ == "__main__":
    files = sorted(glob.glob(os.path.join(SRC, "QCF2[0-9][0-9][0-9].ttf")))
    if not files:
        sys.exit(f"no QCF2*.ttf found in {SRC} — set QPC_SRC to the mushaf-v2 directory")
    os.makedirs(OUT, exist_ok=True)
    print(f"converting {len(files)} fonts -> {OUT}")
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        sizes = list(ex.map(convert, files))
    print(f"done: {len(sizes)} files, {sum(sizes) / 1e6:.1f} MB "
          f"({sum(sizes) / len(sizes) / 1024:.0f} KB average)")
