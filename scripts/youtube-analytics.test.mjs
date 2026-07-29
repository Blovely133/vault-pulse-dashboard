import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsWindow,
  authorizedAnalyticsDefaults,
  buildChannelAnalytics,
  exchangeRefreshToken,
  fetchChannelShortsAnalytics,
  refreshTokenEnvForChannel,
  summarizeShortsDaily,
  summarizeShortsTotals,
  unavailableChannelAnalytics,
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
  assert.equal(refreshTokenEnvForChannel("UCL0PybSo7k08IoLqtn4MIbg"), null);
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
