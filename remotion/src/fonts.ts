// Police Geist (SIL OFL 1.1, voir public/fonts/LICENSE-Geist.txt), chargée avant le premier rendu d'image.
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

export const FONT_FAMILY = "Geist";

const WEIGHTS = [
  { weight: "600", file: "fonts/Geist-SemiBold.woff2" },
  { weight: "700", file: "fonts/Geist-Bold.woff2" },
];

const handle = delayRender("Chargement de la police Geist");

Promise.all(
  WEIGHTS.map(async ({ weight, file }) => {
    const face = new FontFace(FONT_FAMILY, `url(${staticFile(file)}) format("woff2")`, { weight });
    document.fonts.add(await face.load());
  }),
)
  .then(() => continueRender(handle))
  .catch((error: unknown) => cancelRender(error));
