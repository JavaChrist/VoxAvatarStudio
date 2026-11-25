"""Cut Chris out of a plain backdrop without numba.

Used by prepare_outfits.py when rembg cannot be imported: Windows application control may block a numba DLL
that rembg needs for alpha matting. Same segmentation model as rembg (isnet-general-use, already downloaded
by rembg); the soft edges are then computed against the backdrop colour, which these sources keep plain.
"""

from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy.ndimage import binary_erosion, binary_fill_holes, gaussian_filter, label

MODEL = Path.home() / ".rembg" / "models" / "isnet-general-use" / "isnet-general-use.onnx"
HEAD_SHARE = 0.28  # top of the silhouette: hair, glasses and beard
HAIR_SHARE = 0.19  # top of the silhouette that stops above the shoulders
SMALL_HOLE = 1500  # pixels; an enclosed gap smaller than this is a mistake of the model (a nail, a reflection)


def small_holes(solid: np.ndarray) -> np.ndarray:
    """Small areas fully enclosed by the silhouette."""
    labels, _ = label(binary_fill_holes(solid) & ~solid)
    sizes = np.bincount(labels.ravel())
    sizes[0] = SMALL_HOLE  # label 0 is everything that is not a hole
    return (sizes < SMALL_HOLE)[labels]


def spread(rgb: np.ndarray, where: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """Colour of the pixels selected by `where`, spread over their neighbourhood, and how much of it reaches each pixel."""
    weight = gaussian_filter(where.astype(np.float32), sigma)
    color = np.stack([gaussian_filter(rgb[..., c] * where, sigma) for c in range(3)], axis=-1)
    return color / np.maximum(weight, 1e-6)[..., None], weight


class PlainBackdropCutter:
    def __init__(self) -> None:
        if not MODEL.exists():
            raise SystemExit(f"segmentation model not found: {MODEL}")
        self.session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])

    def mask(self, image: Image.Image) -> np.ndarray:
        """Foreground probability of each pixel, 0 to 1."""
        pixels = np.asarray(image.resize((1024, 1024), Image.LANCZOS), np.float32)
        pixels = pixels / max(pixels.max(), 1e-6) - 0.5
        feed = {self.session.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None]}
        out = self.session.run(None, feed)[0][0, 0]
        out = (out - out.min()) / (out.max() - out.min())
        small = Image.fromarray((out * 255).astype(np.uint8))
        return np.asarray(small.resize(image.size, Image.LANCZOS), np.float32) / 255

    def __call__(self, image: Image.Image) -> Image.Image:
        rgb = np.asarray(image, np.float32)
        mask = self.mask(image)

        rows = np.where((mask > 0.5).any(axis=1))[0]
        head = slice(rows[0], rows[0] + round(HEAD_SHARE * (rows[-1] - rows[0])))
        # Bright eyes behind the glasses can look like backdrop to the model: no holes inside the head.
        mask[head][binary_fill_holes(mask[head] > 0.9)] = 1
        mask[small_holes(mask > 0.9)] = 1

        sure_fg = binary_erosion(mask > 0.95, iterations=6)
        sure_bg = binary_erosion(mask < 0.05, iterations=6, border_value=1)
        band = ~sure_fg & ~sure_bg
        bg, bg_weight = spread(rgb, sure_bg, 25)
        fg, fg_weight = spread(rgb, sure_fg, 6)

        # Body: clean outline, the model's mask tightened. Lit skin is too close to the backdrop colour to do better.
        body = np.clip((mask - 0.2) / 0.6, 0, 1)

        # Hair: alpha is where an edge pixel sits between the backdrop colour and the nearby hair colour. Where
        # those two colours are too close to tell apart, the model's own mask is kept.
        diff = fg - bg
        contrast = (diff**2).sum(-1)
        projected = np.clip(((rgb - bg) * diff).sum(-1) / np.maximum(contrast, 1.0), 0, 1)
        trust = np.clip((np.sqrt(contrast) - 25) / 50, 0, 1) * (fg_weight > 0.02) * (bg_weight > 1e-4)
        fine = np.where(band, trust * projected + (1 - trust) * mask, sure_fg.astype(np.float32))
        fine = np.where(mask < 0.02, 0, fine)

        # The two blend over a few rows between the hair and the shoulders.
        share = np.zeros(mask.shape[0], np.float32)
        share[: rows[0] + round(HAIR_SHARE * (rows[-1] - rows[0]))] = 1
        share = gaussian_filter(share, 8, mode="nearest")[:, None]
        alpha = share * fine + (1 - share) * body

        # Remove the backdrop colour mixed into soft edge pixels.
        unmixed = (rgb - (1 - alpha[..., None]) * bg) / np.maximum(alpha, 0.15)[..., None]
        soft = (alpha > 0) & (alpha < 0.995)
        color = np.where(soft[..., None], np.clip(unmixed, 0, 255), rgb)
        return Image.fromarray(np.dstack([color, alpha * 255]).round().astype(np.uint8), "RGBA")
