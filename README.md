# Vault Pulse

GitHub-hosted YouTube, TikTok, and Instagram analytics for the three-channel
network.

## Live dashboard

The production site is deployed through GitHub Pages:

<https://blovely133.github.io/vault-pulse-dashboard/>

## How it works

- The browser loads a static dashboard from GitHub Pages.
- A scheduled GitHub Action checks configured YouTube, TikTok, and Instagram
  accounts
  every 15 minutes.
- An independent watchdog checks five minutes later and starts a recovery
  refresh when GitHub skipped the primary schedule.
- An open dashboard quietly checks for a newly deployed snapshot every five
  minutes and whenever its browser tab becomes visible again.
- The Action stores a rolling 31-day history in
  `site/data/dashboard.json`.
- YouTube credentials stay in encrypted GitHub Actions secrets.
- TikTok OAuth and refresh tokens stay encrypted on the existing Render
  persistent disk. The Action receives only sanitized analytics through an
  authenticated Vault Pulse endpoint.
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
- TikTok account: `@sylva6806`
- Instagram account: `@sylvasblessing`

Add these Actions secrets under **Settings → Secrets and variables → Actions**:

- `YOUTUBE_API_KEY`
- `VAULT_PULSE_DATA_TOKEN`

TikTok access needs the `user.info.basic`, `user.info.profile`,
`user.info.stats`, and `video.list` scopes.

The Render service uses these private environment values:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `VAULT_PULSE_ADMIN_TOKEN`
- `VAULT_PULSE_DATA_TOKEN`

The OAuth callback is
`https://testing-multiplayer-server.onrender.com/vault-pulse/tiktok/callback`.
After the environment is configured, connect the three accounts through
`https://testing-multiplayer-server.onrender.com/vault-pulse/setup`.

All three YouTube channels share `YOUTUBE_API_KEY`. Channel identities are
stored in `site/data/dashboard.json`.

## Channel report metrics

Each channel report combines live public platform data with optional private
analytics and publishing-workflow data:

- Live public data: views, audience, likes, videos, engagement per 1,000
  views, 7-day post-count parity, and cadence adherence.
- YouTube Analytics data: chose-to-view, swipe-away (calculated as
  `100 - choseToViewRate`), average percentage viewed, engaged views,
  subscriber conversion, first-24-hour performance, and returning viewers.
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

## Local preview

From the repository root:

```powershell
python -m http.server 4173 --directory site
```

Then open <http://localhost:4173/>.

## Manual refresh

Run the **Refresh and deploy Vault Pulse** workflow from the repository's
Actions tab. Scheduled runs start at minutes 7, 22, 37, and 52 of every hour.
