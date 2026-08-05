# Attention dot (v2)

`attention-dot-v2.mp4` — an 18-second, 1080x1920@30 selective-attention demo
for the shorts channels, rendered entirely by `render.mjs` (deterministic:
no clocks, no unseeded randomness).

A red dot darts around the screen under a 12-second countdown challenge.
Meanwhile a second, dim dot fades in just before 0:02 and drifts slowly all
the way across the screen. Almost nobody tracking the red dot notices it.
The reveal circles the missed dot, replays its real path, and names the
mechanism ("Attention is a spotlight.") before looping back to the start.

## What v2 changes over the original clip

- **Hook at frame 0.** The original spent its first 1.6 s on a bare dot with
  no text. v2 opens with the challenge copy and the dot already in motion.
- **Honest copy.** The invented "97.3% of people miss" statistic is gone.
  Every claim on screen is enforced by the render timeline: the hidden dot is
  measurably present in the encoded file at 0:02 (probed luma 57 vs a
  30-luma background) and its drift starts the moment it appears, so
  "drifting since 0:02" is literally true. The trail replay is its real path.
- **A moving hidden dot.** The original's second dot appeared once and sat
  still (tucked under the headline text). Drifting the dot the whole way
  across the screen is a stronger demonstration (change blindness), a fairer
  game (it is never occluded by text), and a better payoff.
- **Near-miss passes.** The red dot's authored path brushes within
  ~190–280 px of the hidden dot three times — outside foveal focus on a
  phone, but obvious on rewatch.
- **No text collisions.** The original briefly rendered two copy blocks on
  top of each other around 10.3 s. Copy beats here hold exclusive windows.
- **Countdown that escalates.** Slim top progress bar + small numeral,
  handing off to full-screen 3-2-1 numerals beat-synced with rising ticks,
  instead of a tiny corner label (which TikTok/Shorts UI overlays anyway).
- **Sound design.** The original's audio track was digital silence. v2
  synthesizes a sub-drone bed, per-second ticks (pitch-rising for the last
  three), a noise riser, a freeze thump with a ducked void beat, a reveal
  chime, trail shimmer panned along the draw direction, and a loop-bait
  pulse — normalized to −3 dBFS.
- **Reveal with proof.** Freeze + thump, "There were two.", ring draw-in on
  the missed dot, then its full path draws in from the 0:02 entry point.
- **Loop engineering.** The last frame matches the first (dot home, texts
  out, audio faded), so replays feel seamless — and the closing line sends
  viewers into the rewatch: "Watch it again — you can't unsee it."
- **Polish.** Dithered/grained background (the original banded visibly),
  radial glows, motion trail, pop-in typography, safe margins for platform
  UI, bt709 tagging, faststart moov.

## Render

```bash
cd video/attention
npm install
node render.mjs   # writes attention-dot-v2.mp4 (~70 s on 4 cores)
```

## Publish

Dispatch the **YouTube upload tool** workflow against a branch containing
this file with `file` = `video/attention/attention-dot-v2.mp4`, or hand the
file to the TikTok/Instagram publishers as usual.
