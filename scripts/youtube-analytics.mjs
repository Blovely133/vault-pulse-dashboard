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
//
// A null here NEVER means zero. Every null carries a reason code in
// `analytics.unavailable` so the dashboard can say WHY a dash is a dash --
// "not authorized", "no data yet", "still processing" and "the read failed"
// used to collapse into the same blank cell, which is what made the last
// outage cost a debugging session instead of a glance.

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const reportsEndpoint = "https://youtubeanalytics.googleapis.com/v2/reports";
const shortsContentType = "SHORTS";

// The owner's stated 12-month target. Lives here so the site does not have to
// carry its own copy of the number.
export const watchHoursGoal = 3_000;
export const ladderWindowDays = 365;

// Maps a YouTube channel ID to the Actions secret holding its refresh token.
// A channel that is absent here has no authorization and stays null.
export const channelRefreshTokenEnv = Object.freeze({
  UCUzrKvQc2Yud2WGJcFfl00g: "YT_REFRESH_THEARCHIVELIVES",
  UClVSNWZc1f3sel37mrNOfgA: "YT_REFRESH_FIXEDFIGHTS",
  // Quoted: this id contains a hyphen, which is not a valid bare key.
  "UC8Uj7A6wSYlJ-eekeGc6GJw": "YT_REFRESH_SYLVASMYSTERIES",
  UCF0g1hEWIJI0XXhmfBkzroQ: "YT_REFRESH_ANIMEVAULT",
  UCL0PybSo7k08IoLqtn4MIbg: "YT_REFRESH_AXOLOTLDRAMA",
  // Added 2026-08-09. Quoted throughout -- Court Signal's id contains a hyphen
  // and the other two are quoted for consistency, so nobody has to re-check.
  "UC5amukolWTisi6cjGEU68FA": "YT_REFRESH_HISTORYOFHUMANS",
  "UCdIcgTi2g2H3Z7xtwKhzc0Q": "YT_REFRESH_ANIMERECAPS",
  "UCya0t0Lg1eDN-oM2eAOcwRw": "YT_REFRESH_COURTSIGNAL",
});

export const authorizedAnalyticsDefaults = Object.freeze({
  views: null,
  engagedViews: null,
  averageViewDurationSeconds: null,
  averagePercentageViewed: null,
  estimatedMinutesWatched: null,
  // estimatedMinutesWatched / 60. Both are emitted: minutes is the API's own
  // unit, hours is what the 3,000-hour goal is denominated in, and making the
  // browser divide is how unit bugs get shipped.
  watchHours: null,
  subscribersGained: null,
  subscribersLost: null,
  subscribersNet: null,
  subscribersPerThousandEngagedViews: null,
  likes: null,
  comments: null,
  shares: null,
  // No YouTube API reports these. They are never estimated or derived.
  // engagedViews/views is NOT chose-to-view: the denominator is views, not
  // impressions. Do not relabel it as one.
  choseToViewRate: null,
  swipeAwayRate: null,
  returningViewers: null,
  // Needs per-video first-24-hour data, which a channel-level report cannot
  // produce, so it also stays null here.
  twentyFourHourVsBaseline: null,
});

// Studio-only for good: no metric exists in youtubeAnalytics v2 for any of
// these, so they are dashes forever on every channel regardless of auth state.
const studioOnlyFields = Object.freeze([
  "choseToViewRate",
  "swipeAwayRate",
  "returningViewers",
]);

// Which report each metric came out of. A field whose own query was rejected
// must not be reported as "still processing".
const fieldSourceBlock = Object.freeze({
  views: "totals",
  engagedViews: "totals",
  averageViewDurationSeconds: "totals",
  averagePercentageViewed: "totals",
  subscribersGained: "daily",
  subscribersLost: "daily",
  subscribersNet: "daily",
  subscribersPerThousandEngagedViews: "daily",
  daily: "daily",
  estimatedMinutesWatched: "engagement",
  watchHours: "engagement",
  likes: "engagement",
  comments: "engagement",
  shares: "engagement",
  watchHoursLadder: "ladder",
});

export const analyticsReasonCodes = Object.freeze({
  studioOnly: "studio-only",
  noDataYet: "no-data-yet",
  noShortsRows: "no-shorts-rows",
  lagging: "lagging",
  notAuthorized: "not-authorized",
  refreshError: "refresh-error",
  notCollected: "not-collected",
});

// Reason-code copy lives in the data, not in app.js, so the policy sentence
// has exactly one home. `lagging` is the only one that needs a value spliced
// in, and that value is only known once every channel has been read.
export function analyticsReasons(dataThroughDate = null) {
  return {
    "studio-only":
      "YouTube Studio only. No API reports this, so it will always show a dash.",
    "no-data-yet":
      "YouTube Analytics has not processed any Shorts data for this channel in the reporting window yet.",
    "no-shorts-rows":
      "YouTube Analytics returned data for this window, but none of it was classified as a Short.",
    lagging: dataThroughDate
      ? `YouTube Analytics is processing. Data currently runs through ${dataThroughDate}.`
      : "YouTube Analytics is processing. No day in this window has finished processing yet.",
    "not-authorized": "This channel has not connected YouTube Analytics.",
    "refresh-error":
      "The last analytics read failed. It will retry on the next refresh.",
    "not-collected": "Not collected yet.",
  };
}

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

function round2(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

// Minutes are what the API returns; hours are what the goal is counted in.
export function minutesToHours(minutes) {
  return minutes == null ? null : round2(minutes / 60);
}

function columnIndexes(payload) {
  const headers = Array.isArray(payload?.columnHeaders)
    ? payload.columnHeaders
    : [];
  return new Map(headers.map((header, index) => [header?.name, index]));
}

// Raw row count, BEFORE the SHORTS filter. This is the field that separates
// "the API has nothing yet" from "the API had rows and the filter ate them".
export function rowCount(payload) {
  return Array.isArray(payload?.rows) ? payload.rows.length : 0;
}

export function refreshTokenEnvForChannel(youtubeChannelId) {
  return channelRefreshTokenEnv[String(youtubeChannelId ?? "")] ?? null;
}

export function analyticsWindow(referenceDate, days = 28) {
  // YouTube Analytics lags, so the window ends yesterday rather than today.
  // It lags by more than a day in practice -- see `dataThroughDate`, which
  // reports the last day the API actually returned rather than the last day
  // that was asked for.
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

// Report (C): dimensions=day,creatorContentType, the watch-time and engagement
// metrics. Deliberately a separate call from (A)/(B): `creatorContentType`
// only accepts a subset of metrics and the API rejects the WHOLE request with
// a 400 if one unsupported name is in the list, so widening (A) would put the
// three channels that already work at risk of losing everything.
export function summarizeShortsEngagement(payload) {
  const rows = shortsRows(payload);
  if (!rows.length) return null;

  const estimatedMinutesWatched = total(rows, "estimatedMinutesWatched");

  return {
    estimatedMinutesWatched,
    watchHours: minutesToHours(estimatedMinutesWatched),
    likes: total(rows, "likes"),
    comments: total(rows, "comments"),
    shares: total(rows, "shares"),
    daily: rows
      .map((row) => {
        const minutes = nullableInteger(row.estimatedMinutesWatched);
        return {
          date: String(row.day ?? ""),
          estimatedMinutesWatched: minutes,
          watchHours: minutesToHours(minutes),
        };
      })
      .sort((left, right) => (left.date < right.date ? -1 : 1)),
  };
}

// Report (D): dimensions=creatorContentType over a rolling 12 months. The
// 3,000-hour goal is a 12-month figure; a 28-day total cannot answer it, and
// scaling one up to a year would be a fabricated number.
export function summarizeShortsLadder(payload) {
  const rows = shortsRows(payload);
  if (!rows.length) return null;

  const estimatedMinutesWatched = total(rows, "estimatedMinutesWatched");
  const subscribersGained = total(rows, "subscribersGained");
  const subscribersLost = total(rows, "subscribersLost");

  return {
    estimatedMinutesWatched,
    watchHours: minutesToHours(estimatedMinutesWatched),
    views: total(rows, "views"),
    subscribersGained,
    subscribersLost,
    subscribersNet:
      subscribersGained == null || subscribersLost == null
        ? null
        : subscribersGained - subscribersLost,
  };
}

export function buildWatchHoursLadder({ ladder = null, window = null } = {}) {
  const watchHours = ladder?.watchHours ?? null;

  return {
    goalHours: watchHoursGoal,
    windowDays: ladderWindowDays,
    startDate: window?.startDate ?? null,
    endDate: window?.endDate ?? null,
    estimatedMinutesWatched: ladder?.estimatedMinutesWatched ?? null,
    watchHours,
    remainingHours:
      watchHours == null ? null : round2(Math.max(0, watchHoursGoal - watchHours)),
    progressPercent:
      watchHours == null ? null : round2((watchHours / watchHoursGoal) * 100),
    views: ladder?.views ?? null,
    subscribersGained: ladder?.subscribersGained ?? null,
    subscribersLost: ladder?.subscribersLost ?? null,
    subscribersNet: ladder?.subscribersNet ?? null,
  };
}

// Report (B) carries the audience columns and report (C) the watch-time ones.
// They are joined on `date`, never on array index: YouTube omits days with no
// data entirely, so both series are sparse and their gaps need not line up.
export function mergeDailySeries(base = null, engagement = null) {
  if (!base && !engagement) return null;

  const merged = new Map();
  for (const entry of base ?? []) {
    merged.set(entry.date, { ...entry });
  }
  for (const entry of engagement ?? []) {
    merged.set(entry.date, { ...(merged.get(entry.date) ?? {}), ...entry });
  }

  return [...merged.values()]
    .map((entry) => ({
      date: entry.date,
      views: entry.views ?? null,
      engagedViews: entry.engagedViews ?? null,
      subscribersGained: entry.subscribersGained ?? null,
      subscribersLost: entry.subscribersLost ?? null,
      estimatedMinutesWatched: entry.estimatedMinutesWatched ?? null,
      watchHours: entry.watchHours ?? null,
    }))
    .sort((left, right) => (left.date < right.date ? -1 : 1));
}

export function lastDailyDate(daily) {
  const dates = (Array.isArray(daily) ? daily : [])
    .map((entry) => entry?.date)
    .filter((date) => typeof date === "string" && date.length === 10);
  if (!dates.length) return null;

  return dates.reduce((latest, date) => (date > latest ? date : latest));
}

export function emptyRowsReturned() {
  return {
    totals: null,
    daily: null,
    engagement: null,
    ladder: null,
    shortsTotals: null,
    shortsDaily: null,
    shortsEngagement: null,
    shortsLadder: null,
  };
}

// Every null gets a reason. The block-aware rules matter: a field whose own
// report was rejected reads "the read failed", not "still processing", and a
// channel whose reports came back with rows that were all long-form reads
// "nothing was a Short" rather than "no data yet".
export function assignUnavailableReasons(analytics) {
  const rows = analytics.rowsReturned ?? emptyRowsReturned();
  const unavailable = {};

  const blockReason = (block) => {
    const raw = rows[block];
    const shorts =
      rows[
        `shorts${block.charAt(0).toUpperCase()}${block.slice(1)}`
      ];
    if (raw == null) return analyticsReasonCodes.refreshError;
    if (raw === 0) return analyticsReasonCodes.noDataYet;
    if (shorts === 0) return analyticsReasonCodes.noShortsRows;
    return analyticsReasonCodes.lagging;
  };

  const candidates = [
    ...Object.keys(authorizedAnalyticsDefaults),
    "daily",
    "watchHoursLadder",
  ];

  for (const field of candidates) {
    if (studioOnlyFields.includes(field)) {
      unavailable[field] = analyticsReasonCodes.studioOnly;
      continue;
    }
    const value = analytics[field];
    const missing =
      value == null ||
      (field === "watchHoursLadder" && value?.watchHours == null);
    if (!missing) continue;

    if (field === "twentyFourHourVsBaseline") {
      unavailable[field] = analyticsReasonCodes.notCollected;
      continue;
    }
    if (!analytics.authorized) {
      unavailable[field] =
        analytics.connectionLabel === "Refresh error"
          ? analyticsReasonCodes.refreshError
          : analyticsReasonCodes.notAuthorized;
      continue;
    }
    unavailable[field] = blockReason(fieldSourceBlock[field] ?? "totals");
  }

  return unavailable;
}

export function buildChannelAnalytics({
  totals = null,
  daily = null,
  engagement = null,
  ladder = null,
  rowsReturned = null,
  ladderWindow = null,
  warnings = [],
} = {}) {
  const engagedViews = totals?.engagedViews ?? daily?.engagedViews ?? null;
  const subscribersGained = daily?.subscribersGained ?? null;
  const subscribersLost = daily?.subscribersLost ?? null;
  const mergedDaily = mergeDailySeries(daily?.daily ?? null, engagement?.daily ?? null);

  const analytics = {
    ...authorizedAnalyticsDefaults,
    authorized: true,
    connectionLabel: "Connected",
    views: totals?.views ?? daily?.views ?? null,
    engagedViews,
    averageViewDurationSeconds: totals?.averageViewDurationSeconds ?? null,
    averagePercentageViewed: totals?.averageViewPercentage ?? null,
    estimatedMinutesWatched: engagement?.estimatedMinutesWatched ?? null,
    watchHours: engagement?.watchHours ?? null,
    subscribersGained,
    subscribersLost,
    subscribersNet:
      subscribersGained == null || subscribersLost == null
        ? null
        : subscribersGained - subscribersLost,
    subscribersPerThousandEngagedViews:
      engagedViews > 0 && subscribersGained != null
        ? (subscribersGained / engagedViews) * 1000
        : null,
    likes: engagement?.likes ?? null,
    comments: engagement?.comments ?? null,
    shares: engagement?.shares ?? null,
    daily: mergedDaily,
    // The last day the API actually returned, which is what the reader needs
    // to see -- the requested endDate is routinely two days ahead of it.
    dataThroughDate: lastDailyDate(mergedDaily),
    watchHoursLadder: buildWatchHoursLadder({ ladder, window: ladderWindow }),
    rowsReturned: { ...emptyRowsReturned(), ...(rowsReturned ?? {}) },
    warnings,
  };
  analytics.unavailable = assignUnavailableReasons(analytics);

  return analytics;
}

export function unavailableChannelAnalytics(connectionLabel) {
  const analytics = {
    ...authorizedAnalyticsDefaults,
    authorized: false,
    connectionLabel,
    daily: null,
    dataThroughDate: null,
    watchHoursLadder: buildWatchHoursLadder(),
    rowsReturned: emptyRowsReturned(),
    warnings: [],
  };
  analytics.unavailable = assignUnavailableReasons(analytics);

  return analytics;
}

export function buildAuthorizedAnalytics({
  capturedAt,
  window,
  ladderWindow = null,
  channels,
}) {
  const dataThroughDate = (channels ?? [])
    .map((channel) => channel?.analytics?.dataThroughDate ?? null)
    .filter(Boolean)
    .reduce((latest, date) => (latest == null || date > latest ? date : latest), null);

  return {
    generatedAt: capturedAt,
    // OAuth-sourced. See the file header before merging any of this into
    // site/data/dashboard.json.
    restricted: true,
    policy: "YouTube Developer Policy III.E.3.b",
    startDate: window.startDate,
    endDate: window.endDate,
    // The newest day any channel actually returned. `endDate` is what was
    // asked for; this is what arrived. They differ by however far behind
    // YouTube's processing is, and the gap is not an error.
    dataThroughDate,
    goal: {
      watchHours: watchHoursGoal,
      windowDays: ladderWindowDays,
      startDate: ladderWindow?.startDate ?? null,
      endDate: ladderWindow?.endDate ?? null,
    },
    reasons: analyticsReasons(dataThroughDate),
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

// Runs one report and degrades to null instead of throwing. Used only for the
// reports added after the original two: `creatorContentType` accepts a subset
// of metrics and rejects the entire request over a single unsupported name, so
// an optional report that threw would take the channel's working numbers down
// with it. The metric list goes into the warning -- it is the one thing needed
// to fix such a rejection, and it contains no credentials.
async function optionalReport(request, fetchImpl, label) {
  try {
    return { payload: await queryReport(request, fetchImpl), warning: null };
  } catch (error) {
    return {
      payload: null,
      warning: `${label} (${request.metrics}): ${error?.message ?? error}`,
    };
  }
}

export async function fetchChannelShortsAnalytics(
  { channelId, clientId, clientSecret, refreshToken, window, ladderWindow },
  fetchImpl = fetch,
) {
  const accessToken = await exchangeRefreshToken(
    { clientId, clientSecret, refreshToken },
    fetchImpl,
  );
  // Reports (A) and (B) are the established pair. They still throw, so a real
  // authorization or permission failure is reported as such rather than being
  // quietly downgraded to "no data".
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
  const engagement = await optionalReport(
    {
      accessToken,
      channelId,
      ...window,
      dimensions: "day,creatorContentType",
      metrics: "estimatedMinutesWatched,likes,comments,shares",
    },
    fetchImpl,
    "watch-time report",
  );
  const resolvedLadderWindow = ladderWindow ?? null;
  const ladder = resolvedLadderWindow
    ? await optionalReport(
        {
          accessToken,
          channelId,
          ...resolvedLadderWindow,
          dimensions: "creatorContentType",
          metrics:
            "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        },
        fetchImpl,
        "12-month watch-hours report",
      )
    : { payload: null, warning: null };

  const totalsRows = summarizeShortsTotals(totalsPayload);
  const dailyRows = summarizeShortsDaily(dailyPayload);
  const engagementRows = engagement.payload
    ? summarizeShortsEngagement(engagement.payload)
    : null;
  const ladderRows = ladder.payload
    ? summarizeShortsLadder(ladder.payload)
    : null;

  return buildChannelAnalytics({
    totals: totalsRows,
    daily: dailyRows,
    engagement: engagementRows,
    ladder: ladderRows,
    ladderWindow: resolvedLadderWindow,
    rowsReturned: {
      totals: rowCount(totalsPayload),
      daily: rowCount(dailyPayload),
      engagement: engagement.payload ? rowCount(engagement.payload) : null,
      ladder: ladder.payload ? rowCount(ladder.payload) : null,
      shortsTotals: shortsRows(totalsPayload).length,
      shortsDaily: shortsRows(dailyPayload).length,
      shortsEngagement: engagement.payload
        ? shortsRows(engagement.payload).length
        : null,
      shortsLadder: ladder.payload ? shortsRows(ladder.payload).length : null,
    },
    warnings: [engagement.warning, ladder.warning].filter(Boolean),
  });
}
