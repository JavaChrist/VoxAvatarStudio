// Spike: does Kling AI Avatar v2 Pro (fal.ai) lip-sync Chris, a cartoon character, well?
//
// Usage:
//   npm run spike:avatar                -> dry run: checks inputs, prints the estimated cost, spends nothing
//   npm run spike:avatar -- --yes       -> real run (ElevenLabs voice + fal.ai video, paid)
//   Options: --image=spike/input/chris.png  --text="..."
//
// Needs .env.local (never committed): FAL_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID.
// Outputs go to spike/out/ (ignored by git): voice.mp3, alignment.json, chris-avatar.mp4, result.json.
//
// Official docs checked on 2026-11-22:
//   https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api  (inputs image_url, audio_url, prompt; output video.url, duration)
//   https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fal } from "@fal-ai/client";

const ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/pro";
const USD_PER_SECOND = 0.115; // fal.ai model page, 2026-11-22
const USD_PER_1K_CHARS = 0.08; // ElevenLabs API pricing (v2/v3), 2026-11-22
const CHARS_PER_SECOND = 15; // rough French speaking rate, for the estimate only

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

const imagePath = path.resolve(args.image ?? "spike/input/chris.png");
const text =
  args.text ??
  "Salut, moi c'est Chris ! En dix secondes, je vous montre comment gagner une heure par jour grâce à l'automatisation.";
const outDir = path.resolve("spike/out");

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// --- Checks (no network, no cost) ---
const missing = ["FAL_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"].filter((k) => !process.env[k]);
if (missing.length) fail(`Missing in .env.local: ${missing.join(", ")}`);
if (!existsSync(imagePath)) fail(`Image not found: ${imagePath}\nPut a single image of Chris there (vertical, full resolution).`);

const estSeconds = Math.max(3, Math.round(text.length / CHARS_PER_SECOND));
const estVoice = (text.length / 1000) * USD_PER_1K_CHARS;
const estVideo = estSeconds * USD_PER_SECOND;
console.log(`Image : ${imagePath}`);
console.log(`Text  : ${text.length} characters, about ${estSeconds} s of speech`);
console.log(`Estimate: voice ≈ $${estVoice.toFixed(3)} + video ≈ $${estVideo.toFixed(2)} = $${(estVoice + estVideo).toFixed(2)}`);

if (!args.yes) {
  console.log("\nDry run: nothing was spent. Run again with -- --yes to generate.");
  process.exit(0);
}

await mkdir(outDir, { recursive: true });

// --- 1. ElevenLabs voice with timestamps ---
console.log("\n1/3 ElevenLabs voice...");
const ttsRes = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  },
);
if (!ttsRes.ok) fail(`ElevenLabs ${ttsRes.status}: ${await ttsRes.text()}`);
const tts = await ttsRes.json();
const audio = Buffer.from(tts.audio_base64, "base64");
await writeFile(path.join(outDir, "voice.mp3"), audio);
await writeFile(path.join(outDir, "alignment.json"), JSON.stringify(tts.alignment, null, 2));
const ends = tts.alignment?.character_end_times_seconds ?? [];
const voiceSeconds = ends.length ? ends[ends.length - 1] : null;
console.log(`   voice.mp3 saved (${voiceSeconds?.toFixed(2) ?? "?"} s)`);

// --- 2. Upload inputs to fal storage ---
console.log("2/3 Upload to fal.ai...");
fal.config({ credentials: process.env.FAL_KEY });
const ext = path.extname(imagePath).slice(1).toLowerCase();
const imageType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
const imageUrl = await fal.storage.upload(new Blob([await readFile(imagePath)], { type: imageType }));
const audioUrl = await fal.storage.upload(new Blob([audio], { type: "audio/mpeg" }));

// --- 3. Kling AI Avatar v2 Pro ---
console.log("3/3 Kling AI Avatar v2 Pro (this can take several minutes)...");
const started = Date.now();
const result = await fal.subscribe(ENDPOINT, {
  input: { image_url: imageUrl, audio_url: audioUrl },
  logs: true,
  onQueueUpdate: (u) => {
    if (u.status === "IN_QUEUE") process.stdout.write(`   in queue (position ${u.queue_position ?? "?"})\r`);
    if (u.status === "IN_PROGRESS") process.stdout.write("   generating...                \r");
  },
});
const minutes = ((Date.now() - started) / 60000).toFixed(1);
const { video, duration } = result.data;

const videoRes = await fetch(video.url);
if (!videoRes.ok) fail(`Video download ${videoRes.status}`);
await writeFile(path.join(outDir, "chris-avatar.mp4"), Buffer.from(await videoRes.arrayBuffer()));

const cost = duration * USD_PER_SECOND + (text.length / 1000) * USD_PER_1K_CHARS;
const summary = { requestId: result.requestId, endpoint: ENDPOINT, voiceSeconds, videoSeconds: duration, generationMinutes: Number(minutes), estimatedCostUSD: Number(cost.toFixed(3)) };
await writeFile(path.join(outDir, "result.json"), JSON.stringify(summary, null, 2));

console.log(`\n✔ spike/out/chris-avatar.mp4 — ${duration.toFixed(1)} s of video, generated in ${minutes} min, ≈ $${cost.toFixed(2)}`);
