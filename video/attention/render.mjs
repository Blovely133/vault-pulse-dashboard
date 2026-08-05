// Renders attention-dot.mp4 — a faithful rebuild of the original
// "watch the red dot" selective-attention short, with three deliberate
// changes and nothing else:
//
//   1. The headline and countdown are on screen from frame 0 (the original
//      spent its first 1.6s blank, and frame 0 is the poster frame).
//   2. The hidden second dot sits ABOVE the headline in the top-left dead
//      zone instead of inside the text band, so it is out of the reading
//      line while the headline is being read and is never occluded by
//      glyphs. It stays clear of the very top edge where platform UI
//      (e.g. Instagram's "Reels" label) is drawn.
//   3. Copy beats hold exclusive time windows — the original briefly
//      rendered two lines on top of each other around 10.3s.
//
// Everything else mirrors the original: same copy, same beat order and
// pacing, same reveal, a red dot that keeps roaming through the reveal,
// and a silent audio track.
//
//   npm install && node render.mjs
//
// Output is deterministic: no clocks, no unseeded randomness.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "attention-dot.mp4");
const WAV = path.join(HERE, "audio-temp.wav");

const W = 1080;
const H = 1920;
const FPS = 30;
const DUR = 17.6;
const FRAMES = Math.round(DUR * FPS); // 528

// ---------------------------------------------------------------------------
// Timeline (seconds). The countdown runs 14 -> 0 from frame 0; the hidden
// dot fades in so it is measurably present at 0:02, keeping the reveal's
// "since 0:02" line true.
// ---------------------------------------------------------------------------
const COUNT_END = 14.0;
const HIDE_IN = 1.85;
const REVEAL_TWO = 14.25; // "There were two."
const REVEAL_RING = 14.9; // circle draws around the second dot
const REVEAL_LINE = 15.3; // "The second one has been there since 0:02."

// Hidden dot: top-left, above the headline block (headline cap-tops start
// ~y=230), below the platform-UI strip at the very top.
const HIDDEN_X = 126;
const HIDDEN_Y = 190;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, s) => a + (b - a) * s;
const smoothstep = (s) => {
  const x = clamp(s, 0, 1);
  return x * x * (3 - 2 * x);
};
const easeInOutCubic = (s) =>
  s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;
const easeOutCubic = (s) => 1 - Math.pow(1 - s, 3);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Red dot path: like the original, it hops around the whole frame for the
// entire video, reveal included. Waypoints stay well away from the hidden
// dot's corner so the viewer's gaze never sweeps near it.
// ---------------------------------------------------------------------------
const WAYPOINTS = [
  [0.0, 540, 1180],
  [0.6, 780, 900],
  [1.25, 340, 760],
  [1.9, 860, 1300],
  [2.55, 300, 1120],
  [3.2, 660, 570],
  [3.85, 900, 980],
  [4.5, 430, 1330],
  [5.15, 700, 700],
  [5.8, 880, 1400],
  [6.45, 320, 1000],
  [7.1, 620, 540],
  [7.75, 350, 1260],
  [8.4, 840, 800],
  [9.05, 480, 930],
  [9.7, 760, 1330],
  [10.35, 420, 620],
  [11.0, 850, 1050],
  [11.7, 520, 1300],
  [12.4, 700, 760],
  [13.1, 330, 1080],
  [13.8, 820, 1280],
  [14.5, 560, 980],
  [15.2, 300, 780],
  [15.9, 740, 1180],
  [16.6, 460, 1290],
  [17.6, 600, 1000],
];

function redDotPos(t) {
  let i = 0;
  while (i < WAYPOINTS.length - 2 && t >= WAYPOINTS[i + 1][0]) i++;
  const [t0, x0, y0] = WAYPOINTS[i];
  const [t1, x1, y1] = WAYPOINTS[i + 1];
  const s = easeInOutCubic(clamp((t - t0) / (t1 - t0), 0, 1));
  // Curved hop: quadratic bezier with the control point pushed perpendicular
  // to the segment, alternating side, so the path arcs organically.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const side = i % 2 === 0 ? 1 : -1;
  const bulge = 0.16 * len * side;
  const cx = (x0 + x1) / 2 + (-dy / len) * bulge;
  const cy = (y0 + y1) / 2 + (dx / len) * bulge;
  const inv = 1 - s;
  return {
    x: inv * inv * x0 + 2 * inv * s * cx + s * s * x1,
    y: inv * inv * y0 + 2 * inv * s * cy + s * s * y1,
  };
}

const hiddenOpacity = (t) => {
  // Quick rise to a faint level so the dot is genuinely present at 0:02,
  // then a slow creep to full while attention settles on the red dot.
  const arrive = 0.4 * smoothstep((t - HIDE_IN) / 0.25);
  const creep = 0.6 * smoothstep((t - 2.1) / 1.5);
  return Math.min(1, arrive + creep);
};

// ---------------------------------------------------------------------------
// Copy — the original's lines verbatim. Windows are exclusive: a block's
// fade completes by `to`, and no two windows share time.
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RED = "#ff453a";
const INK = "#f0ede8";
const FAINT = "#8f8f8f";

const BLOCKS = [
  {
    from: 0.0,
    to: 5.35,
    lines: [
      { y: 285, size: 55, spans: [["In 14 seconds this dot does", INK]] },
      { y: 355, size: 55, spans: [["something ", INK], ["97.3%", RED], [" of people", INK]] },
      { y: 425, size: 55, spans: [["miss.", INK]] },
    ],
  },
  {
    from: 5.45,
    to: 7.9,
    lines: [{ y: 870, size: 52, spans: [["You can already predict it.", INK]] }],
  },
  {
    from: 8.05,
    to: 10.05,
    lines: [
      { y: 825, size: 52, spans: [["Most people quit", INK]] },
      { y: 895, size: 52, spans: [["around second 9.", INK]] },
    ],
  },
  {
    from: 10.2,
    to: 10.95,
    lines: [{ y: 870, size: 56, spans: [["Not you.", INK]] }],
  },
  {
    from: REVEAL_TWO,
    to: DUR,
    lines: [{ y: 850, size: 64, spans: [["There were ", INK], ["two.", RED]] }],
  },
  {
    from: REVEAL_LINE,
    to: DUR,
    lines: [
      { y: 272, size: 42, spans: [["The second one has been", INK]] },
      { y: 330, size: 42, spans: [["there since 0:02.", INK]] },
    ],
  },
];

function blockSvg(block, t) {
  const OUTD = 0.12;
  if (t < block.from || t > block.to) return "";
  let o = 1;
  if (block.to < DUR && t > block.to - OUTD) o = (block.to - t) / OUTD;
  const lines = block.lines
    .map((l) => {
      const spans = l.spans
        .map(([txt, fill]) => `<tspan fill="${fill}">${esc(txt)}</tspan>`)
        .join("");
      // xml:space="preserve" keeps spaces at tspan boundaries, which librsvg
      // otherwise collapses (accent words would fuse with adjacent text).
      return `<text x="540" y="${l.y}" font-family="DejaVu Sans" font-weight="bold" font-size="${l.size}" text-anchor="middle" xml:space="preserve">${spans}</text>`;
    })
    .join("");
  return `<g opacity="${o.toFixed(3)}">${lines}</g>`;
}

// ---------------------------------------------------------------------------
// Countdown: the original's small "14s" label in the top-right, counting to
// "0s", plus its full-screen 3-2-1 numerals over the last three seconds.
// ---------------------------------------------------------------------------
function countdownSvg(t) {
  if (t > REVEAL_TWO) return "";
  const remaining = Math.max(0, Math.ceil(COUNT_END - t - 1e-9));
  return `<text x="1052" y="76" font-family="DejaVu Sans" font-weight="bold" font-size="30" text-anchor="end" fill="${FAINT}">${remaining}s</text>`;
}

function numeralSvg(t) {
  if (t < COUNT_END - 3 || t >= COUNT_END) return "";
  const n = Math.ceil(COUNT_END - t - 1e-9); // 3, 2, 1
  const phase = t - (COUNT_END - n);
  const pop = 1 + 0.1 * (1 - easeOutCubic(clamp(phase / 0.25, 0, 1)));
  let o = easeOutCubic(clamp(phase / 0.12, 0, 1));
  if (phase > 0.74) o *= 1 - smoothstep((phase - 0.74) / 0.24);
  return `<g opacity="${(o * 0.97).toFixed(3)}" transform="translate(540 1070) scale(${pop.toFixed(4)}) translate(-540 -1070)">
    <text x="540" y="1070" font-family="DejaVu Sans" font-weight="bold" font-size="430" text-anchor="middle" fill="#f4f2ef">${n}</text>
  </g>`;
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------
function redDotSvg(t) {
  const p = redDotPos(t);
  const pulse = 1 + 0.04 * Math.sin(2 * Math.PI * 1.1 * t);
  const r = 26 * pulse;
  return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(78 * pulse).toFixed(1)}" fill="url(#redGlow)"/>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#redCore)"/>
  <circle cx="${(p.x - 8).toFixed(1)}" cy="${(p.y - 10).toFixed(1)}" r="${(r * 0.26).toFixed(1)}" fill="#ffffff" opacity="0.30"/>`;
}

function hiddenDotSvg(t) {
  const o = hiddenOpacity(t);
  if (o <= 0.001) return "";
  return `<circle cx="${HIDDEN_X}" cy="${HIDDEN_Y}" r="26" fill="url(#grayGlow)" opacity="${(o * 0.3).toFixed(3)}"/>
  <circle cx="${HIDDEN_X}" cy="${HIDDEN_Y}" r="13" fill="#3a3734" opacity="${o.toFixed(3)}"/>`;
}

function ringSvg(t) {
  if (t < REVEAL_RING) return "";
  const p = easeOutCubic(clamp((t - REVEAL_RING) / 0.5, 0, 1));
  const C = 2 * Math.PI * 52;
  return `<g transform="translate(${HIDDEN_X} ${HIDDEN_Y}) rotate(-90)">
    <circle cx="0" cy="0" r="52" fill="none" stroke="${RED}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}"/>
  </g>`;
}

// ---------------------------------------------------------------------------
// Static background: dark radial gradient with vignette and baked grain so
// the near-black field doesn't band.
// ---------------------------------------------------------------------------
function buildBackground() {
  const rand = mulberry32(0xa77e17);
  const buf = Buffer.alloc(W * H * 3);
  const cx = 540;
  const cy = 820;
  const maxD = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const g = smoothstep(d);
      const r = lerp(24, 10, g);
      const gg = lerp(24, 10, g);
      const b = lerp(29, 14, g);
      const ex = Math.min(x, W - x) / (W / 2);
      const ey = Math.min(y, H - y) / (H / 2);
      const vig = 0.78 + 0.22 * smoothstep(Math.min(ex, ey) * 2.2);
      const n = (rand() - 0.5) * 5;
      const i = (y * W + x) * 3;
      buf[i] = clamp(Math.round(r * vig + n), 0, 255);
      buf[i + 1] = clamp(Math.round(gg * vig + n), 0, 255);
      buf[i + 2] = clamp(Math.round(b * vig + n), 0, 255);
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Frame assembly
// ---------------------------------------------------------------------------
const SVG_DEFS = `<defs>
  <radialGradient id="redCore"><stop offset="0%" stop-color="#ff7d72"/><stop offset="55%" stop-color="#ff453a"/><stop offset="100%" stop-color="#e01e12"/></radialGradient>
  <radialGradient id="redGlow"><stop offset="0%" stop-color="#ff453a" stop-opacity="0.32"/><stop offset="45%" stop-color="#ff453a" stop-opacity="0.11"/><stop offset="100%" stop-color="#ff453a" stop-opacity="0"/></radialGradient>
  <radialGradient id="grayGlow"><stop offset="0%" stop-color="#8a817b" stop-opacity="0.25"/><stop offset="100%" stop-color="#8a817b" stop-opacity="0"/></radialGradient>
</defs>`;

function frameSvg(frame) {
  const t = frame / FPS;
  let body = SVG_DEFS;
  body += redDotSvg(t);
  body += hiddenDotSvg(t);
  body += ringSvg(t);
  body += countdownSvg(t);
  body += numeralSvg(t);
  for (const block of BLOCKS) body += blockSvg(block, t);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`,
  );
}

// ---------------------------------------------------------------------------
// Audio: a silent mono track, matching the original file's stream layout.
// ---------------------------------------------------------------------------
const SR = 44100;

function buildSilentAudio() {
  const N = Math.round(DUR * SR);
  const pcm = Buffer.alloc(N * 2); // 16-bit mono zeros
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(WAV, Buffer.concat([header, pcm]));
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------
async function main() {
  console.log("Building audio…");
  buildSilentAudio();

  console.log("Building background…");
  const bg = await buildBackground();

  console.log(`Encoding ${FRAMES} frames…`);
  const ff = spawn(ffmpegPath, [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(FPS),
    "-c:v", "png",
    "-i", "pipe:0",
    "-i", WAV,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-c:a", "aac",
    "-b:a", "96k",
    "-ac", "1",
    "-movflags", "+faststart",
    "-shortest",
    OUT,
  ]);
  ff.stderr.on("data", () => {});
  const done = new Promise((resolve, reject) => {
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    );
  });

  const t0 = process.hrtime.bigint();
  for (let frame = 0; frame < FRAMES; frame++) {
    const png = await sharp(bg)
      .composite([{ input: frameSvg(frame) }])
      .png({ compressionLevel: 1 })
      .toBuffer();
    if (!ff.stdin.write(png)) {
      await new Promise((r) => ff.stdin.once("drain", r));
    }
    if (frame % 90 === 0) {
      const dt = Number(process.hrtime.bigint() - t0) / 1e9;
      console.log(`  frame ${frame}/${FRAMES} (${dt.toFixed(0)}s elapsed)`);
    }
  }
  ff.stdin.end();
  await done;
  fs.unlinkSync(WAV);
  const size = fs.statSync(OUT).size;
  console.log(`Done: ${OUT} (${(size / 1e6).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
