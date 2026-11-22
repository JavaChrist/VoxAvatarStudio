import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VoxAvatar Studio",
    short_name: "VoxAvatar",
    description: "Vidéos courtes présentées par Chris, du script à l'export MP4.",
    lang: "fr",
    start_url: "/",
    display: "standalone",
    theme_color: "#000000",
    background_color: "#000000",
    icons: [
      { src: "/logo192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
