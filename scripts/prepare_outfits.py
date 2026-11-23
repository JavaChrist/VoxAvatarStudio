"""Build every reference image of Chris, one per outfit, pose and output format, on pure green.

Sources live in Personnage/Tenues/<outfit name>/, one image per pose:
  debout.png  standing, full body, facing the viewer (framing of the grey T-shirt one)
  assis.png   seated behind a desk, desk across the bottom (framing of the "portrait 3D au bureau" ones)
The folder name is the name shown in the app. A missing pose image just means that pose is not offered.

Chris is cut out locally with rembg and never redrawn, so his identity stays as in the source.
Kling AI Avatar keeps the input image's aspect ratio, so each format gets its own image.

Usage: python scripts/prepare_outfits.py            (needs python -m pip install "rembg[cpu]")
Output: characters/chris/tenues/<id>/<pose>/chris-<format>.png (+ cutout.png),
        public/characters/chris/<id>-<pose>.webp (thumbnail for the app),
        characters/chris/tenues.json (catalog read by the app and the upload script)
"""

import json
import re
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "Personnage" / "Tenues"
OUT = ROOT / "characters" / "chris" / "tenues"
THUMBS = ROOT / "public" / "characters" / "chris"
CATALOG = ROOT / "characters" / "chris" / "tenues.json"
DEFAULT_OUTFIT = "t-shirt-gris"
GREEN = (0, 255, 0)
POSE_FILES = {"standing": "debout.png", "seated": "assis.png"}
THUMB_HEIGHT = 320

# Standing: where the body is cut, as a share of the source height (taller formats show more of the body).
STANDING = {
    "9:16": {"size": (1080, 1920), "cut": 1250 / 1536},  # down to mid-thigh
    "4:5": {"size": (1080, 1350), "cut": 1060 / 1536},  # down to the hips
    "1:1": {"size": (1080, 1080), "cut": 960 / 1536},  # down to the waist
}
TOP_MARGIN = 0.07  # empty space above the head, as a share of canvas height
SIDE_MARGIN = 0.05  # minimum empty space on each side

# Seated: head_top is where the top of the hair lands, desk_below how much desk shows under its top edge,
# both as a share of canvas height. Above the head: room for the image cards; on the desk: the captions.
SEATED = {
    "9:16": {"size": (1080, 1920), "head_top": 0.40, "desk_below": 0.17},
    "4:5": {"size": (1080, 1350), "head_top": 0.34, "desk_below": 0.14},
    "1:1": {"size": (1080, 1080), "head_top": 0.26, "desk_below": 0.15},
}
OPAQUE_BELOW_EDGE = 4  # rows under the desk edge forced opaque (rembg can thin out flat wood)
ARMS_ON_EDGE_ROWS = 75  # source rows under that where the elbows and hands (with their shadow) rest on the desk


def slug(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def is_wood(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    return r - b > 60


def desk_top(image: Image.Image) -> int:
    """First row, scanning both edges from the middle down, where the wall turns into wood."""
    for y in range(image.height // 2, image.height):
        if is_wood(image.getpixel((3, y))) and is_wood(image.getpixel((image.width - 4, y))):
            return y
    raise SystemExit("desk edge not found")


def standing(cutout: Image.Image, out: Path) -> dict[str, str]:
    refs = {}
    for fmt, spec in STANDING.items():
        cw, ch = spec["size"]
        cut_y = round(cutout.height * spec["cut"])
        body = cutout.crop((0, 0, cutout.width, cut_y))
        left, top, right, _ = body.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
        body = body.crop((left, top, right, cut_y))
        # Biggest scale that fits the width (with side margins) and the height (with headroom).
        scale = min(cw * (1 - 2 * SIDE_MARGIN) / body.width, ch * (1 - TOP_MARGIN) / body.height)
        body = body.resize((round(body.width * scale), round(body.height * scale)), Image.LANCZOS)
        canvas = Image.new("RGB", (cw, ch), GREEN)
        canvas.paste(body, ((cw - body.width) // 2, ch - body.height), body)
        refs[fmt] = save(canvas, out, fmt)
    return refs


def seated(source: Image.Image, cutout: Image.Image, out: Path) -> dict[str, str]:
    edge = desk_top(source)
    hair_top = cutout.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()[1]
    refs = {}
    for fmt, spec in SEATED.items():
        cw, ch = spec["size"]
        scale = ch * (1 - spec["head_top"] - spec["desk_below"]) / (edge - hair_top)
        bottom = edge + round(spec["desk_below"] * ch / scale)
        if bottom > cutout.height:
            print(f"  warning: {fmt} needs {bottom - cutout.height} more desk rows than the source has")
            bottom = cutout.height
        body = cutout.crop((0, hair_top, cutout.width, bottom))
        body = body.resize((round(body.width * scale), round(body.height * scale)), Image.LANCZOS)

        canvas = Image.new("RGB", (cw, ch), GREEN)
        x = (cw - body.width) // 2
        y = ch - body.height

        # Desk band widened with mirrored copies on each side, so the desk reaches both edges.
        band_top = round((edge + OPAQUE_BELOW_EDGE - hair_top) * scale)
        band = body.crop((0, band_top, body.width, body.height)).convert("RGB")
        # Elbows and hands rest on the desk: in the copies, the top rows are replaced by plain wood from just below.
        arms = min(band.height // 2, round(ARMS_ON_EDGE_ROWS * scale))
        if arms:
            band.paste(band.crop((0, arms, band.width, 2 * arms)), (0, 0))
        mirrored = ImageOps.mirror(band)
        for offset in range(-body.width, cw + body.width, body.width):
            tile = band if (offset // body.width) % 2 == 0 else mirrored
            canvas.paste(tile, (x + offset, y + band_top))

        canvas.paste(body, (x, y), body)
        refs[fmt] = save(canvas, out, fmt)
    return refs


def save(canvas: Image.Image, out: Path, fmt: str) -> str:
    path = out / f"chris-{fmt.replace(':', 'x')}.png"
    canvas.save(path)
    print(f"  {rel(path)}")
    return rel(path)


def thumbnail(cutout: Image.Image, path: Path) -> str:
    """Transparent WebP of the cut-out character, shown in the app's outfit picker."""
    box = cutout.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    image = cutout.crop(box)
    image = image.resize((round(image.width * THUMB_HEIGHT / image.height), THUMB_HEIGHT), Image.LANCZOS)
    image.save(path, "WEBP", quality=85)
    return "/" + path.relative_to(ROOT / "public").as_posix()


def main() -> None:
    session = new_session("isnet-general-use")  # keeps fine hair and beard edges better than u2net
    THUMBS.mkdir(parents=True, exist_ok=True)
    outfits = []
    for folder in sorted(p for p in SOURCES.iterdir() if p.is_dir()):
        outfit_id = slug(folder.name)
        poses = {}
        for pose, file_name in POSE_FILES.items():
            source_path = folder / file_name
            if not source_path.exists():
                continue
            print(f"{folder.name} / {pose}")
            out = OUT / outfit_id / pose
            out.mkdir(parents=True, exist_ok=True)
            source = Image.open(source_path).convert("RGB")
            cutout = remove(source, session=session, alpha_matting=True)
            if pose == "seated":
                # Everything under the desk edge is desk: original pixels, fully opaque. Alpha matting can
                # fail on flat wood and shift its colours, so the cutout's own pixels are not kept there.
                below = (0, desk_top(source) + OPAQUE_BELOW_EDGE, cutout.width, cutout.height)
                cutout.paste(source.crop(below).convert("RGBA"), below[:2])
            cutout.save(out / "cutout.png")
            refs = standing(cutout, out) if pose == "standing" else seated(source, cutout, out)
            poses[pose] = {
                "source": rel(source_path),
                "thumbnail": thumbnail(cutout, THUMBS / f"{outfit_id}-{pose}.webp"),
                "reference_images": refs,
            }
        if poses:
            outfits.append({"id": outfit_id, "name": folder.name, "poses": poses})

    if not any(o["id"] == DEFAULT_OUTFIT and "standing" in o["poses"] for o in outfits):
        raise SystemExit(f"default outfit {DEFAULT_OUTFIT} needs a standing image")
    # The default outfit first, then the others in alphabetical order.
    outfits.sort(key=lambda o: (o["id"] != DEFAULT_OUTFIT, o["name"].lower()))
    catalog = {"default_outfit": DEFAULT_OUTFIT, "default_pose": "standing", "outfits": outfits}
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{rel(CATALOG)}: {len(outfits)} outfits")


if __name__ == "__main__":
    main()
