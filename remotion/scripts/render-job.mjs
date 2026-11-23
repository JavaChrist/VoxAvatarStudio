// Rendu d'une vidéo finale à partir d'un travail déposé dans Storage, sur GitHub Actions ou en local.
//
// Le dépôt est public, donc les logs du workflow aussi : seul l'identifiant du rendu passe en entrée.
// Le détail (projet, format, titre, signature) est lu dans le fichier privé render-jobs/{RENDER_ID}.json, et ce
// script n'affiche jamais ni chemin Storage, ni identifiant de projet, ni titre, ni contenu de la signature.
//
// Fichier de travail (écrit par le serveur Next.js) :
//   { "version": 1, "projectId": "...", "format": "9:16", "title": "...", "durationSeconds": 34.8,
//     "pose": "standing" | "seated",
//     "signature": null | { "displayName", "tagline", "website", "handle", "qrUrl",
//                           "logoPath": "render-jobs/{RENDER_ID}.logo.png" | null, "logoType": "image/png" | null },
//     "background": null | { "path": "render-jobs/{RENDER_ID}.background.jpg", "type": "image/jpeg" },
//     "music": null | { "path": "render-jobs/{RENDER_ID}.music.mp3", "type": "audio/mpeg", "volume": 15 },
//     "inserts": [{ "scene": 0, "path": "render-jobs/{RENDER_ID}.insert-0.png", "type": "image/png", "start": 0, "end": 6.8 }] }
// Le QR code est dessiné par Remotion à partir de qrUrl ; le logo et le fond, copiés par le serveur, sont téléchargés ici.
// "pose", "background", "music" et "inserts" peuvent manquer dans les travaux plus anciens : Chris debout, dégradé par défaut, ni musique ni image.
// Résultat écrit à la fin dans render-jobs/{RENDER_ID}.result.json :
//   { "state": "done", "outputPath", "sizeBytes", "renderSeconds", "finishedAt" }
//   { "state": "failed", "step", "finishedAt" }
//
// Variables d'environnement :
//   RENDER_ID                     identifiant du rendu (obligatoire)
//   RENDER_BUCKET                 bucket Storage (sinon NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, pour le test local)
//   GOOGLE_SERVICE_ACCOUNT_JSON   clé JSON du compte de service limité à Storage (GitHub Actions)
//   FIREBASE_ADMIN_*              à défaut, identifiants du serveur (test local avec node --env-file)
import { Storage } from "@google-cloud/storage";
import { JWT } from "google-auth-library";
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORMATS = ["9:16", "4:5", "1:1"];
/** Poses de Chris (src/features/projects/appearance.ts) : elles règlent le cadrage dans Short.tsx. */
const POSES = ["standing", "seated"];
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_SECONDS = 120;

/** Mêmes limites que SIGNATURE_LIMITS dans l'app (src/features/signatures/schema.ts). */
const SIGNATURE_TEXT_MAX = { displayName: 60, tagline: 120, website: 80, handle: 40, qrUrl: 300 };
const LOGO_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
/** Mêmes types et limites de volume que src/features/music/schema.ts. */
const MUSIC_EXTENSIONS = { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav" };
const MUSIC_VOLUME_MIN = 5;
const MUSIC_VOLUME_MAX = 100;
/** Même limite que SCRIPT_LIMITS.scenesMax dans l'app : une image au plus par scène. */
const INSERTS_MAX = 12;

/** Détourage validé au test local du 2026-11-23 sur la vidéo Kling : bords nets, pas de reflet vert. */
const CHROMA_FILTER = "chromakey=0x00FF00:0.28:0.08,despill=type=green,format=yuva420p";

/** Erreur dont le message est sûr à afficher dans des logs publics. */
class StepError extends Error {
  constructor(step, detail) {
    super(detail ? `${step} : ${detail}` : step);
    this.step = step;
  }
}

const log = (message) => console.log(`[rendu] ${message}`);

/** Client Storage authentifié par un JWT de compte de service, limité au scope lecture/écriture Storage. */
function storageClient() {
  let email, key, projectId;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      ({ client_email: email, private_key: key, project_id: projectId } = json);
    } catch {
      throw new StepError("Clé du compte de service illisible");
    }
  } else {
    email = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    key = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
    projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  }
  if (!email || !key || !projectId) throw new StepError("Identifiants Storage absents");
  const authClient = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/devstorage.read_write"] });
  return new Storage({ projectId, authClient });
}

/** Valide le fichier de travail : il décide de chemins d'écriture, rien n'est accepté tel quel. */
function parseJob(raw, renderId) {
  const job = typeof raw === "object" && raw ? raw : {};
  if (job.version !== 1) throw new StepError("Travail invalide", "version");
  if (typeof job.projectId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(job.projectId)) {
    throw new StepError("Travail invalide", "projectId");
  }
  if (!FORMATS.includes(job.format)) throw new StepError("Travail invalide", "format");
  if (typeof job.title !== "string" || job.title.length > 200) throw new StepError("Travail invalide", "title");
  const seconds = job.durationSeconds;
  if (typeof seconds !== "number" || !(seconds > 0 && seconds <= MAX_SECONDS)) {
    throw new StepError("Travail invalide", "durationSeconds");
  }
  // Absente des travaux plus anciens : Chris debout.
  const pose = job.pose ?? "standing";
  if (!POSES.includes(pose)) throw new StepError("Travail invalide", "pose");
  return {
    projectId: job.projectId,
    format: job.format,
    title: job.title.trim(),
    durationSeconds: seconds,
    pose,
    signature: parseSignature(job.signature, renderId),
    background: parseBackground(job.background, renderId),
    music: parseMusic(job.music, renderId),
    inserts: parseInserts(job.inserts, renderId, seconds),
  };
}

/** Valide les images insérées ; liste vide si aucune. Chaque image ne peut venir que de la copie faite pour ce rendu. */
function parseInserts(raw, renderId, durationSeconds) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > INSERTS_MAX) throw new StepError("Travail invalide", "inserts");
  const seen = new Set();
  return raw.map((item) => {
    if (typeof item !== "object" || item === null) throw new StepError("Travail invalide", "inserts");
    const { scene, type, path, start, end } = item;
    if (!Number.isInteger(scene) || scene < 0 || scene >= INSERTS_MAX || seen.has(scene)) {
      throw new StepError("Travail invalide", "inserts.scene");
    }
    seen.add(scene);
    const extension = LOGO_EXTENSIONS[type];
    if (!extension || path !== `render-jobs/${renderId}.insert-${scene}.${extension}`) {
      throw new StepError("Travail invalide", "inserts.path");
    }
    if (typeof start !== "number" || typeof end !== "number" || !(start >= 0 && end > start && start < durationSeconds)) {
      throw new StepError("Travail invalide", "inserts.timing");
    }
    return { scene, path, file: `insert-${scene}.${extension}`, start, end: Math.min(end, durationSeconds) };
  });
}

/** Valide la musique du travail ; null si aucune. La piste ne peut venir que de la copie faite pour ce rendu. */
function parseMusic(raw, renderId) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new StepError("Travail invalide", "music");
  const extension = MUSIC_EXTENSIONS[raw.type];
  if (!extension || raw.path !== `render-jobs/${renderId}.music.${extension}`) {
    throw new StepError("Travail invalide", "music");
  }
  const volume = raw.volume;
  if (!Number.isInteger(volume) || volume < MUSIC_VOLUME_MIN || volume > MUSIC_VOLUME_MAX) {
    throw new StepError("Travail invalide", "music.volume");
  }
  return { path: raw.path, file: `music.${extension}`, volume };
}

/** Valide le fond du travail ; null si aucun. L'image ne peut venir que de la copie faite pour ce rendu. */
function parseBackground(raw, renderId) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new StepError("Travail invalide", "background");
  const extension = LOGO_EXTENSIONS[raw.type];
  if (!extension || raw.path !== `render-jobs/${renderId}.background.${extension}`) {
    throw new StepError("Travail invalide", "background");
  }
  return { path: raw.path, file: `background.${extension}` };
}

/** Valide la signature du travail ; null si aucune. Le logo ne peut venir que de la copie faite pour ce rendu. */
function parseSignature(raw, renderId) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") throw new StepError("Travail invalide", "signature");
  const signature = {};
  for (const [field, max] of Object.entries(SIGNATURE_TEXT_MAX)) {
    const value = raw[field];
    if (typeof value !== "string" || value.length > max) throw new StepError("Travail invalide", `signature.${field}`);
    signature[field] = value.trim();
  }
  if (signature.qrUrl) {
    let url;
    try {
      url = new URL(signature.qrUrl);
    } catch {
      throw new StepError("Travail invalide", "signature.qrUrl");
    }
    if (url.protocol !== "https:") throw new StepError("Travail invalide", "signature.qrUrl");
  }
  let logo = null;
  if (raw.logoPath !== null || raw.logoType !== null) {
    const extension = LOGO_EXTENSIONS[raw.logoType];
    if (!extension || raw.logoPath !== `render-jobs/${renderId}.logo.${extension}`) {
      throw new StepError("Travail invalide", "signature.logo");
    }
    logo = { path: raw.logoPath, file: `logo.${extension}` };
  }
  return { ...signature, logo };
}

/** Lance une commande sans shell ; ses erreurs restent dans les logs, elles ne contiennent que des chemins locaux. */
function run(step, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", () => reject(new StepError(step, "commande introuvable")));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new StepError(step, `code ${code}`))));
  });
}

/** Opération Storage dont l'erreur est réduite à son code : un message Google contiendrait le chemin. */
async function storageStep(step, action) {
  try {
    return await action();
  } catch (error) {
    throw new StepError(step, typeof error === "object" && error && "code" in error ? `code ${error.code}` : "échec");
  }
}

async function main() {
  const renderId = process.env.RENDER_ID ?? "";
  if (!ID_PATTERN.test(renderId)) throw new StepError("Identifiant de rendu invalide");
  const bucketName = (process.env.RENDER_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "").trim();
  if (!bucketName) throw new StepError("Bucket Storage absent");

  const bucket = storageClient().bucket(bucketName);
  const resultFile = bucket.file(`render-jobs/${renderId}.result.json`);
  const started = Date.now();
  // Dossier de travail dans public/ : Remotion sert ces fichiers via staticFile(). Ignoré par Git.
  const work = join(ROOT, "public", "jobs", renderId);
  const output = join(ROOT, "out", `${renderId}.mp4`);

  try {
    log("lecture du travail");
    const [content] = await storageStep("Lecture du travail", () => bucket.file(`render-jobs/${renderId}.json`).download());
    let raw;
    try {
      raw = JSON.parse(content.toString("utf8"));
    } catch {
      throw new StepError("Travail invalide", "JSON");
    }
    const job = parseJob(raw, renderId);
    const slug = job.format.replace(":", "x");
    const base = `projects/${job.projectId}`;

    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    await mkdir(join(ROOT, "out"), { recursive: true });

    log("téléchargement des médias");
    const inputs = [
      [`${base}/avatar-${slug}.mp4`, "avatar.mp4"],
      [`${base}/voice.mp3`, "voice.mp3"],
      [`${base}/voice-alignment.json`, "voice-alignment.json"],
    ];
    if (job.signature?.logo) inputs.push([job.signature.logo.path, job.signature.logo.file]);
    if (job.background) inputs.push([job.background.path, job.background.file]);
    if (job.music) inputs.push([job.music.path, job.music.file]);
    for (const insert of job.inserts) inputs.push([insert.path, insert.file]);
    for (const [source, name] of inputs) {
      await storageStep(`Téléchargement de ${name}`, () => bucket.file(source).download({ destination: join(work, name) }));
    }

    log("détourage du fond vert");
    const keyStart = Date.now();
    await run("Détourage", "ffmpeg", [
      "-v", "error", "-y",
      "-i", join(work, "avatar.mp4"),
      "-t", String(job.durationSeconds),
      "-vf", CHROMA_FILTER,
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
      "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an",
      join(work, "avatar.webm"),
    ]);
    log(`détourage terminé en ${Math.round((Date.now() - keyStart) / 1000)} s`);

    const props = {
      format: job.format,
      title: job.title,
      avatar: `jobs/${renderId}/avatar.webm`,
      audio: `jobs/${renderId}/voice.mp3`,
      alignment: `jobs/${renderId}/voice-alignment.json`,
      durationSeconds: job.durationSeconds,
      pose: job.pose,
      background: job.background ? `jobs/${renderId}/${job.background.file}` : null,
      music: job.music ? { src: `jobs/${renderId}/${job.music.file}`, volume: job.music.volume / 100 } : null,
      inserts: job.inserts.map((insert) => ({ src: `jobs/${renderId}/${insert.file}`, start: insert.start, end: insert.end })),
      signature: job.signature && {
        displayName: job.signature.displayName,
        tagline: job.signature.tagline,
        website: job.signature.website,
        handle: job.signature.handle,
        qrUrl: job.signature.qrUrl,
        logo: job.signature.logo ? `jobs/${renderId}/${job.signature.logo.file}` : null,
      },
    };
    const propsFile = join(work, "props.json");
    await writeFile(propsFile, JSON.stringify(props));

    log(`montage Remotion (${job.format}${job.background ? ", avec fond" : ""}${job.music ? ", avec musique" : ""}${job.inserts.length ? `, ${job.inserts.length} image(s)` : ""}${job.signature ? ", avec signature" : ""})`);
    const renderStart = Date.now();
    // Le paquet n'exporte pas son binaire : on le retrouve à partir de son package.json.
    const cli = join(dirname(createRequire(import.meta.url).resolve("@remotion/cli/package.json")), "remotion-cli.js");
    await run("Rendu Remotion", process.execPath, [
      cli, "render", "src/index.ts", "Short", output, `--props=${propsFile}`, "--log=error",
    ]);
    log(`montage terminé en ${Math.round((Date.now() - renderStart) / 1000)} s`);

    log("envoi de la vidéo");
    const outputPath = `${base}/render-${slug}.mp4`;
    await storageStep("Envoi de la vidéo", () =>
      bucket.upload(output, { destination: outputPath, contentType: "video/mp4", metadata: { cacheControl: "private, max-age=0" } }),
    );
    const { size } = await stat(output);
    await storageStep("Écriture du résultat", () =>
      resultFile.save(
        JSON.stringify({
          state: "done",
          outputPath,
          sizeBytes: size,
          renderSeconds: Math.round((Date.now() - started) / 1000),
          finishedAt: new Date().toISOString(),
        }),
        { contentType: "application/json", resumable: false },
      ),
    );
    log(`terminé en ${Math.round((Date.now() - started) / 1000)} s (${(size / 1e6).toFixed(1)} Mo)`);
  } catch (error) {
    const step = error instanceof StepError ? error.step : "Erreur inattendue";
    // Le serveur lit ce fichier pour afficher l'échec ; s'il ne peut pas être écrit, le statut du workflow suffit.
    await resultFile
      .save(JSON.stringify({ state: "failed", step, finishedAt: new Date().toISOString() }), {
        contentType: "application/json",
        resumable: false,
      })
      .catch(() => log("résultat d'échec non enregistré"));
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(output, { force: true });
  }
}

main().catch((error) => {
  // Seuls les messages de StepError sont affichés : les autres pourraient contenir des données privées.
  // RENDER_DEBUG=1 affiche l'erreur complète, pour un test local uniquement (jamais dans le workflow).
  if (process.env.RENDER_DEBUG === "1" && !process.env.CI) console.error(error);
  console.error(`[rendu] échec : ${error instanceof StepError ? error.message : "erreur inattendue"}`);
  process.exitCode = 1;
});
