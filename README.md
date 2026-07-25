# Vault Pulse

GitHub-hosted YouTube and TikTok analytics for the three-channel network.

## Live dashboard

The production site is deployed through GitHub Pages:

<https://blovely133.github.io/vault-pulse-dashboard/>

## How it works

- The browser loads a static dashboard from GitHub Pages.
- A scheduled GitHub Action checks configured YouTube and TikTok accounts
  hourly.
- The Action stores a rolling 31-day history in
  `site/data/dashboard.json`.
- API credentials stay in encrypted GitHub Actions secrets and are never
  included in the website.

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

Add these Actions secrets under **Settings → Secrets and variables → Actions**:

- `YOUTUBE_API_KEY`
- `TIKTOK_ACCESS_TOKEN_AXOLOTL_DRAMA`
- `TIKTOK_ACCESS_TOKEN_ANIME_COUNTDOWN_VAULT`
- `TIKTOK_ACCESS_TOKEN_KIDS_HISTORY`

TikTok access needs the `user.info.basic`, `user.info.profile`,
`user.info.stats`, and `video.list` scopes.

All three YouTube channels share `YOUTUBE_API_KEY`. Channel identities are
stored in `site/data/dashboard.json`.

## Local preview

From the repository root:

```powershell
python -m http.server 4173 --directory site
```

Then open <http://localhost:4173/>.

## Manual refresh

Run the **Refresh and deploy Vault Pulse** workflow from the repository's
Actions tab. Its scheduled run starts at minute 17 of every hour.
