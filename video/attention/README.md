# Attention dot (v2)

`attention-dot-v2.mp4` — an 18-second, 1080x1920@30 selective-attention demo
for the shorts channels, rendered entirely by `render.mjs` (deterministic:
no clocks, no unseeded randomness).

A red dot darts around the screen under a 12-second countdown while the copy
pins the viewer's eyes to it. A second, dim dot fades in just before 0:02
and simply sits in the upper-left dead zone. Viewers tracking the red dot
filter it out completely. The reveal freezes the frame, circles the missed
dot, and names the mechanism ("Attention is a spotlight.") before looping
back to the start.

## Why the hidden dot is static, dim, and far from the action

The trick lives or dies on three perception details:

- **No motion.** Peripheral vision is acutely motion-sensitive; a drifting
  dot gets caught. A stationary dim object while the fovea tracks a moving
  target is what selective attention suppresses.
- **Low contrast, small size.** Core luma ~76 against a ~33 background —
  plainly visible the moment you look at it (fair, and undeniable on
  rewatch), invisible while you don't.
- **Distance from the red dot's path.** Every waypoint keeps roughly 400px
  clear of the hidden dot so the viewer's gaze never sweeps near it. The
  copy also never hints that something is hidden — "spot it" phrasing makes
  people scan the screen and find it; "watch the red dot" keeps them locked.

## Craft details

- Hook copy is fully visible in frame 0 (poster frame and loop restart).
- Copy beats hold exclusive time windows with fades that complete before
  the window closes, so two blocks can never render together.
- Countdown: slim top progress bar + numeral, handing off to beat-synced
  full-screen 3-2-1; freeze + thump + a beat of near-silence, then the
  reveal: "There were two." → ring draw-in → "there since 0:02" → lesson
  and rewatch bait.
- Honest claims only: the hidden dot is measurably present in the encoded
  file by 0:02 (probed luma ~49 at t=2.0 rising to ~76) and never moves.
  No invented statistics.
- Sound: synthesized sub-drone bed, per-second ticks (pitch-rising for the
  last three), riser, −3 dBFS freeze thump, reveal chime, loop-bait pulse;
  audio fades to silence at the seam and the final frame matches frame 0.
- Dithered/grained background to prevent banding; bt709 tags; faststart.

## Voiceover (ElevenLabs)

`vo/lines.mjs` holds the narration lines and their time slots. With
`ELEVENLABS_API_KEY` set:

```bash
cd video/attention
node vo/generate.mjs            # writes vo/*.mp3 (voice/model overridable via env)
node render.mjs                 # automatically mixes the clips in
node vo/generate.mjs --list-voices   # browse voice options
```

The mixer normalizes each clip, time-compresses any line that would overrun
its slot (atempo, capped 1.3x), ducks the bed under speech, and warns if a
line still doesn't fit. Without the clips the render falls back to the
synth-only mix.

## Render

```bash
cd video/attention
npm install
node render.mjs               # writes attention-dot-v2.mp4 (~70 s on 4 cores)
node render.mjs --audio-only  # writes audio-temp.wav for quick mix checks
```

## Publish

Dispatch the **YouTube upload tool** workflow against a branch containing
this file with `file` = `video/attention/attention-dot-v2.mp4`, or hand the
file to the TikTok/Instagram publishers as usual.
