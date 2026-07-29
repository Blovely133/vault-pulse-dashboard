import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInstagramFeed } from "./instagram-data.mjs";

const channel = {
  id: 3,
  displayName: "Kids History",
  instagramUsername: "sylvasblessing",
};

test("normalizes the Instagram feed for the history channel", () => {
  const normalized = normalizeInstagramFeed(
    channel,
    {
      generatedAt: "2026-07-29T12:00:00Z",
      stale: false,
      account: {
        connected: true,
        username: "sylvasblessing",
        profileUrl: "https://www.instagram.com/sylvasblessing/",
      },
      totals: {
        reels: 2,
        views: 244,
        reach: 230,
        likes: 1,
        comments: 0,
        saves: 1,
        shares: 1,
        totalInteractions: 3,
        averageWatchTimeMs: 7868,
        totalWatchTimeMs: 1919705,
        engagementRate: 1.304,
        viewToReachRatio: 1.061,
      },
      reels: [
        {
          id: "18609846856023289",
          title: "Titanic",
          url: "https://www.instagram.com/reel/example/",
          publishedAt: "2026-07-28T22:15:56+0000",
          views: 111,
          reach: 100,
          likes: 0,
          comments: 0,
          saves: 0,
          shares: 0,
          totalInteractions: 0,
          averageWatchTimeMs: 12459,
          totalWatchTimeMs: 1245926,
          engagementRate: 0,
          viewToReachRatio: 1.11,
        },
      ],
    },
    "2026-07-29T12:00:01Z",
  );

  assert.equal(normalized.metric.views, 244);
  assert.equal(normalized.metric.connectionLabel, "Connected");
  assert.equal(normalized.videos[0].platform, "instagram");
  assert.equal(normalized.videos[0].channelId, 3);
  assert.equal(normalized.snapshot.reach, 230);
  assert.equal(normalized.feed.account.username, "sylvasblessing");
});

test("rejects a feed for a different Instagram account", () => {
  assert.throws(
    () =>
      normalizeInstagramFeed(
        channel,
        {
          account: {
            connected: true,
            username: "somebody-else",
          },
        },
        "2026-07-29T12:00:01Z",
      ),
    /expected @sylvasblessing/,
  );
});
