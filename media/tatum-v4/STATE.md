# Tatum/Ella Mai Story Video — Session State (2026-08-24)

**Session:** overnight session from the Saved Games PC (Claude, cwd ~/.claude), Aug 24 ~05:00–11:00 UTC.
**Deliverable: `media/tatum-story-v4_master_1080x1920.mp4` on this branch — the FINAL master, ready to upload.**
Local copies: Desktop `sports\tatum story v4 FINAL (hook + receipts).mp4` (Saved Games PC) and the review
player at `localhost:8324` (scratchpad server, dies with the session).

---

## What v4 is

`tatum-story-v1` (the 88.6s cut built 08-22, uploaded as draft `AsQmhIepBnI`) + three owner-called edits:

1. **NEW 10s COLD OPEN (owner's hook, take C1)** — voiced in the story lane's exact recipe
   (Fixed Games Narrator `o7mizjPovZD29h3qPclF`, `eleven_v3`, stability 0.5):
   > "Do you know the details of Jayson Tatum and Ella Mai's very private relationship?
   > Most fans don't. But Ella is the mother of Jayson's child — and a Grammy award winning musician."
   Visuals: Paris podium photo card → Ella red-carpet card → **split-frame two-shot card with the real
   👀 badge** (Tatum podium | Ella carpet). House-style caption chunks timed to the phrase gaps.
   The hook is deliberately **cold (no music bed)** — Pocket In Oak enters when the main cut starts.
   The split-frame card (~6–10s) is the **thumbnail frame**: pick it in Studio (frame-pick rule).

2. **THE EYES-EMOJI RECEIPT (v2/v3 work, times shifted +10s)** — the REAL Feb 2019 screenshot
   (BSO original: `jaytatum0` "All Star year ✌🏽" / `ellamai` 👀 · 897 likes · "View previous replies (136)"),
   cropped to exclude bystander handles, FEB 2019 chip, marker-red circle popping onto the 👀 at 14.05s
   exactly on the word "emoji". Callback card (comment row only) rides the dead-stop from 96.9s.

3. **THE SNEAKER FIX (owner's catch)** — v1's footage at "it just appears on his sneakers" shows an
   **ATL All-Star Weekend '21 Jordan 6** (wrong shoe, 3 years pre-Dylan). v4 covers that beat (60.9–64.2s)
   with a receipt card of the REAL reveal: the Oct 4, 2024 court photo of his Jordan Tatum 2s with
   **"Deuce & Dylan" handwritten on the heel** (source: CelticsUnite X post 1842295562936172725),
   red-circled + OCT 2024 chip. The baby's name is therefore SHOWN at the beat (verified sayable:
   Yahoo/Complex/Bossip all covered the name reveal) without touching the baked VO/captions.

**Master:** 98.6s, 1080x1920@30, h264 crf18, aac mono 44.1k, 65.2MB. QC'd at 6 checkpoints.

## Facts verified this session (do not re-litigate)

- **The Aug 23, 2025 "wedding" is FAKE NEWS** — content-farm articles + an AI-generated portrait on a
  Celtics fan page. Yahoo (Oct 19, 2025, post-dating the claimed wedding): *"Neither wears a wedding
  ring, and no one has dug up public records of a legal wedding."* NEVER call her his wife on this
  channel. The hook's "very private relationship" framing is the accurate, comment-proof wording.
  (Pinned-comment angle available: "the internet AI-generated a wedding for them — that's how starved
  people are; the real story is stranger.")
- **Son = Dylan**, b. Aug 2024, name revealed Oct 2024 via "Deuce & Dylan" on his game shoes. Sayable.
- **No authentic two-shot of the couple exists in circulation** — every outlet uses side-by-side
  collages; that's why the split-frame card matches the genre's visual language. The one both-in-frame
  video: fan X clip, Paris (she steps aside). Do not use the AI wedding photo ANYWHERE.
- **Voice provenance**: story lane = "Fixed Games Narrator" on eleven_v3 (verified from ElevenLabs
  /v1/history — v3 items hide voice/text inside `dialogue[]`). Kyrie video's own takes are older than
  the 1000-item history window; owner's ear says same voice as tatum (documented) — treated as settled.

## Release checklist (owner-called, when home)

1. **Upload v4 via Studio** (house rule: browser upload, never API-insert for new videos on this channel).
   - Title: **"They Never Announced Anything | Tatum & Ella Mai"** (or owner's call — the Kyrie-mirror
     alternative "Why did Jayson Tatum never announce her? | Ella Mai" is pre-approved wording-wise).
   - Description (Kyrie format + credit):
     > He has never publicly discussed her. The world found out by accident — an eyes emoji, a jersey
     > camera, a pair of sneakers. The story of Jayson Tatum and Ella Mai.
     >
     > Music: Cedar Diagram — "Pocket In Oak"
     >
     > Footage used under commentary. Narration is an AI voice.
   - Thumbnail: frame-pick the split-frame card (~0:06–0:10).
2. **PARK OR DELETE the old v1 draft `AsQmhIepBnI` — it has publishAt 2026-08-30T15:00Z.**
   If left alone it publishes the OLD cut (wrong sneakers, no hook) on Aug 30. Same landmine class as
   the Woolson v9 incident. yt-schedule.yml lane on vault-pulse can move/park it, yt-delete.yml can kill it.
3. Steph (`MwBFZRoRt9c`) + LeBron (`ck5KDLoint0`) drafts also sit at publishAt 08-30 — same treatment
   pending their own hook/receipt passes (formula now established by this video).
4. **DistroKid manual claim** on the Kyrie video was escalated to a human (support chat, this morning) —
   watch for their reply; claim = revenue pre-YPP. Do NOT allowlist any channel until its YPP approval.
5. Also unreleased in the pipeline: a **Vanessa Bryant/Kobe story** VO'd Aug 22 (found in ElevenLabs history).

## Assets on this branch (`media/tatum-v4/`)

- `open_C_take1.mp3` — the hook VO used in v4 (C2–C4 alternates in Actions artifacts, run 32717131267)
- `card_open.png`, `card_open_circ.png`, `card_close_circ.png` — eyes-emoji receipt cards
- `card_shoes.png` — Dylan/Deuce reveal card · `card_split.png` — two-shot/thumbnail card
- `bso-ella-tatum.png` — the original 2019 comments screenshot (provenance)
- `dylan-deuce-shoes.jpg` — the original Oct 2024 sneaker photo (provenance)
- `hook.mp4` — the rendered 10s open (splice source, re-derivable)

## Rebuild lane (if anything needs redoing)

All intermediate scripts live in the session scratchpad (dies with session) but the recipe is simple:
stills + cards + caption PNGs overlaid via ffmpeg; hook concat'd with v1 (`agent/story-fixfiles-yt-release-20260822`
branch still holds v1); card enable-windows in this doc. VO regen: workflow pattern on branch
`agent/tatum-open-vo` in YoutubeVideos (TTS endpoint, model eleven_v3, stability 0.5, voice o7mizjPovZD29h3qPclF).
**Delete `agent/tatum-open-vo` after the release is done.**

## The bigger night (separate threads, see memory + the Ignition Week artifact)

- Kyrie video: 100K+ views in ~56h; monetization projection artifact updated (4,000h nearly banked by
  this one video; subs are the race). Format finding: **length gates browse distribution** (68–83s → 1.7–5%
  browse; 164s → 60%) — this v4 at 98.6s is a middle case; 3:05+ remains the clean hours lane.
- Pocket In Oak (Cedar Diagram) confirmed as the story-lane bed; DistroKid Social Media Pack active;
  claims = pre-YPP revenue path.
- Vault Pulse "restricted" OAuth analytics file is publicly fetchable on the Pages site — flagged, unresolved.
