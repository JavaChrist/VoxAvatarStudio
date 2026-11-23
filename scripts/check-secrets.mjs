// Vérifie qu'aucun secret n'est versionné ni envoyé au navigateur.
// 1. Fichiers suivis par git : aucun motif de clé connue, .env.example sans valeur secrète.
// 2. Code source : aucune variable secrète exposée avec le préfixe NEXT_PUBLIC_.
// 3. Build client (.next/static, s'il existe) : aucune valeur secrète, aucun motif de clé.
// Les valeurs lues dans .env.local restent en mémoire : le script n'affiche jamais un secret.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SECRET_KEYS = [
  "FAL_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ANTHROPIC_API_KEY",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "ALLOWED_EMAILS",
  "GITHUB_RENDER_TOKEN",
];

const PATTERNS = [
  { name: "clé privée PEM", regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: "clé Anthropic", regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "clé ElevenLabs", regex: /\bsk_[a-f0-9]{40,}\b/ },
  { name: "clé fal.ai", regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}\b/ },
  { name: "jeton GitHub", regex: /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/ },
  { name: "compte de service Firebase", regex: /"type"\s*:\s*"service_account"/ },
];

const TEXT_EXTENSIONS = /\.(m?[jt]sx?|json|md|ya?ml|css|html|txt|py|env|example|toml|svg)$|^\.env/i;
const problems = [];

// Valeurs secrètes locales, pour les chercher dans le build. Jamais affichées.
const secretValues = [];
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
for (const key of SECRET_KEYS) {
  const value = process.env[key]?.trim();
  if (value && value.length >= 8) secretValues.push({ key, value: value.replace(/\\n/g, "\n") });
}

const scan = (label, content) => {
  for (const { name, regex } of PATTERNS) {
    if (regex.test(content)) problems.push(`${label} : ${name}`);
  }
  for (const { key, value } of secretValues) {
    if (content.includes(value)) problems.push(`${label} : valeur de ${key}`);
  }
};

// 1. Fichiers versionnés (ou prêts à l'être).
const tracked = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
for (const file of tracked) {
  if (!TEXT_EXTENSIONS.test(file) || !existsSync(file) || statSync(file).size > 2_000_000) continue;
  if (file === "scripts/check-secrets.mjs") continue;
  if (/^\.env(?!\.example$)/.test(file)) problems.push(`${file} : fichier d'environnement versionné`);
  scan(file, readFileSync(file, "utf8"));
}

if (existsSync(".env.example")) {
  for (const line of readFileSync(".env.example", "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && SECRET_KEYS.includes(match[1]) && match[2].trim()) {
      problems.push(`.env.example : ${match[1]} doit rester vide`);
    }
  }
}

// 2. Aucune variable secrète avec le préfixe public.
for (const file of tracked.filter((f) => /^src\/.*\.(ts|tsx)$/.test(f))) {
  const content = readFileSync(file, "utf8");
  for (const key of SECRET_KEYS) {
    if (content.includes(`NEXT_PUBLIC_${key}`)) problems.push(`${file} : NEXT_PUBLIC_${key} exposerait un secret`);
  }
}

// 3. Build envoyé au navigateur.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
const clientDir = join(".next", "static");
let clientFiles = 0;
if (existsSync(clientDir)) {
  for (const file of walk(clientDir).filter((f) => /\.(js|css|html|json)$/.test(f))) {
    clientFiles += 1;
    const content = readFileSync(file, "utf8");
    scan(file, content);
    if (/firebase-admin|private_key|FIREBASE_ADMIN_/.test(content)) problems.push(`${file} : code Firebase Admin dans le build client`);
  }
}

if (problems.length) {
  console.error(`check:secrets : ${problems.length} problème(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `check:secrets : OK (${tracked.length} fichiers suivis, ${clientFiles} fichiers du build client, ${secretValues.length} valeurs locales comparées)`,
);
