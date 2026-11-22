"""Build Chris's reference images on pure green, one per output format.

Kling AI Avatar keeps the input image's aspect ratio, so each format gets its own image.
The character pixels are never redrawn: rembg cuts Chris out locally, then he is placed on
#00FF00 and the canvas is extended to the format. His identity stays exactly as in the source.

Usage: python scripts/prepare_chris_reference.py
Output: characters/chris/ref/cutout.png (transparent) and chris-9x16.png, chris-4x5.png, chris-1x1.png
"""

from pathlib import Path

from PIL import Image
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Personnage" / "Homme 3D à lunettes et bouc-6.png"
OUT = ROOT / "characters" / "chris" / "ref"
GREEN = (0, 255, 0)

# Canvas size per format, and where the body is cut (source-image row, 1536 px tall).
# Taller formats show more of the body so the face is not tiny and the canvas is not mostly empty.
FORMATS = {
    "9x16": {"size": (1080, 1920), "cut_y": 1250},  # down to mid-thigh
    "4x5": {"size": (1080, 1350), "cut_y": 1060},  # down to the hips
    "1x1": {"size": (1080, 1080), "cut_y": 960},  # down to the waist
}
TOP_MARGIN = 0.07  # empty space above the head, as a share of canvas height
SIDE_MARGIN = 0.05  # minimum empty space on each side


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")

    # isnet-general-use keeps fine hair and beard edges better than the default u2net.
    session = new_session("isnet-general-use")
    cutout = remove(source, session=session, alpha_matting=True)
    cutout.save(OUT / "cutout.png")

    for name, spec in FORMATS.items():
        cw, ch = spec["size"]
        body = cutout.crop((0, 0, cutout.width, spec["cut_y"]))
        left, top, right, bottom = body.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        body = body.crop((left, top, right, spec["cut_y"]))

        # Biggest scale that fits the width (with side margins) and the height (with headroom).
        scale = min(cw * (1 - 2 * SIDE_MARGIN) / body.width, ch * (1 - TOP_MARGIN) / body.height)
        body = body.resize((round(body.width * scale), round(body.height * scale)), Image.LANCZOS)

        canvas = Image.new("RGB", (cw, ch), GREEN)
        x = (cw - body.width) // 2
        y = ch - body.height  # body cut sits on the bottom edge, like a real framing
        canvas.paste(body, (x, y), body)
        canvas.save(OUT / f"chris-{name}.png")
        print(f"chris-{name}.png  {cw}x{ch}  character {body.width}x{body.height}")


if __name__ == "__main__":
    main()
