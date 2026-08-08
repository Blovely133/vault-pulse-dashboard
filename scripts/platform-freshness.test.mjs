import assert from "node:assert/strict";
import test from "node:test";
import { summarizePlatformFreshness } from "../site/platform-freshness.mjs";

const channels = [
  {
    id: 1,
    displayName: "Channel one",
    youtubeChannelId: "UC-one",
    tiktokUsername: "one",
    instagramUsername: "one",
  },
  {
    id: 2,
    displayName: "Channel two",
    youtubeChannelId: "UC-two",
    tiktokUsername: "two",
    instagramUsername: "two",
  },
];

function snapshot(channelId, platform, capturedAt) {
  return { channelId, platform, capturedAt };
}

test("a current global timestamp cannot hide stale YouTube quota data", () => {
  const summary = summarizePlatformFreshness({
    updatedAt: "2026-08-08T02:24:00.000Z",
    channels,
    snapshots: [
      snapshot(1, "youtube", "2026-08-07T17:20:00.000Z"),
      snapshot(2, "youtube", "2026-08-07T17:04:00.000Z"),
      snapshot(1, "tiktok", "2026-08-08T02:23:00.000Z"),
      snapshot(2, "tiktok", "2026-08-08T02:24:00.000Z"),
      snapshot(1, "instagram", "2026-08-08T02:24:00.000Z"),
      snapshot(2, "instagram", "2026-08-08T02:24:00.000Z"),
    ],
    refresh: {
      errors: ["Channel one · YouTube: quota exceeded"],
    },
  });

  const youtube = summary.platforms.find(
    (platform) => platform.platform === "youtube",
  );
  assert.equal(youtube.status, "quota");
  assert.equal(youtube.completeThrough, "2026-08-07T17:04:00.000Z");
  assert.equal(summary.completeThrough, null);
});

test("platform completeness uses the oldest latest channel snapshot", () => {
  const summary = summarizePlatformFreshness({
    channels,
    snapshots: [
      snapshot(1, "youtube", "2026-08-08T02:24:00.000Z"),
      snapshot(2, "youtube", "2026-08-08T01:50:00.000Z"),
      snapshot(2, "youtube", "2026-08-08T01:00:00.000Z"),
    ],
    refresh: { errors: [] },
  });

  const youtube = summary.platforms.find(
    (platform) => platform.platform === "youtube",
  );
  assert.equal(youtube.completeThrough, "2026-08-08T01:50:00.000Z");
});

test("multiple platform failures remain visible", () => {
  const summary = summarizePlatformFreshness({
    channels,
    snapshots: [],
    refresh: {
      errors: [
        "Channel one · YouTube: quota exceeded",
        "Channel two · TikTok (direct): Server Internal Error",
      ],
    },
  });

  assert.deepEqual(
    summary.issues.map(({ platform, status }) => [platform, status]),
    [
      ["youtube", "quota"],
      ["tiktok", "error"],
      ["instagram", "waiting"],
    ],
  );
});

test("YouTube Analytics errors do not mark public YouTube snapshots failed", () => {
  const now = Date.parse("2026-08-08T02:30:00.000Z");
  const summary = summarizePlatformFreshness(
    {
      channels: [
        {
          id: 1,
          youtubeChannelId: "UC-one",
        },
      ],
      snapshots: [
        snapshot(1, "youtube", "2026-08-08T02:24:00.000Z"),
      ],
      refresh: {
        errors: ["Channel one · YouTube Analytics: report failed"],
      },
    },
    { now },
  );

  assert.equal(summary.platforms[0].status, "ok");
  assert.equal(summary.unmatchedErrorCount, 1);
});

test("skipped platform reads and old snapshots are never current", () => {
  const now = Date.parse("2026-08-08T02:30:00.000Z");
  const paused = summarizePlatformFreshness(
    {
      channels: [
        {
          id: 1,
          displayName: "Channel one",
          youtubeChannelId: "UC-one",
        },
      ],
      snapshots: [
        snapshot(1, "youtube", "2026-08-08T02:24:00.000Z"),
      ],
      refresh: { errors: [], skipped: ["Channel one · YouTube API key"] },
    },
    { now },
  );
  const stale = summarizePlatformFreshness(
    {
      channels: [
        {
          id: 1,
          displayName: "Channel one",
          youtubeChannelId: "UC-one",
        },
      ],
      snapshots: [
        snapshot(1, "youtube", "2026-08-08T01:00:00.000Z"),
      ],
      refresh: { errors: [], skipped: [] },
    },
    { now, staleAfterMinutes: 45 },
  );

  assert.equal(paused.platforms[0].status, "paused");
  assert.equal(stale.platforms[0].status, "stale");
});

test("skips for unconfigured channels do not pause configured channels", () => {
  const now = Date.parse("2026-08-08T02:30:00.000Z");
  const summary = summarizePlatformFreshness(
    {
      channels: [
        {
          id: 1,
          displayName: "Configured",
          youtubeChannelId: "UC-one",
          tiktokUsername: "configured",
        },
        { id: 2, displayName: "Not configured" },
      ],
      snapshots: [
        snapshot(1, "youtube", "2026-08-08T02:24:00.000Z"),
        snapshot(1, "tiktok", "2026-08-08T02:24:00.000Z"),
      ],
      refresh: {
        errors: [],
        skipped: [
          "Not configured · YouTube channel ID",
          "Not configured · TikTok username",
        ],
      },
    },
    { now },
  );

  assert.deepEqual(
    summary.platforms.map(({ platform, status }) => [platform, status]),
    [
      ["youtube", "ok"],
      ["tiktok", "ok"],
    ],
  );
});

test("missing snapshots are waiting and never borrow updatedAt", () => {
  const summary = summarizePlatformFreshness({
    updatedAt: "2026-08-08T02:24:00.000Z",
    channels: [channels[0]],
    snapshots: [],
    refresh: { errors: [] },
  });

  for (const platform of summary.platforms) {
    assert.equal(platform.status, "waiting");
    assert.equal(platform.completeThrough, null);
  }
  assert.equal(summary.completeThrough, null);
});

test("an unconfigured dashboard has no synthetic completion date", () => {
  const summary = summarizePlatformFreshness({
    updatedAt: "2026-08-08T02:24:00.000Z",
    channels: [],
    snapshots: [],
    refresh: { errors: [] },
  });

  assert.deepEqual(summary.platforms, []);
  assert.equal(summary.completeThrough, null);
});
