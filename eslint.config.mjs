import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const nativeDialogs = ["alert", "confirm", "prompt"];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Convention : jamais de boîte de dialogue native, toujours une modale.
    rules: {
      "no-alert": "error",
      "no-restricted-globals": ["error", ...nativeDialogs.map((name) => ({ name, message: "Utiliser useModal()." }))],
      "no-restricted-properties": [
        "error",
        ...nativeDialogs.map((property) => ({ object: "window", property, message: "Utiliser useModal()." })),
      ],
    },
  },
  {
    // Les secrets et le SDK Admin ne vivent que dans src/server.
    files: ["src/**"],
    ignores: ["src/server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        // Regex ancrées : un motif simple bloquerait aussi nos modules @/server/firebase-admin.
        { patterns: [{ regex: "^(firebase-admin|@anthropic-ai/sdk|@fal-ai/client)(/.*)?$", message: "SDK serveur : passer par src/server." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "node_modules/**", "spike/**", "Personnage/**", "next-env.d.ts"]),
]);
