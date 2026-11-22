import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Identifiant de la version construite, comparé par l'application pour détecter un nouveau déploiement.
function readBuildId(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "local";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: readBuildId(),
  },
  // Les images de Chris et le test ne font pas partie de l'app.
  outputFileTracingExcludes: {
    "*": ["Personnage/**", "spike/**", "characters/**/cutout.png"],
  },
  // Le service worker et l'identifiant de version ne doivent jamais être servis depuis un cache.
  async headers() {
    const noCache = [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }];
    return [
      { source: "/sw.js", headers: noCache },
      { source: "/version.json", headers: noCache },
    ];
  },
};

export default nextConfig;
