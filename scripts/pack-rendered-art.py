"""Rebuild the runtime packs from exported WebPs; requires Pillow only offline.

Sample: python3 scripts/pack-rendered-art.py /path/to/all-rendered-webps
"""
import base64
import json
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path("assets/pilot/packs")
OUT.mkdir(parents=True, exist_ok=True)
FIGHTERS = ("bear", "elephant", "panda", "hummingbird", "orca", "jelly")
POSES = ("idle", "cast", "hit", "defend", "ko")
FX = {
    "bear": ("ember", "fireball", "meteor"),
    "elephant": ("water", "wind", "shockwave"),
    "panda": ("shadow", "leaf"),
    "hummingbird": ("hammer", "airhammer", "hammerquake"),
    "orca": ("note", "bass", "heal"),
    "jelly": ("electric", "shield-back", "shield-front", "fortress-back", "fortress-front"),
    "shared": ("focus", "guard-back", "guard-front"),
}


def get(name, size=None):
    p = SRC / (name + ".webp")
    with Image.open(p) as im:
        assert im.format == "WEBP" and im.mode == "RGBA", p
        assert 0 == im.getchannel("A").getextrema()[0], p
        if size is not None:
            im.thumbnail(size, Image.Resampling.LANCZOS)
            buf = BytesIO()
            im.save(buf, "WEBP", quality=83, method=6)
            return buf.getvalue()
    return p.read_bytes()


def put(name, contents):
    path = OUT / (name + ".json")
    path.write_text(json.dumps({
        key: base64.b64encode(value).decode("ascii")
        for key, value in sorted(contents.items())
    }, separators=(",", ":")) + "\n", encoding="ascii")
    print(path.name, len(contents), path.stat().st_size)


portraits = {}
for char in FIGHTERS:
    keys = {f"{char}-{palette}-{pose}" for palette in "ab" for pose in POSES}
    for palette in "ab":
        portraits[f"{char}-{palette}"] = get(f"{char}-{palette}-idle", (192, 192))
    put("cast-" + char, {key: get(key) for key in keys})
put("portraits", portraits)
for char, keys in FX.items():
    put("fx-" + char, {key: get(key) for key in keys})
