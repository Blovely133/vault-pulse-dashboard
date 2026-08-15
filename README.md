# Vault Pulse

GitHub-hosted YouTube, TikTok, and Instagram analytics for the five-channel
network.

## Live dashboard

The production site is deployed through GitHub Pages:

<https://blovely133.github.io/vault-pulse-dashboard/>

## Production records

- [Milo Smiling Critters Hard Edition](docs/productions/2026-08-14-milo-smiling-critters-hard-edition.md) — local creative build, audio provenance, QA, and verified YouTube delivery.
- [YouTube upload and schedule runbook](docs/operations/youtube-upload.md) — repeatable staging, dispatch, verification, failure recovery, and receipt procedure.

## How it works

- The browser loads a static dashboard from GitHub Pages.
- A one-way scheduled GitHub Action checks configured YouTube, TikTok, and
  Instagram accounts every 15 minutes.
- An independent watchdog checks five minutes later and starts a recovery
  refresh when GitHub skipped the primary schedule.
- An open dashboard quietly checks for a newly deployed snapshot every five
  minutes and whenever its browser tab becomes visible again.
- The Action stores a rolling 31-day history in
  `site/data/dashboard.json`.
- YouTube credentials stay in encrypted GitHub Actions secrets.
- TikTok is read directly by the Action from its own encrypted secrets. TikTok
  does not rotate refresh tokens, so one static `TT_REFRESH_*` secret per
  account can be reused every run without consuming anything. Each channel
  records which reader served it as `tiktokSource` in
  `site/data/dashboard.json`, rolled up in `connections.tiktokSources`.
- The older Render proxy is still wired in as a fallback for any channel whose
  direct secrets are missing, and it still hosts the one-time OAuth grant flow
  that mints the refresh tokens.
- A TikTok refresh token expires roughly a year after the ORIGINAL grant, and
  refreshing does not extend it. The Action records the deadline as
  `tiktokAuthExpiresAt` per channel and raises a `refresh.warnings` entry once
  it is within 30 days, because renewing it means re-running the OAuth flow by
  hand.
- The Instagram token stays on the AWS publisher, where it is refreshed
  automatically. Vault Pulse receives only a cached, token-free Reel analytics
  feed through the existing Cloudflare Tunnel.
- No platform credential is included in the public website.

## Connected channel identities

Channel one is preloaded with:

- Display name: `Axolotl Drama`
- YouTube channel ID: `UCL0PybSo7k08IoLqtn4MIbg`
- TikTok account: `@axlotyl2`

Channel two is preloaded with:

- Display name: `Anime Countdown Vault`
- TikTok account: `@animehype41`

Channel three is preloaded with:

- Display name: `Kids History`
- YouTube channel ID: `UCUzrKvQc2Yud2WGJcFfl00g`
- TikTok account: `@thearchivelives`
- Instagram account: `@sylvasblessing`

Channel four is preloaded with:

- Display name: `Sylva's Mysteries`
- YouTube channel ID: `UC8Uj7A6wSYlJ-eekeGc6GJw`
- Instagram account: `@sylvasmysteries`

Channel five is preloaded with:

- Display name: `Fixed Fights`
- YouTube channel ID: `UClVSNWZc1f3sel37mrNOfgA`
- Instagram account: `@fixedfightsshorts`

Add these Actions secrets under **Settings → Secrets and variables → Actions**:

- `YOUTUBE_API_KEY`
- `TT_CLIENT_KEY`
- `TT_CLIENT_SECRET`
- `TT_REFRESH_AXOLOTL2`
- `TT_REFRESH_ANIMEHYPE41`
- `TT_REFRESH_THEARCHIVELIVES`
- `VAULT_PULSE_DATA_TOKEN` (fallback proxy only)

TikTok access needs the `user.info.basic`, `user.info.profile`,
`user.info.stats`, and `video.list` scopes.

The Render service still hosts the OAuth grant flow and uses these private
environment values:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `VAULT_PULSE_ADMIN_TOKEN`
- `VAULT_PULSE_DATA_TOKEN`

The OAuth callback is
`https://testing-multiplayer-server.onrender.com/vault-pulse/tiktok/callback`.
After the environment is configured, connect the three accounts through
`https://testing-multiplayer-server.onrender.com/vault-pulse/setup`.

All five YouTube channels share `YOUTUBE_API_KEY`. Channel identities are
stored in `site/data/dashboard.json`.

## Channel report metrics

Each channel report combines live public platform data with optional private
analytics and publishing-workflow data:

- Live public data: views, audience, likes, videos, engagement per 1,000
  views, 7-day post-count parity, and cadence adherence.
- YouTube Analytics data: average percentage viewed, engaged views, watch
  hours, subscribers gained and lost, likes, comments, shares, and subscriber
  conversion. These come from OAuth and live in
  `site/data/authorized-analytics.json`, not here — see below.
- Chose-to-view, swipe-away and returning viewers are **YouTube Studio only**.
  No metric in the Analytics API reports them, so they render as a permanent
  dash. `swipeAwayRate` is `100 - choseToViewRate` only when a human typed one
  of the pair in by hand; neither is ever derived from API data, and
  `engagedViews / views` is **not** chose-to-view (its denominator is views,
  not impressions).
- Instagram performance data: views per reached account, average watch time,
  interactions per 1,000 reached accounts, saves and shares per 1,000 reached,
  and average interactions per Reel.
- Publishing data: scheduled-through date, ready-to-review count, and
  pipeline counts.

Private and publishing fields are optional. Missing values render as a dash
with a connection note instead of being estimated. Add them to a channel in
`site/data/dashboard.json` with this shape:

```json
{
  "shortsAnalytics": {
    "choseToViewRate": null,
    "averagePercentageViewed": null,
    "engagedViews": null,
    "subscribersGained": null,
    "subscribersPerThousandEngagedViews": null,
    "twentyFourHourVsBaseline": null,
    "returningViewers": null
  },
  "publishing": {
    "scheduledThrough": null,
    "readyToReview": null,
    "pipeline": {
      "planned": null,
      "editing": null,
      "review": null,
      "scheduled": null,
      "publishedThisWeek": null
    }
  }
}
```

The channel report also exposes a stable set of report fields for imports and
future OAuth-backed refreshes. Values supplied here override equivalent legacy
fields while missing values continue to render as a dash:

```json
{
  "reportMetrics": {
    "cadenceAdherence": null,
    "swipeAwayRate": null,
    "completionRate": null,
    "conversionPerThousand": null,
    "velocityRate": null,
    "returningViewers": null
  }
}
```

Percent fields use percentage points (`35.7` means `35.7%`). Conversion is
subscribers gained per 1,000 engaged views, velocity is the first-24-hour
percentage difference from the channel baseline, and returning viewers is a
count for the selected report period.

## Authorized analytics (`site/data/authorized-analytics.json`)

OAuth-sourced YouTube Analytics, written by every refresh and **never merged
into `dashboard.json`**. YouTube Developer Policy III.E.3.b restricts these
metrics to the authorising user, `dashboard.json` is committed into public git
history every 15 minutes, and this file is artifact-only — so putting a
sign-in gate in front of these numbers later stays a path change rather than
an untangling job. The site fetches both files and joins them in the browser
on `channels[].channelId` (`slug` is the fallback key).

Top level:

| Field | Meaning |
| --- | --- |
| `startDate` / `endDate` | the window that was **requested**; `endDate` is yesterday |
| `dataThroughDate` | the newest day any channel actually **returned** |
| `goal` | `watchHours` (3,000), `windowDays` (365) and the ladder window |
| `reasons` | reason code → the sentence to render under a dash |

`endDate` and `dataThroughDate` routinely differ by about two days. That gap is
YouTube's processing lag, not an error — the API accepts an `endDate` it has
not processed yet and simply returns fewer rows, with no warning.

Per channel, `analytics` holds window totals (`views`, `engagedViews`,
`averageViewDurationSeconds`, `averagePercentageViewed`,
`estimatedMinutesWatched`, `watchHours`, `subscribersGained`/`Lost`/`Net`,
`subscribersPerThousandEngagedViews`, `likes`, `comments`, `shares`), a sparse
`daily[]` series, and `watchHoursLadder` — the rolling **12-month** watch-hours
total measured against the 3,000-hour goal. The ladder is its own 365-day query
because a 28-day total cannot answer a 12-month question and scaling one up
would be an invented number.

`estimatedMinutesWatched` is the API's own unit; `watchHours` is the same value
in the unit the goal is counted in. Both are emitted so the browser never has
to divide. `averagePercentageViewed` is in percentage points and may legitimately
exceed 100 on looping Shorts.

Two fields exist so a dash can explain itself:

- `rowsReturned` — row counts **before** the SHORTS filter (`totals`, `daily`,
  `engagement`, `ladder`) and **after** it (`shortsTotals`, `shortsDaily`,
  `shortsEngagement`, `shortsLadder`). `totals: 0` means YouTube has no data
  yet; `totals: 4, shortsTotals: 0` means rows came back and none were Shorts —
  a completely different problem. A `null` means that report was rejected.
- `unavailable` — every null field name mapped to a reason code:
  `studio-only`, `no-data-yet`, `no-shorts-rows`, `lagging`, `not-authorized`,
  `refresh-error`, `not-collected`. Look the code up in the top-level `reasons`
  object and render the sentence. A **null never means zero.**

A brand-new channel therefore reads `authorized: true` / `"Connected"` /
`no-data-yet` rather than an unexplained blank, which is the honest state until
YouTube processes its first day.

## Local preview

From the repository root:

```powershell
python -m http.server 4173 --directory site
```

Then open <http://localhost:4173/>.

## Manual refresh

Run the **Refresh and deploy Vault Pulse** workflow from the repository's
Actions tab. Scheduled runs start at minutes 9, 24, 39, and 54 of every hour.
