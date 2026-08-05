// Renders attention-dot-v2.mp4 — an 18-second selective-attention demo for
// the shorts channels: a red dot to follow, a countdown challenge, and a
// second dim dot that drifts across the screen the whole time. The reveal
// circles the missed dot and replays its path.
//
// Every on-screen claim is enforced by the timeline constants below: the
// hidden dot exists and is drifting by 0:02, and the trail replay is its
// real path. No invented statistics.
//
//   npm install && node render.mjs
//
// Output is deterministic for a given script version — no clocks, no
// unseeded randomness — so a re-render reproduces the committed file's
// content byte-for-byte apart from encoder version drift.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "attention-dot-v2.mp4");
const WAV = path.join(HERE, "audio-temp.wav");

const W = 1080;
const H = 1920;
const FPS = 30;
const DUR = 18.0;
const FRAMES = Math.round(DUR * FPS); // 540

// ---------------------------------------------------------------------------
// Timeline (seconds). The countdown runs 12 -> 0 between COUNT_START and
// FREEZE; the hidden dot fades in just before 0:02 so "since 0:02" is true.
// ---------------------------------------------------------------------------
const COUNT_START = 1.0;
const FREEZE = 13.0; // countdown hits 0, thump, world stops
const HIDE_IN = 1.7; // hidden dot fade-in begins — clearly present at 0:02
const HIDE_END = 13.0; // hidden dot stops drifting at the freeze
const REVEAL_TWO = 13.35; // "There were two."
const REVEAL_RING = 14.55; // ring + trail + timestamp line
const REVEAL_LESSON = 16.3; // "Attention is a spotlight."
const OUTRO = 17.55; // fades begin; loop-seam by 18.0

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
// Red dot path: authored waypoints, eased curved hops. Two hops pass within
// ~230-280px of the hidden dot (outside foveal focus, obvious on rewatch).
// After FREEZE it holds still, then glides home so frame 539 matches frame 0.
// ---------------------------------------------------------------------------
const WAYPOINTS = [
  [0.0, 540, 1180],
  [0.55, 760, 820],
  [1.2, 320, 640],
  [2.0, 820, 1260],
  [2.9, 250, 1150],
  [3.7, 640, 520],
  [4.6, 880, 900],
  [5.4, 420, 1300],
  [6.2, 575, 830], // near-pass #1 (hidden dot ~(361,656))
  [7.0, 860, 1350],
  [7.8, 240, 980],
  [8.6, 700, 620], // brushes past the hidden path (~190px)
  [9.4, 330, 1240],
  [10.4, 820, 700], // near-pass #2 (hidden dot ~(626,583))
  [11.2, 430, 700],
  [12.1, 740, 1300],
  [13.0, 830, 1120], // freeze position
];
const RETURN_START = 17.0;
const RETURN_END = 17.9;
const HOME = [540, 1180];

function redDotPos(t) {
  if (t >= FREEZE) {
    if (t < RETURN_START) return { x: 830, y: 1120 };
    const s = easeInOutCubic(clamp((t - RETURN_START) / (RETURN_END - RETURN_START), 0, 1));
    return { x: lerp(830, HOME[0], s), y: lerp(1120, HOME[1], s) };
  }
  let i = 0;
  while (i < WAYPOINTS.length - 2 && t >= WAYPOINTS[i + 1][0]) i++;
  const [t0, x0, y0] = WAYPOINTS[i];
  const [t1, x1, y1] = WAYPOINTS[i + 1];
  const s = easeInOutCubic(clamp((t - t0) / (t1 - t0), 0, 1));
  // Curved hop: quadratic bezier, control point pushed perpendicular to the
  // segment, alternating side per hop so the path snakes organically.
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const side = i % 2 === 0 ? 1 : -1;
  const bulge = 0.18 * len * side;
  const cx = (x0 + x1) / 2 + (-dy / len) * bulge;
  const cy = (y0 + y1) / 2 + (dx / len) * bulge;
  const inv = 1 - s;
  let x = inv * inv * x0 + 2 * inv * s * cx + s * s * x1;
  let y = inv * inv * y0 + 2 * inv * s * cy + s * s * y1;
  // Tiny organic wobble while alive
  x += Math.sin(t * 7.3) * 3;
  y += Math.cos(t * 5.1) * 3;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Hidden dot: drifts left-to-right along the upper-middle band on a gentle
// S-curve, clear of every text block. Anchored so it exists by 0:02.
// ---------------------------------------------------------------------------
function hiddenDotPos(t) {
  const u = clamp((t - HIDE_IN) / (HIDE_END - HIDE_IN), 0, 1);
  return {
    x: 86 + 704 * u,
    y: 668 - 96 * u + 26 * Math.sin(1.5 * Math.PI * u),
    u,
  };
}
const hiddenOpacity = (t) => {
  let o = smoothstep((t - HIDE_IN) / 0.85);
  if (t > 17.5) o *= 1 - smoothstep((t - 17.5) / 0.4); // gone by the loop seam
  return o;
};

// Trail polyline for the reveal replay (the hidden dot's real path).
function hiddenTrailPath() {
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const t = HIDE_IN + ((HIDE_END - HIDE_IN) * k) / 40;
    const p = hiddenDotPos(t);
    pts.push([p.x, p.y]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let total = 0;
  for (let k = 1; k < pts.length; k++) {
    d += ` L ${pts[k][0].toFixed(1)} ${pts[k][1].toFixed(1)}`;
    total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  }
  return { d, total, pts };
}
const TRAIL = hiddenTrailPath();

// ---------------------------------------------------------------------------
// Copy beats. One block on screen at a time — the original overlapped two
// blocks around 10.3s; the exclusive [from, to) windows here prevent that.
// ---------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RED = "#ff453a";
const INK = "#f2efeb";
const DIM = "#b3aea8";
const FAINT = "#8f8a85";

// Each line: y baseline, size, default fill, spans [text, fill?]
const BLOCKS = [
  {
    from: 0.0,
    to: 4.5,
    lines: [
      { y: 300, size: 66, spans: [["Keep your eyes on", INK]] },
      { y: 388, size: 66, spans: [["the ", INK], ["red dot.", RED]] },
      { y: 486, size: 44, spans: [["Something else is hiding here.", DIM]] },
      { y: 546, size: 44, spans: [["Spot it before the timer ends.", DIM]] },
    ],
  },
  {
    from: 4.6,
    to: 6.9,
    lines: [
      { y: 1210, size: 60, spans: [["Eyes on the ", INK], ["red dot.", RED]] },
      { y: 1292, size: 48, spans: [["Don't look anywhere else.", DIM]] },
    ],
  },
  {
    from: 7.0,
    to: 8.7,
    lines: [
      { y: 1210, size: 60, spans: [["Most people give up", INK]] },
      { y: 1292, size: 60, spans: [["around second ", INK], ["9.", RED]] },
    ],
  },
  {
    from: 8.8,
    to: 9.95,
    lines: [
      { y: 1210, size: 74, spans: [["Not you.", RED]] },
      { y: 1292, size: 50, spans: [["You're still here.", DIM]] },
    ],
  },
  {
    from: REVEAL_TWO,
    to: 14.45,
    lines: [{ y: 975, size: 86, spans: [["There were ", INK], ["two.", RED]] }],
  },
  {
    from: REVEAL_RING,
    to: 16.1,
    lines: [
      { y: 1155, size: 54, spans: [["The second one has been", INK]] },
      { y: 1230, size: 54, spans: [["drifting since ", INK], ["0:02.", RED]] },
    ],
  },
  {
    from: REVEAL_LESSON,
    to: OUTRO,
    lines: [
      { y: 1155, size: 58, spans: [["Attention is a spotlight.", INK]] },
      { y: 1233, size: 46, spans: [["Watch it again — you can't unsee it.", DIM]] },
    ],
  },
];

function blockSvg(block, t) {
  const IN = 0.2; // pop-in duration
  const OUTD = 0.17;
  if (t < block.from || t > block.to + OUTD) return "";
  let o = 1;
  let pop = 1;
  let dy = 0;
  if (t < block.from + IN) {
    const s = easeOutCubic((t - block.from) / IN);
    o = s;
    pop = 0.955 + 0.045 * s;
    dy = 14 * (1 - s);
  } else if (t > block.to) {
    o = 1 - (t - block.to) / OUTD;
  }
  const ys = block.lines.map((l) => l.y);
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const lines = block.lines
    .map((l) => {
      const spans = l.spans
        .map(([txt, fill]) => `<tspan fill="${fill}">${esc(txt)}</tspan>`)
        .join("");
      // xml:space="preserve" keeps spaces at tspan boundaries, which librsvg
      // otherwise collapses (accent words would fuse with adjacent text).
      return `<text x="540" y="${l.y}" font-family="DejaVu Sans" font-weight="bold" font-size="${l.size}" text-anchor="middle" letter-spacing="0.5" xml:space="preserve">${spans}</text>`;
    })
    .join("");
  return `<g opacity="${o.toFixed(3)}" transform="translate(540 ${(cy + dy).toFixed(1)}) scale(${pop.toFixed(4)}) translate(-540 ${-cy})">${lines}</g>`;
}

// ---------------------------------------------------------------------------
// Countdown UI: slim centered progress bar at the very top plus a small
// numeral under it. The last three seconds hand off to full-screen 3-2-1.
// ---------------------------------------------------------------------------
function countdownSvg(t) {
  if (t < COUNT_START || t > 13.55) return "";
  let o = smoothstep((t - COUNT_START) / 0.25);
  if (t > 13.15) o *= 1 - smoothstep((t - 13.15) / 0.4);
  const frac = clamp((FREEZE - t) / (FREEZE - COUNT_START), 0, 1);
  const wFull = 900;
  const w = Math.max(2, wFull * frac);
  const x = 540 - w / 2;
  const remaining = Math.max(0, Math.ceil(FREEZE - t - 1e-9));
  let parts = `<rect x="90" y="62" width="${wFull}" height="6" rx="3" fill="#26262c"/>`;
  parts += `<rect x="${(540 - (w * 1.1) / 2).toFixed(1)}" y="59" width="${(w * 1.1).toFixed(1)}" height="12" rx="6" fill="${RED}" opacity="0.18"/>`;
  parts += `<rect x="${x.toFixed(1)}" y="62" width="${w.toFixed(1)}" height="6" rx="3" fill="${RED}"/>`;
  parts += `<text x="540" y="150" font-family="DejaVu Sans Mono" font-weight="bold" font-size="44" text-anchor="middle" fill="${FAINT}" letter-spacing="2">${remaining}</text>`;
  return `<g opacity="${o.toFixed(3)}">${parts}</g>`;
}

function numeralSvg(t) {
  if (t < 10 || t >= FREEZE) return "";
  const n = Math.ceil(FREEZE - t - 1e-9); // 3, 2, 1
  const phase = t - (FREEZE - n); // 0..1 inside this numeral's second
  const pop = 1 + 0.13 * (1 - easeOutCubic(clamp(phase / 0.27, 0, 1)));
  let o = easeOutCubic(clamp(phase / 0.14, 0, 1));
  if (phase > 0.72) o *= 1 - smoothstep((phase - 0.72) / 0.26);
  return `<g opacity="${(o * 0.96).toFixed(3)}" transform="translate(540 1080) scale(${pop.toFixed(4)}) translate(-540 -1080)">
    <text x="540" y="1080" font-family="DejaVu Sans" font-weight="bold" font-size="400" text-anchor="middle" fill="#ffffff" opacity="0.10" stroke="#ffffff" stroke-width="14">${n}</text>
    <text x="540" y="1080" font-family="DejaVu Sans" font-weight="bold" font-size="400" text-anchor="middle" fill="#f4f2ef">${n}</text>
  </g>`;
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------
function redDotSvg(t) {
  const p = redDotPos(t);
  // Pulse: gentle idle breathing, plus a beat-synced kick each countdown tick
  let pulse = 1 + 0.045 * Math.sin(2 * Math.PI * 1.1 * t);
  if (t >= COUNT_START && t < FREEZE) {
    const phase = t - Math.floor(t);
    pulse += 0.09 * Math.exp(-phase / 0.1);
  }
  // Liveliness: red while the game runs, gray during the reveal freeze,
  // color returns for the loop seam.
  let alive = 1;
  if (t >= FREEZE) alive = 1 - smoothstep((t - FREEZE) / 0.5);
  if (t >= RETURN_START) alive = Math.max(alive, smoothstep((t - RETURN_START) / 0.6));
  const frozen = 1 - alive;
  // Trail ghosts (only while moving)
  let trail = "";
  if (t < FREEZE || t > RETURN_START) {
    for (let k = 1; k <= 5; k++) {
      const tp = t - k / FPS;
      if (tp < 0) break;
      const q = redDotPos(tp);
      const op = [0.2, 0.13, 0.08, 0.05, 0.03][k - 1] * alive;
      const r = 26 * (1 - k * 0.09);
      trail += `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${RED}" opacity="${op.toFixed(3)}"/>`;
    }
  }
  const r = 26 * pulse;
  const glowR = 105 * pulse;
  return `${trail}
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${glowR.toFixed(1)}" fill="url(#redGlow)" opacity="${(0.85 * alive + 0.15).toFixed(3)}"/>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="#615b58" opacity="${frozen.toFixed(3)}"/>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#redCore)" opacity="${alive.toFixed(3)}"/>
  <circle cx="${(p.x - 8).toFixed(1)}" cy="${(p.y - 10).toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="#ffffff" opacity="${(0.32 * alive).toFixed(3)}"/>`;
}

function hiddenDotSvg(t) {
  const o = hiddenOpacity(t);
  if (o <= 0.001) return "";
  const p = hiddenDotPos(Math.min(t, HIDE_END));
  // Brightness bump + single pulse when circled, another at the loop-bait beat
  let boost = 0;
  if (t >= REVEAL_RING) boost = 0.35 * Math.exp(-(t - REVEAL_RING) / 0.5);
  if (t >= 16.25) boost = Math.max(boost, 0.4 * Math.exp(-(t - 16.25) / 0.35));
  const scale = 1 + boost * 0.5;
  const r = 15 * scale;
  return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(r * 2.9).toFixed(1)}" fill="url(#grayGlow)" opacity="${(o * (0.55 + boost)).toFixed(3)}"/>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="#736b66" opacity="${o.toFixed(3)}"/>
  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="#a89f99" opacity="${(o * boost).toFixed(3)}"/>`;
}

// Reveal: dark veil, ring draw-in around the hidden dot, trail replay.
function revealSvg(t) {
  if (t < FREEZE) return "";
  let veil = 0.3 * smoothstep((t - FREEZE) / 0.4);
  if (t > 16.9) veil *= 1 - smoothstep((t - 16.9) / 0.5);
  let parts = `<rect x="0" y="0" width="${W}" height="${H}" fill="#000000" opacity="${veil.toFixed(3)}"/>`;

  if (t >= REVEAL_RING) {
    const end = hiddenDotPos(HIDE_END);
    let fade = 1;
    if (t > 16.9) fade = 1 - smoothstep((t - 16.9) / 0.4);

    // Ring sweep
    const ringP = easeOutCubic(clamp((t - REVEAL_RING) / 0.4, 0, 1));
    const C = 2 * Math.PI * 46;
    const breathe = 1 + 0.05 * Math.sin(2 * Math.PI * 0.8 * (t - REVEAL_RING));
    parts += `<g opacity="${fade.toFixed(3)}" transform="translate(${end.x.toFixed(1)} ${end.y.toFixed(1)}) scale(${breathe.toFixed(4)}) rotate(-90)">
      <circle cx="0" cy="0" r="46" fill="none" stroke="${RED}" stroke-width="18" opacity="0.15"/>
      <circle cx="0" cy="0" r="46" fill="none" stroke="${RED}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * ringP).toFixed(1)} ${C.toFixed(1)}"/>
    </g>`;

    // Trail replay: draw the hidden dot's real path from its entry point
    const trailP = easeInOutCubic(clamp((t - (REVEAL_RING + 0.1)) / 1.2, 0, 1));
    if (trailP > 0) {
      const shown = TRAIL.total * trailP;
      parts += `<g opacity="${(0.9 * fade).toFixed(3)}">
        <path d="${TRAIL.d}" fill="none" stroke="#ffb9b2" stroke-width="12" stroke-linecap="round" opacity="0.12" stroke-dasharray="${shown.toFixed(1)} ${TRAIL.total.toFixed(1)}"/>
        <path d="${TRAIL.d}" fill="none" stroke="#ffd7d3" stroke-width="4" stroke-linecap="round" opacity="0.75" stroke-dasharray="${shown.toFixed(1)} ${TRAIL.total.toFixed(1)}"/>
      </g>`;
      if (trailP < 1) {
        // Comet head at the draw front
        let acc = 0;
        let hx = TRAIL.pts[0][0];
        let hy = TRAIL.pts[0][1];
        for (let k = 1; k < TRAIL.pts.length; k++) {
          const seg = Math.hypot(
            TRAIL.pts[k][0] - TRAIL.pts[k - 1][0],
            TRAIL.pts[k][1] - TRAIL.pts[k - 1][1],
          );
          if (acc + seg >= shown) {
            const f = (shown - acc) / seg;
            hx = lerp(TRAIL.pts[k - 1][0], TRAIL.pts[k][0], f);
            hy = lerp(TRAIL.pts[k - 1][1], TRAIL.pts[k][1], f);
            break;
          }
          acc += seg;
          hx = TRAIL.pts[k][0];
          hy = TRAIL.pts[k][1];
        }
        parts += `<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="9" fill="#ffe9e7" opacity="${(0.9 * fade).toFixed(3)}"/>`;
      }
      // Entry marker: where it began at 0:02
      const e = TRAIL.pts[0];
      parts += `<circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="7" fill="none" stroke="#ffb9b2" stroke-width="3" opacity="${(0.6 * fade * trailP).toFixed(3)}"/>`;
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Static background: radial gradient with vignette and baked dither/grain so
// the near-black field doesn't band on phone OLEDs (the original banded).
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
      let r = lerp(24, 10, g);
      let gg = lerp(24, 10, g);
      let b = lerp(29, 14, g);
      // Corner vignette
      const ex = Math.min(x, W - x) / (W / 2);
      const ey = Math.min(y, H - y) / (H / 2);
      const vig = 0.78 + 0.22 * smoothstep(Math.min(ex, ey) * 2.2);
      // Baked grain kills gradient banding
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
  <radialGradient id="redGlow"><stop offset="0%" stop-color="#ff453a" stop-opacity="0.38"/><stop offset="45%" stop-color="#ff453a" stop-opacity="0.13"/><stop offset="100%" stop-color="#ff453a" stop-opacity="0"/></radialGradient>
  <radialGradient id="grayGlow"><stop offset="0%" stop-color="#b0a49d" stop-opacity="0.30"/><stop offset="100%" stop-color="#b0a49d" stop-opacity="0"/></radialGradient>
</defs>`;

function frameSvg(frame) {
  const t = frame / FPS;
  let body = SVG_DEFS;
  body += redDotSvg(t);
  body += revealSvg(t); // veil sits above the (dimmed) red dot
  body += hiddenDotSvg(t); // hidden dot above the veil so the reveal pops
  body += countdownSvg(t);
  body += numeralSvg(t);
  for (const block of BLOCKS) body += blockSvg(block, t);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`,
  );
}

// ---------------------------------------------------------------------------
// Audio: 44.1kHz stereo, fully synthesized. Cue times mirror the visuals.
// ---------------------------------------------------------------------------
const SR = 44100;

function buildAudio() {
  const N = Math.round(DUR * SR);
  const L = new Float64Array(N);
  const R = new Float64Array(N);
  const rand = mulberry32(0x50a11d);

  const addPanned = (i, v, pan) => {
    // pan -1..1 equal-power
    const th = ((pan + 1) / 2) * (Math.PI / 2);
    if (i >= 0 && i < N) {
      L[i] += v * Math.cos(th);
      R[i] += v * Math.sin(th);
    }
  };

  const sine = (t0, dur, f0, f1, amp, attack = 0.005, pan = 0) => {
    const n0 = Math.round(t0 * SR);
    const n1 = Math.min(N, n0 + Math.round(dur * SR));
    let phase = 0;
    for (let i = n0; i < n1; i++) {
      const s = (i - n0) / SR;
      const f = lerp(f0, f1, s / dur);
      phase += (2 * Math.PI * f) / SR;
      const env = Math.min(1, s / attack) * Math.exp(-s / (dur * 0.38));
      addPanned(i, Math.sin(phase) * amp * env, pan);
    }
  };

  const tick = (t0, freq, amp, pan = 0) => {
    const n0 = Math.round(t0 * SR);
    const dur = 0.03;
    const n1 = Math.min(N, n0 + Math.round(dur * SR));
    for (let i = n0; i < n1; i++) {
      const s = (i - n0) / SR;
      const env = Math.exp(-s / 0.007);
      const v = (Math.sin(2 * Math.PI * freq * s) + (rand() - 0.5) * 0.4) * amp * env;
      addPanned(i, v, pan);
    }
  };

  const noiseSweep = (t0, dur, ampTo, lpFrom, lpTo, ampFrom = 0) => {
    const n0 = Math.round(t0 * SR);
    const n1 = Math.min(N, n0 + Math.round(dur * SR));
    let y = 0;
    for (let i = n0; i < n1; i++) {
      const s = (i - n0) / (dur * SR);
      const fc = lerp(lpFrom, lpTo, s * s);
      const alpha = 1 - Math.exp((-2 * Math.PI * fc) / SR);
      y += alpha * ((rand() * 2 - 1) - y);
      addPanned(i, y * lerp(ampFrom, ampTo, s), 0);
    }
  };

  const chime = (t0) => {
    [672, 1008, 1344].forEach((f, k) => {
      sine(t0 + k * 0.03, 1.15, f, f, [0.095, 0.055, 0.04][k], 0.004, k === 1 ? -0.3 : 0.25);
    });
  };

  // --- Bed: sub drone + dark noise, swelling gently toward the climax
  {
    let y = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const lfo = 1 + 0.35 * Math.sin(2 * Math.PI * 0.13 * t);
      let level = 1 + 0.45 * smoothstep((t - COUNT_START) / (FREEZE - COUNT_START));
      // Hard duck for the freeze beat, then partial recovery
      if (t >= FREEZE && t < 13.32) level *= 0.15;
      else if (t >= 13.32) level *= 0.5 + 0.15 * Math.sin(2 * Math.PI * 0.1 * t);
      const fadeIn = smoothstep(t / 0.4);
      const fadeOut = t > 17.3 ? 1 - smoothstep((t - 17.3) / 0.65) : 1;
      const sub = Math.sin(2 * Math.PI * 52 * t) * 0.02 * lfo;
      const alpha = 1 - Math.exp((-2 * Math.PI * 280) / SR);
      y += alpha * ((rand() * 2 - 1) - y);
      const v = (sub + y * 0.011) * level * fadeIn * fadeOut;
      L[i] += v;
      R[i] += v * 0.92 + (i > 40 ? 0 : 0); // hair of width
    }
  }

  // --- Cues
  sine(0.03, 0.14, 190, 190, 0.15, 0.002); // opening pop
  tick(0.03, 2400, 0.05);

  for (let s = 1; s <= 12; s++) {
    // Countdown ticks; the last three rise in pitch and weight
    const hot = s >= 10;
    const f = hot ? [988, 1109, 1245][s - 10] : 880;
    const amp = hot ? 0.085 + (s - 10) * 0.02 : 0.05;
    tick(s, f, amp);
    if (hot) sine(s, 0.22, f / 4, f / 4, 0.035, 0.003);
  }

  noiseSweep(10.0, 3.0, 0.08, 350, 5200); // riser into the freeze
  sine(10.0, 3.0, 108, 216, 0.026, 0.01);

  // Freeze thump + short void
  sine(FREEZE, 0.42, 54, 30, 0.3, 0.002);
  noiseSweep(FREEZE, 0.03, 0.18, 3000, 800);

  sine(REVEAL_TWO, 0.7, 82, 82, 0.045, 0.01); // low swell under "There were two."

  chime(REVEAL_RING);

  // Shimmer following the trail draw, panned left -> right
  for (let k = 0; k < 16; k++) {
    const t0 = 14.65 + (1.1 * k) / 16 + rand() * 0.04;
    const f = 2200 + rand() * 3300;
    const pan = -0.8 + (1.6 * k) / 15;
    sine(t0, 0.06 + rand() * 0.06, f, f * 0.99, 0.018 + rand() * 0.017, 0.003, pan);
  }

  sine(16.2, 0.13, 70, 70, 0.07, 0.003); // loop-bait double pulse
  sine(16.45, 0.13, 70, 70, 0.055, 0.003);
  tick(17.6, 880, 0.035); // quiet pre-roll cue at the seam

  // --- Normalize to -3 dBFS and write 16-bit WAV
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 0 ? 0.71 / peak : 1;
  const pcm = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    pcm.writeInt16LE(Math.round(clamp(L[i] * gain, -1, 1) * 32767), i * 4);
    pcm.writeInt16LE(Math.round(clamp(R[i] * gain, -1, 1) * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
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
  buildAudio();

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
    "-b:a", "160k",
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
