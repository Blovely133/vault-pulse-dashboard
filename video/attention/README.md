# Attention dot

`attention-dot.mp4` — a faithful rebuild of the original "watch the red
dot" selective-attention short (1080x1920@30, 17.6s, silent mono track like
the source), rendered deterministically by `render.mjs`.

Three deliberate changes from the original, nothing else:

1. **Headline and countdown are on screen from frame 0.** The original
   spent its first 1.6 seconds blank; frame 0 is the poster frame, so the
   hook is now readable before the first frame is even played.
2. **The hidden second dot moved above the text, top-left** (126, 190).
   With the headline present from the start, eyes sit in the text band
   during the dot's 0:02 fade-in — the original's spot (148, 276) was
   inside the reading line and got occluded by glyphs. Above the block it
   is out of the reading path, never covered, and still clear of the very
   top edge where platform UI (e.g. Instagram's "Reels" label) draws.
3. **No text overlaps.** The original briefly rendered "Not you." on top
   of "Most people quit around second 9." near 10.3s; copy windows are
   exclusive here.

Same as the original: all copy verbatim, beat order and pacing, the small
top-right "14s" countdown, full-screen 3-2-1 numerals over the last three
seconds, the freeze-free reveal ("There were two." + ring + "The second one
has been there since 0:02.") with the red dot still roaming, and a silent
audio stream. The hidden dot is measurably present in the encoded file at
0:02 (probed luma ~37 at t=2.0 against a ~27 background, settling ~64), so
the reveal's timestamp is true.

## Render

```bash
cd video/attention
npm install
node render.mjs   # writes attention-dot.mp4 (~60s on 4 cores)
```

## Publish

Dispatch the **YouTube upload tool** workflow against a branch containing
this file with `file` = `video/attention/attention-dot.mp4`, or hand the
file to the TikTok/Instagram publishers as usual.
