// YouTube Analytics v2 reader for the channels that granted OAuth access.
//
// Everything this module returns is OAuth-sourced, and YouTube Developer
// Policy III.E.3.b restricts OAuth-sourced metrics to the authorising user.
// The refresh writes it to site/data/authorized-analytics.json instead of
// merging it into site/data/dashboard.json, so putting a sign-in gate in
// front of it later is a path-gating change instead of an untangling job.
//
// Nothing here reads a previously written file. Every record is rebuilt from
// the current API response, so a value that stops being available becomes
// null again instead of surviving as a stale number that still looks fresh.

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const reportsEndpoint = "https://youtubeanalytics.googleapis.com/v2/reports";
const shortsContentType = "SHORTS";

// Maps a YouTube channel ID to the Actions secret holding its refresh token.
// A channel that is absent here has no authorization and stays null.
export const channelRefreshTokenEnv = Object.freeze({
  UCUzrKvQc2Yud2WGJcFfl00g: "YT_REFRESH_THEARCHIVELIVES",
  UClVSNWZc1f3sel37mrNOfgA: "YT_REFRESH_FIXEDFIGHTS",
  // Quoted: this id contains a hyphen, which is not a valid bare key.
  "UC8Uj7A6wSYlJ-eekeGc6GJw": "YT_REFRESH_SYLVASMYSTERIES",
});

export const authorizedAnalyticsDefaults = Object.freeze({
  views: null,
  engagedViews: null,
  averageViewDurationSeconds: null,
  averagePercentageViewed: null,
  subscribersGained: null,
  subscribersLost: null,
  subscribersPerThousandEngagedViews: null,
  // No YouTube API reports these. They are never estimated or derived.
  choseToViewRate: null,
  swipeAwayRate: null,
  returningViewers: null,
  // Needs per-video first-24-hour data, which a channel-level report cannot
  // produce, so it also stays null here.
  twentyFourHourVsBaseline: null,
});

function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function integer(value) {
  return Math.round(numeric(value));
}

// Unknown must stay unknown. `integer` folds null to 0, which on a chart is
// indistinguishable from a real zero -- so anything a reader could mistake for
// a measurement goes through here instead.
function nullableInteger(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(0, parsed)) : null;
}

function columnIndexes(payload) {
  const headers = Array.isArray(payload?.columnHeaders)
    ? payload.columnHeaders
    : [];
  return new Map(headers.map((header, index) => [header?.name, index]));
}

export function refreshTokenEnvForChannel(youtubeChannelId) {
  return channelRefreshTokenEnv[String(youtubeChannelId ?? "")] ?? null;
}

export function analyticsWindow(referenceDate, days = 28) {
  // YouTube Analytics lags, so the window ends yesterday rather than today.
  const end = new Date(referenceDate);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (Math.max(1, days) - 1));

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// Keeps only the SHORTS rows and rekeys each one by its column name.
export function shortsRows(payload) {
  const columns = columnIndexes(payload);
  const contentTypeIndex = columns.get("creatorContentType");
  if (contentTypeIndex == null) return [];

  return (Array.isArray(payload?.rows) ? payload.rows : [])
    .filter(
      (row) =>
        String(row?.[contentTypeIndex] ?? "").toUpperCase() ===
        shortsContentType,
    )
    .map((row) =>
      Object.fromEntries(
        [...columns].map(([name, index]) => [name, row[index]]),
      ),
    );
}

// A sum is only honest when every row contributed. Summing a column with gaps
// silently treats the gaps as zero and returns a confident, wrong number -- and
// that number goes on to feed subscribersPerThousandEngagedViews.
function total(rows, field) {
  if (!rows.length) return null;
  if (rows.some((row) => nullableInteger(row[field]) == null)) return null;
  return rows.reduce((sum, row) => sum + nullableInteger(row[field]), 0);
}

function weightedAverage(rows, field, weightField) {
  const usable = rows.filter((row) => row[field] != null);
  if (!usable.length) return null;
  const weight = usable.reduce((sum, row) => sum + numeric(row[weightField]), 0);
  if (weight <= 0) return null;

  return (
    usable.reduce(
      (sum, row) => sum + numeric(row[field]) * numeric(row[weightField]),
      0,
    ) / weight
  );
}

// Report (A): dimensions=creatorContentType.
export function summarizeShortsTotals(payload) {
  const rows = shortsRows(payload);
  if (!rows.length) return null;

  return {
    views: total(rows, "views"),
    engagedViews: total(rows, "engagedViews"),
    averageViewDurationSeconds: weightedAverage(
      rows,
      "averageViewDuration",
      "views",
    ),
    averageViewPercentage: weightedAverage(
      rows,
      "averageViewPercentage",
      "views",
    ),
  };
}

// Report (B): dimensions=day,creatorContentType.
export function summarizeShortsDaily(payload) {
  const rows = shortsRows(payload);
  if (!rows.length) return null;

  return {
    views: total(rows, "views"),
    engagedViews: total(rows, "engagedViews"),
    subscribersGained: total(rows, "subscribersGained"),
    subscribersLost: total(rows, "subscribersLost"),
    daily: rows
      .map((row) => ({
        date: String(row.day ?? ""),
        views: nullableInteger(row.views),
        engagedViews: nullableInteger(row.engagedViews),
        subscribersGained: nullableInteger(row.subscribersGained),
        subscribersLost: nullableInteger(row.subscribersLost),
      }))
      .sort((left, right) => (left.date < right.date ? -1 : 1)),
  };
}

export function buildChannelAnalytics({ totals = null, daily = null } = {}) {
  const engagedViews = totals?.engagedViews ?? daily?.engagedViews ?? null;
  const subscribersGained = daily?.subscribersGained ?? null;

  return {
    ...authorizedAnalyticsDefaults,
    authorized: true,
    connectionLabel: "Connected",
    views: totals?.views ?? daily?.views ?? null,
    engagedViews,
    averageViewDurationSeconds: totals?.averageViewDurationSeconds ?? null,
    averagePercentageViewed: totals?.averageViewPercentage ?? null,
    subscribersGained,
    subscribersLost: daily?.subscribersLost ?? null,
    subscribersPerThousandEngagedViews:
      engagedViews > 0 && subscribersGained != null
        ? (subscribersGained / engagedViews) * 1000
        : null,
    daily: daily?.daily ?? null,
  };
}

export function unavailableChannelAnalytics(connectionLabel) {
  return {
    ...authorizedAnalyticsDefaults,
    authorized: false,
    connectionLabel,
    daily: null,
  };
}

export function buildAuthorizedAnalytics({ capturedAt, window, channels }) {
  return {
    generatedAt: capturedAt,
    // OAuth-sourced. See the file header before merging any of this into
    // site/data/dashboard.json.
    restricted: true,
    policy: "YouTube Developer Policy III.E.3.b",
    startDate: window.startDate,
    endDate: window.endDate,
    channels,
  };
}

export async function exchangeRefreshToken(
  { clientId, clientSecret, refreshToken },
  fetchImpl = fetch,
) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth client or refresh token is missing");
  }

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Vault-Pulse-GitHub-Action",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const payload = await response.json();
  // Only Google's own message is surfaced, never the request that carried
  // the client secret or the refresh token.
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `${response.status} ${response.statusText}`,
    );
  }

  return payload.access_token;
}

export async function queryReport(
  { accessToken, channelId, startDate, endDate, dimensions, metrics },
  fetchImpl = fetch,
) {
  const url = new URL(reportsEndpoint);
  url.searchParams.set("ids", `channel==${channelId}`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("dimensions", dimensions);
  url.searchParams.set("metrics", metrics);

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Vault-Pulse-GitHub-Action",
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `${response.status} ${response.statusText}`,
    );
  }

  return payload;
}

export async function fetchChannelShortsAnalytics(
  { channelId, clientId, clientSecret, refreshToken, window },
  fetchImpl = fetch,
) {
  const accessToken = await exchangeRefreshToken(
    { clientId, clientSecret, refreshToken },
    fetchImpl,
  );
  const totalsPayload = await queryReport(
    {
      accessToken,
      channelId,
      ...window,
      dimensions: "creatorContentType",
      metrics: "views,engagedViews,averageViewDuration,averageViewPercentage",
    },
    fetchImpl,
  );
  const dailyPayload = await queryReport(
    {
      accessToken,
      channelId,
      ...window,
      dimensions: "day,creatorContentType",
      metrics: "views,engagedViews,subscribersGained,subscribersLost",
    },
    fetchImpl,
  );

  return buildChannelAnalytics({
    totals: summarizeShortsTotals(totalsPayload),
    daily: summarizeShortsDaily(dailyPayload),
  });
}
