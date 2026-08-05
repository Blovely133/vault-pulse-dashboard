// Synthesizes the voiceover clips for the attention-dot short via the
// ElevenLabs text-to-speech API, one mp3 per line in lines.mjs.
//
//   ELEVENLABS_API_KEY=... node vo/generate.mjs
//   node vo/generate.mjs --list-voices   # browse available voices
//
// Optional env: ELEVENLABS_VOICE_ID (default: Brian, a deep narration
// voice), ELEVENLABS_MODEL_ID (default: eleven_multilingual_v2).
//
// Uses curl for HTTP so the environment's proxy and CA bundle apply.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { VO_LINES } from "./lines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "nPczCjzI2devNBz1zQrb"; // Brian
const MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set.");
  process.exit(1);
}

function curl(args) {
  return execFileSync("curl", ["-sS", "--fail-with-body", ...args], {
    maxBuffer: 1 << 26,
  });
}

if (process.argv.includes("--list-voices")) {
  const out = curl(["https://api.elevenlabs.io/v1/voices", "-H", `xi-api-key: ${KEY}`]);
  const voices = JSON.parse(out.toString()).voices || [];
  for (const v of voices) {
    console.log(`${v.voice_id}  ${v.name}  ${JSON.stringify(v.labels || {})}`);
  }
  process.exit(0);
}

function mp3Duration(file) {
  const pcm = execFileSync(
    ffmpegPath,
    ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", "44100", "pipe:1"],
    { maxBuffer: 1 << 26 },
  );
  return pcm.byteLength / 4 / 44100;
}

for (const line of VO_LINES) {
  const out = path.join(HERE, line.file);
  const body = JSON.stringify({
    text: line.text,
    model_id: MODEL,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.8,
      style: 0.35,
      use_speaker_boost: true,
    },
  });
  try {
    curl([
      "-X", "POST",
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
      "-H", `xi-api-key: ${KEY}`,
      "-H", "Content-Type: application/json",
      "-d", body,
      "-o", out,
    ]);
  } catch (err) {
    const detail = fs.existsSync(out) ? fs.readFileSync(out, "utf8").slice(0, 500) : "";
    fs.rmSync(out, { force: true });
    console.error(`Failed on ${line.file}: ${err.message}\n${detail}`);
    process.exit(1);
  }
  const head = fs.readFileSync(out).subarray(0, 3).toString("latin1");
  if (!head.startsWith("ID3") && head.charCodeAt(0) !== 0xff) {
    console.error(`${line.file}: response is not an mp3:\n${fs.readFileSync(out, "utf8").slice(0, 500)}`);
    fs.rmSync(out, { force: true });
    process.exit(1);
  }
  const dur = mp3Duration(out);
  const slot = line.endBy - line.t;
  const note = dur > slot ? `  (overruns ${slot.toFixed(2)}s slot — mixer will time-compress)` : "";
  console.log(`${line.file}: ${dur.toFixed(2)}s for slot ${line.t}s→${line.endBy}s${note}`);
}
console.log("Done. Re-run `node render.mjs` to mix the voiceover in.");
