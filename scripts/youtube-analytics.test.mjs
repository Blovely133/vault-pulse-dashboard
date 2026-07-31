import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsReasons,
  analyticsWindow,
  authorizedAnalyticsDefaults,
  buildAuthorizedAnalytics,
  buildChannelAnalytics,
  exchangeRefreshToken,
  fetchChannelShortsAnalytics,
  mergeDailySeries,
  refreshTokenEnvForChannel,
  summarizeShortsDaily,
  summarizeShortsEngagement,
  summarizeShortsLadder,
  summarizeShortsTotals,
  unavailableChannelAnalytics,
  watchHoursGoal,
} from "./youtube-analytics.mjs";

const totalsPayload = {
  columnHeaders: [
    { name: "creatorContentType" },
    { name: "views" },
    { name: "engagedViews" },
    { name: "averageViewDuration" },
    { name: "averageViewPercentage" },
  ],
  rows: [
    ["SHORTS", 4_000, 3_200, 21, 68.5],
    ["VIDEO_ON_DEMAND", 900, 700, 240, 31.25],
    ["LIVE_STREAM", 100, 80, 600, 12.5],
  ],
};

const dailyPayload = {
  columnHeaders: [
    { name: "day" },
    { name: "creatorContentType" },
    { name: "views" },
    { name: "engagedViews" },
    { name: "subscribersGained" },
    { name: "subscribersLost" },
  ],
  rows: [
    ["2026-07-28", "SHORTS", 2_500, 2_000, 5, 1],
    ["2026-07-27", "SHORTS", 1_500, 1_200, 3, 0],
    ["2026-07-28", "VIDEO_ON_DEMAND", 900, 700, 40, 9],
  ],
};

const engagementPayload = {
  columnHeaders: [
    { name: "day" },
    { name: "creatorContentType" },
    { name: "estimatedMinutesWatched" },
    { name: "likes" },
    { name: "comments" },
    { name: "shares" },
  ],
  rows: [
    ["2026-07-28", "SHORTS", 900, 40, 6, 3],
    ["2026-07-27", "SHORTS", 300, 25, 4, 1],
    ["2026-07-28", "VIDEO_ON_DEMAND", 5_000, 200, 30, 12],
  ],
};

const ladderPayload = {
  columnHeaders: [
    { name: "creatorContentType" },
    { name: "views" },
    { name: "estimatedMinutesWatched" },
    { name: "subscribersGained" },
    { name: "subscribersLost" },
  ],
  rows: [
    ["SHORTS", 120_000, 45_000, 400, 25],
    ["VIDEO_ON_DEMAND", 9_000, 90_000, 100, 5],
  ],
};

function stubFetch(responses) {
  return async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return {
      ok: next.status < 400,
      status: next.status,
      statusText: next.statusText ?? "",
      json: async () => next.payload,
    };
  };
}

test("only SHORTS rows are summed", () => {
  const totals = summarizeShortsTotals(totalsPayload);

  assert.deepEqual(totals, {
    views: 4_000,
    engagedViews: 3_200,
    averageViewDurationSeconds: 21,
    averageViewPercentage: 68.5,
  });

  const daily = summarizeShortsDaily(dailyPayload);

  assert.equal(daily.views, 4_000);
  assert.equal(daily.subscribersGained, 8);
  assert.equal(daily.subscribersLost, 1);
  assert.deepEqual(
    daily.daily.map((day) => day.date),
    ["2026-07-27", "2026-07-28"],
  );
});

test("a shorts summary keeps the unsourced fields null", () => {
  const analytics = buildChannelAnalytics({
    totals: summarizeShortsTotals(totalsPayload),
    daily: summarizeShortsDaily(dailyPayload),
  });

  assert.equal(analytics.views, 4_000);
  assert.equal(analytics.engagedViews, 3_200);
  assert.equal(analytics.averagePercentageViewed, 68.5);
  assert.equal(analytics.averageViewDurationSeconds, 21);
  assert.equal(analytics.subscribersGained, 8);
  assert.equal(analytics.subscribersPerThousandEngagedViews, 2.5);
  assert.equal(analytics.choseToViewRate, null);
  assert.equal(analytics.swipeAwayRate, null);
  assert.equal(analytics.returningViewers, null);
  assert.equal(analytics.twentyFourHourVsBaseline, null);
});

test("a channel without a refresh token has no analytics", () => {
  assert.equal(
    refreshTokenEnvForChannel("UCUzrKvQc2Yud2WGJcFfl00g"),
    "YT_REFRESH_THEARCHIVELIVES",
  );
  // Deliberately not a real channel: every real one is now granted, and using a
  // live id here made this test fail the moment that channel was authorised.
  assert.equal(refreshTokenEnvForChannel("UCnotarealchannelid00000"), null);
  assert.equal(refreshTokenEnvForChannel(undefined), null);

  const analytics = unavailableChannelAnalytics("Authorization needed");

  assert.equal(analytics.authorized, false);
  assert.equal(analytics.connectionLabel, "Authorization needed");
  assert.equal(analytics.daily, null);
  for (const field of Object.keys(authorizedAnalyticsDefaults)) {
    assert.equal(analytics[field], null, `${field} must stay null`);
  }
});

test("an empty row set stays null instead of reading as zero", () => {
  assert.equal(summarizeShortsTotals({ ...totalsPayload, rows: [] }), null);
  assert.equal(summarizeShortsTotals({}), null);
  assert.equal(
    summarizeShortsTotals({
      ...dailyPayload,
      rows: [["2026-07-28", "VIDEO_ON_DEMAND", 900, 700, 40, 9]],
    }),
    null,
  );
  assert.equal(summarizeShortsDaily({ ...dailyPayload, rows: [] }), null);

  const analytics = buildChannelAnalytics({ totals: null, daily: null });

  assert.equal(analytics.views, null);
  assert.equal(analytics.engagedViews, null);
  assert.equal(analytics.subscribersGained, null);
  assert.equal(analytics.subscribersPerThousandEngagedViews, null);
  assert.equal(analytics.daily, null);
});

test("a rejected refresh token reports Google's message without the token", async () => {
  await assert.rejects(
    () =>
      exchangeRefreshToken(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "top-secret-refresh-token",
        },
        stubFetch([
          {
            status: 400,
            statusText: "Bad Request",
            payload: {
              error: "invalid_grant",
              error_description: "Token has been expired or revoked.",
            },
          },
        ]),
      ),
    (error) => {
      assert.equal(error.message, "Token has been expired or revoked.");
      assert.equal(error.message.includes("top-secret-refresh-token"), false);
      assert.equal(error.message.includes("client-secret"), false);
      return true;
    },
  );

  await assert.rejects(
    () => exchangeRefreshToken({ clientId: "client-id" }, stubFetch([])),
    /refresh token is missing/,
  );
});

test("an Analytics API error is raised instead of being filled in", async () => {
  await assert.rejects(
    () =>
      fetchChannelShortsAnalytics(
        {
          channelId: "UCUzrKvQc2Yud2WGJcFfl00g",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          window: analyticsWindow(new Date("2026-07-29T05:00:00.000Z")),
        },
        stubFetch([
          { status: 200, payload: { access_token: "access-token" } },
          {
            status: 403,
            statusText: "Forbidden",
            payload: {
              error: { message: "Insufficient permission for this channel." },
            },
          },
        ]),
      ),
    /Insufficient permission/,
  );
});

test("the analytics window ends yesterday", () => {
  assert.deepEqual(analyticsWindow(new Date("2026-07-29T05:00:00.000Z")), {
    startDate: "2026-07-01",
    endDate: "2026-07-28",
  });
});

test("a gap in a column makes the total unknown, not a smaller number", () => {
  // Summing around a hole silently reports a confident, wrong figure -- and
  // that figure feeds subscribersPerThousandEngagedViews.
  const totals = summarizeShortsTotals({
    columnHeaders: [
      { name: "creatorContentType" },
      { name: "views" },
      { name: "engagedViews" },
    ],
    rows: [
      ["SHORTS", 2_000, 1_500],
      ["SHORTS", 1_000, null],
    ],
  });

  assert.equal(totals.views, 3_000);
  assert.equal(totals.engagedViews, null);
});

test("an unknown day reads as a dash, never as zero", () => {
  const summary = summarizeShortsDaily({
    columnHeaders: [
      { name: "day" },
      { name: "creatorContentType" },
      { name: "views" },
      { name: "engagedViews" },
      { name: "subscribersGained" },
      { name: "subscribersLost" },
    ],
    rows: [
      ["2026-07-27", "SHORTS", 900, 700, 4, 1],
      ["2026-07-28", "SHORTS", 800, null, null, null],
    ],
  });

  const daily = summary.daily;
  assert.equal(daily.length, 2);
  assert.equal(daily[1].views, 800);
  assert.equal(daily[1].engagedViews, null);
  assert.equal(daily[1].subscribersGained, null);
  assert.equal(daily[1].subscribersLost, null);

  // ...and the aggregate agrees with the series instead of contradicting it.
  assert.equal(summary.engagedViews, null);
  assert.equal(summary.subscribersGained, null);
});

test("watch time is reported in the API's minutes and in the goal's hours", () => {
  const engagement = summarizeShortsEngagement(engagementPayload);

  // Long-form minutes must not leak into a Shorts panel.
  assert.equal(engagement.estimatedMinutesWatched, 1_200);
  assert.equal(engagement.watchHours, 20);
  assert.equal(engagement.likes, 65);
  assert.equal(engagement.comments, 10);
  assert.equal(engagement.shares, 4);
  assert.deepEqual(engagement.daily, [
    { date: "2026-07-27", estimatedMinutesWatched: 300, watchHours: 5 },
    { date: "2026-07-28", estimatedMinutesWatched: 900, watchHours: 15 },
  ]);
});

test("the 12-month ladder measures the goal instead of extrapolating it", () => {
  const ladder = summarizeShortsLadder(ladderPayload);
  const analytics = buildChannelAnalytics({
    ladder,
    ladderWindow: { startDate: "2025-08-01", endDate: "2026-07-30" },
  });

  assert.equal(analytics.watchHoursLadder.goalHours, watchHoursGoal);
  assert.equal(analytics.watchHoursLadder.watchHours, 750);
  assert.equal(analytics.watchHoursLadder.remainingHours, 2_250);
  assert.equal(analytics.watchHoursLadder.progressPercent, 25);
  assert.equal(analytics.watchHoursLadder.subscribersNet, 375);
  assert.equal(analytics.watchHoursLadder.startDate, "2025-08-01");

  // No ladder report means no ladder number. It is never inferred from the
  // 28-day window.
  const missing = buildChannelAnalytics({});
  assert.equal(missing.watchHoursLadder.watchHours, null);
  assert.equal(missing.watchHoursLadder.remainingHours, null);
  assert.equal(missing.watchHoursLadder.progressPercent, null);
});

test("the daily series joins on date, never on array position", () => {
  // YouTube omits days with no data, so the two reports are sparse and their
  // gaps need not line up. Zipping by index would misdate every row after a
  // gap while still looking plausible.
  const merged = mergeDailySeries(
    [
      {
        date: "2026-07-26",
        views: 10,
        engagedViews: 8,
        subscribersGained: 1,
        subscribersLost: 0,
      },
      {
        date: "2026-07-28",
        views: 30,
        engagedViews: 25,
        subscribersGained: 2,
        subscribersLost: 1,
      },
    ],
    [
      { date: "2026-07-27", estimatedMinutesWatched: 60, watchHours: 1 },
      { date: "2026-07-28", estimatedMinutesWatched: 120, watchHours: 2 },
    ],
  );

  assert.deepEqual(
    merged.map((entry) => entry.date),
    ["2026-07-26", "2026-07-27", "2026-07-28"],
  );
  assert.equal(merged[0].views, 10);
  assert.equal(merged[0].watchHours, null);
  assert.equal(merged[1].views, null);
  assert.equal(merged[1].watchHours, 1);
  assert.equal(merged[2].views, 30);
  assert.equal(merged[2].watchHours, 2);
});

test("every dash carries a reason, and the Studio-only three always do", () => {
  const analytics = buildChannelAnalytics({
    totals: summarizeShortsTotals(totalsPayload),
    daily: summarizeShortsDaily(dailyPayload),
    engagement: summarizeShortsEngagement(engagementPayload),
    ladder: summarizeShortsLadder(ladderPayload),
    ladderWindow: { startDate: "2025-08-01", endDate: "2026-07-30" },
    rowsReturned: {
      totals: 3,
      daily: 3,
      engagement: 3,
      ladder: 2,
      shortsTotals: 1,
      shortsDaily: 2,
      shortsEngagement: 2,
      shortsLadder: 1,
    },
  });

  // A channel with real numbers still explains the three that can never fill.
  assert.equal(analytics.views, 4_000);
  assert.equal(analytics.watchHours, 20);
  assert.equal(analytics.subscribersNet, 7);
  assert.equal(analytics.unavailable.choseToViewRate, "studio-only");
  assert.equal(analytics.unavailable.swipeAwayRate, "studio-only");
  assert.equal(analytics.unavailable.returningViewers, "studio-only");
  assert.equal(analytics.unavailable.twentyFourHourVsBaseline, "not-collected");
  // A field that has a value must not be given a reason for being absent.
  assert.equal("views" in analytics.unavailable, false);
  assert.equal("watchHours" in analytics.unavailable, false);
  assert.equal(analytics.dataThroughDate, "2026-07-28");
});

test("no rows at all and no SHORTS rows are different answers", () => {
  // This is the distinction that cost a debugging session: both used to
  // collapse into an unexplained blank labelled "Connected".
  const noDataYet = buildChannelAnalytics({
    rowsReturned: {
      totals: 0,
      daily: 0,
      engagement: 0,
      ladder: 0,
      shortsTotals: 0,
      shortsDaily: 0,
      shortsEngagement: 0,
      shortsLadder: 0,
    },
  });

  assert.equal(noDataYet.authorized, true);
  assert.equal(noDataYet.connectionLabel, "Connected");
  assert.equal(noDataYet.views, null);
  assert.equal(noDataYet.unavailable.views, "no-data-yet");
  assert.equal(noDataYet.unavailable.watchHours, "no-data-yet");
  assert.equal(noDataYet.dataThroughDate, null);

  const filteredOut = buildChannelAnalytics({
    rowsReturned: {
      totals: 4,
      daily: 9,
      engagement: 9,
      ladder: 4,
      shortsTotals: 0,
      shortsDaily: 0,
      shortsEngagement: 0,
      shortsLadder: 0,
    },
  });

  assert.equal(filteredOut.unavailable.views, "no-shorts-rows");
  assert.equal(filteredOut.unavailable.subscribersGained, "no-shorts-rows");
});

test("an unauthorized channel says so instead of saying nothing", () => {
  const needsAuth = unavailableChannelAnalytics("Authorization needed");
  assert.equal(needsAuth.unavailable.views, "not-authorized");
  assert.equal(needsAuth.unavailable.watchHours, "not-authorized");
  assert.equal(needsAuth.unavailable.choseToViewRate, "studio-only");
  assert.equal(needsAuth.watchHoursLadder.watchHours, null);

  const failed = unavailableChannelAnalytics("Refresh error");
  assert.equal(failed.unavailable.views, "refresh-error");
  assert.equal(failed.unavailable.subscribersGained, "refresh-error");
});

test("a rejected optional report costs only its own metrics", () => {
  // `creatorContentType` rejects the whole request over one unsupported metric
  // name, so the watch-time and ladder reports are separate calls. A 400 on
  // either must not take views and retention down with it.
  const analytics = buildChannelAnalytics({
    totals: summarizeShortsTotals(totalsPayload),
    daily: summarizeShortsDaily(dailyPayload),
    rowsReturned: {
      totals: 3,
      daily: 3,
      engagement: null,
      ladder: null,
      shortsTotals: 1,
      shortsDaily: 2,
      shortsEngagement: null,
      shortsLadder: null,
    },
    warnings: ["watch-time report (estimatedMinutesWatched): bad metric"],
  });

  assert.equal(analytics.views, 4_000);
  assert.equal(analytics.averagePercentageViewed, 68.5);
  assert.equal(analytics.watchHours, null);
  assert.equal(analytics.unavailable.watchHours, "refresh-error");
  assert.equal(analytics.unavailable.likes, "refresh-error");
  // ...and the working columns are not given a reason for being absent.
  assert.equal("views" in analytics.unavailable, false);
  assert.equal(analytics.warnings.length, 1);
});

test("a full read fills the new metrics end to end", async () => {
  const analytics = await fetchChannelShortsAnalytics(
    {
      channelId: "UCUzrKvQc2Yud2WGJcFfl00g",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      window: { startDate: "2026-07-03", endDate: "2026-07-30" },
      ladderWindow: { startDate: "2025-08-01", endDate: "2026-07-30" },
    },
    stubFetch([
      { status: 200, payload: { access_token: "access-token" } },
      { status: 200, payload: totalsPayload },
      { status: 200, payload: dailyPayload },
      { status: 200, payload: engagementPayload },
      { status: 200, payload: ladderPayload },
    ]),
  );

  assert.equal(analytics.views, 4_000);
  assert.equal(analytics.estimatedMinutesWatched, 1_200);
  assert.equal(analytics.watchHours, 20);
  assert.equal(analytics.subscribersGained, 8);
  assert.equal(analytics.subscribersNet, 7);
  assert.equal(analytics.likes, 65);
  assert.equal(analytics.watchHoursLadder.watchHours, 750);
  assert.equal(analytics.rowsReturned.totals, 3);
  assert.equal(analytics.rowsReturned.shortsTotals, 1);
  assert.equal(analytics.rowsReturned.engagement, 3);
  assert.equal(analytics.warnings.length, 0);
  assert.deepEqual(
    analytics.daily.map((entry) => [entry.date, entry.views, entry.watchHours]),
    [
      ["2026-07-27", 1_500, 5],
      ["2026-07-28", 2_500, 15],
    ],
  );
});

test("an optional report failing does not fail the channel", async () => {
  const analytics = await fetchChannelShortsAnalytics(
    {
      channelId: "UCUzrKvQc2Yud2WGJcFfl00g",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      window: { startDate: "2026-07-03", endDate: "2026-07-30" },
      ladderWindow: { startDate: "2025-08-01", endDate: "2026-07-30" },
    },
    stubFetch([
      { status: 200, payload: { access_token: "access-token" } },
      { status: 200, payload: totalsPayload },
      { status: 200, payload: dailyPayload },
      {
        status: 400,
        statusText: "Bad Request",
        payload: {
          error: { message: "Unknown metric estimatedMinutesWatched" },
        },
      },
      {
        status: 400,
        statusText: "Bad Request",
        payload: {
          error: { message: "Unknown metric estimatedMinutesWatched" },
        },
      },
    ]),
  );

  assert.equal(analytics.views, 4_000);
  assert.equal(analytics.subscribersGained, 8);
  assert.equal(analytics.watchHours, null);
  assert.equal(analytics.watchHoursLadder.watchHours, null);
  assert.equal(analytics.rowsReturned.engagement, null);
  assert.equal(analytics.warnings.length, 2);
  // The metric list is what a reader needs to fix a rejection; the token is
  // not, and must not appear.
  assert.match(analytics.warnings[0], /estimatedMinutesWatched/);
  assert.equal(analytics.warnings.join(" ").includes("refresh-token"), false);
  assert.equal(analytics.warnings.join(" ").includes("client-secret"), false);
});

test("the file reports how far YouTube has actually processed", () => {
  const document = buildAuthorizedAnalytics({
    capturedAt: "2026-07-31T03:15:26.186Z",
    window: { startDate: "2026-07-03", endDate: "2026-07-30" },
    ladderWindow: { startDate: "2025-08-01", endDate: "2026-07-30" },
    channels: [
      { slug: "kids-history", analytics: { dataThroughDate: "2026-07-28" } },
      { slug: "axolotl-drama", analytics: { dataThroughDate: "2026-07-27" } },
      { slug: "fixed-fights", analytics: { dataThroughDate: null } },
    ],
  });

  // endDate is what was asked for; dataThroughDate is what arrived. The gap is
  // YouTube's processing lag, not an error, and the site says which is which.
  assert.equal(document.endDate, "2026-07-30");
  assert.equal(document.dataThroughDate, "2026-07-28");
  assert.equal(document.goal.watchHours, watchHoursGoal);
  assert.equal(document.goal.windowDays, 365);
  assert.match(document.reasons.lagging, /through 2026-07-28/);
  assert.match(document.reasons["studio-only"], /always show a dash/);
  assert.equal(document.restricted, true);

  // With nothing processed anywhere the sentence must not read "through null".
  assert.match(analyticsReasons(null).lagging, /No day in this window/);
});
