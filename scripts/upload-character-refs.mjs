// Copie les images de référence de Chris (une par tenue, pose et format) dans le bucket Storage, au même chemin que dans le dépôt.
// La liste vient du catalogue characters/chris/tenues.json (scripts/prepare_outfits.py).
// Elles restent privées : fal.ai les reçoit plus tard par URL signée temporaire.
// Usage : npm run upload:character        (envoie seulement ce qui manque ou a changé)
//         npm run upload:character -- --check   (vérifie sans rien envoyer)
// N'affiche aucune variable d'environnement.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const checkOnly = process.argv.includes("--check");
const catalog = JSON.parse(readFileSync("characters/chris/tenues.json", "utf8"));
const paths = catalog.outfits.flatMap((outfit) => Object.values(outfit.poses).flatMap((pose) => Object.values(pose.reference_images)));
if (paths.length === 0) throw new Error("Catalogue des tenues vide");
console.log(`${paths.length} images de référence dans le catalogue`);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable manquante : ${name}`);
  return value;
}

initializeApp({
  credential: cert({
    projectId: env("FIREBASE_ADMIN_PROJECT_ID"),
    clientEmail: env("FIREBASE_ADMIN_CLIENT_EMAIL"),
    privateKey: env("FIREBASE_ADMIN_PRIVATE_KEY").replace(/\\n/g, "\n"),
  }),
});
const bucket = getStorage().bucket(env("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"));

let problems = 0;
for (const path of paths) {
  const bytes = readFileSync(path);
  const md5 = createHash("md5").update(bytes).digest("base64");
  const file = bucket.file(path);
  const [exists] = await file.exists();
  const remote = exists ? (await file.getMetadata())[0] : null;

  if (remote?.md5Hash !== md5) {
    if (checkOnly) {
      console.log(`${path} : ${exists ? "différent du dépôt" : "absent"}`);
      problems += 1;
      continue;
    }
    // Aucun jeton de téléchargement Firebase n'est ajouté : pas de lien public possible.
    await file.save(bytes, { resumable: false, contentType: "image/png", metadata: { cacheControl: "private, max-age=0" } });
    console.log(`${path} : envoyé (${bytes.length} octets)`);
  } else {
    console.log(`${path} : déjà à jour`);
  }

  const [metadata] = await file.getMetadata();
  const [isPublic] = await file.isPublic();
  const token = Boolean(metadata.metadata?.firebaseStorageDownloadTokens);
  const sameBytes = metadata.md5Hash === md5;
  console.log(`  taille ${metadata.size}, type ${metadata.contentType}, identique ${sameBytes}, public ${isPublic}, jeton ${token}`);
  if (!sameBytes || isPublic || token) problems += 1;
}

if (problems > 0) {
  console.error(`${problems} problème(s).`);
  process.exit(1);
}
console.log("OK : images de référence présentes, identiques au dépôt et privées.");
