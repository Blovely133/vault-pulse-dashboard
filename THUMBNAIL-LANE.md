# Thumbnail lane — Short 055

> **Warning:** the swipe-through Shorts feed is widely reported to render a frame
> from the video no matter what thumbnail you set, so expect this to change Home /
> Search / channel page / subscriptions only — not the in-feed image.

Sets a custom thumbnail on one already-published video via the YouTube Data API
`thumbnails.set`. Dry-run is the default and nothing is written without an exact
confirm string.

- Workflow: `.github/workflows/yt-thumbnail.yml`
- Job file: `thumbnail-job.json` (committing this file **is** the trigger)
- Candidates: `thumbnails/055/thumb_A.jpg`, `thumb_B.jpg`, `thumb_C.jpg`

## Target

| | |
|---|---|
| Video | `nut564AG-js` — "The Last Titanic Survivor Couldn't Remember It" |
| Channel | `UCUzrKvQc2Yud2WGJcFfl00g` (@thearchivelives) |
| Status | public, published 2026-08-17T15:00:39Z, 57s (a Short) |

## Candidates

All three are 1280x720 JPEG, well inside the API's 2 MB cap. Candidate **D**
(ITN interview frame) is deliberately **not** in this branch — it is fair-use
footage and should not be used as a thumbnail.

| File | Source | Bytes |
|---|---|---|
| `thumbnails/055/thumb_A.jpg` | emotive closeup, 1999 | 191,719 |
| `thumbnails/055/thumb_B.jpg` | baby, 1912 | 117,122 |
| `thumbnails/055/thumb_C.jpg` | then / now, 1912 + 2009 | 199,636 |

## How the trigger works

`on: push` to `agent/yt-thumbnail-lane`, filtered to `paths: [thumbnail-job.json]`.
Only a commit that touches the job file starts a run — editing the workflow or
adding images does not. `workflow_dispatch` is declared as a secondary trigger,
but the workflow does not exist on `main`, so GitHub does not register it for
dispatch; **the push trigger is the one that works.**

## Dry run (safe, read-only)

Set `mode` to `dry-run` and leave `confirm` empty:

```json
{
  "channel": "UCUzrKvQc2Yud2WGJcFfl00g",
  "video_id": "nut564AG-js",
  "mode": "dry-run",
  "image": "thumbnails/055/thumb_A.jpg",
  "confirm": ""
}
```

Commit it to this branch. The run reads the video and validates the image
without writing, ending in `YTT_DRY_OK` (or `YTT_DRY_FAIL <reason>`).

## Going live later

1. Edit `thumbnail-job.json` on this branch:
   - `"mode": "set"`
   - `"image"`: the candidate you picked, e.g. `"thumbnails/055/thumb_B.jpg"`
   - `"confirm": "SET nut564AG-js"` — exactly this string, or the job refuses
2. Commit and push to `agent/yt-thumbnail-lane`. That push fires the run.
3. Watch it:

```bash
gh run list  --repo Blovely133/vault-pulse-dashboard --branch agent/yt-thumbnail-lane --limit 5
gh run view <run-id> --repo Blovely133/vault-pulse-dashboard --log | grep YTT_
```

The confirm string must match `SET ` + the `video_id` in the same file. Change
the video and you must change the confirm string too — a stale confirm fails
closed with `YTT_REFUSED confirm string missing`.

## Verifying

- **Log:** look for `YTT_SET_OK nut564AG-js`, then the `YTT_THUMB_AFTER` lines.
  Their URLs should differ from `YTT_THUMB_BEFORE` — a custom thumbnail reads
  back as an `i.ytimg.com/.../hqdefault_custom_*.jpg`-style URL rather than the
  plain auto-generated one. The job re-reads the video independently (not the
  write echo) and polls for up to 30s, because `videos.list` lags a write.
- **Studio:** Content → Shorts → the Short → Thumbnail. Desktop Studio is the
  surface that shows an uploaded custom Shorts thumbnail.
- **Do not judge it from the Shorts feed** — see the warning at the top.
- The job also fails if the title or privacy status changed underneath it
  (`YTT_VERIFY_FAILED`), so a successful line means only the thumbnail moved.

## Guards

- Aborts unless the video actually belongs to `channel`.
- `mode: set` requires the exact confirm string; anything else exits 1.
- Image is checked before any write: exists, ≤ 2 MB, ≥ 640px wide, real JPEG/PNG.
- Secrets are injected via the job's `env:` block only and never printed; the
  token exchange failure path prints the status code, not the response body.

## What the docs actually say

- **`thumbnails.set` reference** — 2 MB max, `image/jpeg` / `image/png` /
  `application/octet-stream`, scopes `youtube.upload` / `youtube` /
  `youtube.force-ssl` / `youtubepartner`.
  <https://developers.google.com/youtube/v3/docs/thumbnails/set>
  **No Shorts language of any kind**, and no entry for the 2026 Shorts launch in
  the revision history. Whether the API path works on a Short is undocumented.
- **Custom Shorts thumbnails launched 2026-07-24**, YPP creators first.
  <https://blog.youtube/news-and-events/youtube-studio-custom-thumbnail-updates/>
  Anything written before that date says Shorts thumbnails are impossible and is
  now wrong — including some still-cached Google search snippets.
- **Add custom thumbnails on YouTube** (Help Center) — custom Shorts thumbnails
  are "currently only available to add in YouTube Studio on a computer", and can
  be added after upload. Mobile app does frame-selection only.
  <https://support.google.com/youtube/answer/72431>
- **Where a Shorts thumbnail renders: docs silent.** No Help page states it. The
  community read (Search Engine Journal 2024-09-04; PPC Land 2026-07-26) is that
  it does not show in the Shorts feed itself.
