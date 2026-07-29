import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInstagramPerformance } from "./instagram-performance.mjs";

test("summarizes Instagram attention and interaction quality", () => {
  const performance = summarizeInstagramPerformance({
    views: 1500,
    reach: 1000,
    videos: 4,
    totalInteractions: 120,
    saves: 30,
    shares: 20,
    averageWatchTimeMs: 8750,
  });

  assert.equal(performance.viewsPerReachedAccount, 1.5);
  assert.equal(performance.engagementPerThousandReach, 120);
  assert.equal(performance.savesPerThousandReach, 30);
  assert.equal(performance.sharesPerThousandReach, 20);
  assert.equal(performance.interactionsPerReel, 30);
  assert.equal(performance.averageWatchTimeMs, 8750);
});

test("keeps rate metrics unavailable until Instagram reports reach", () => {
  const performance = summarizeInstagramPerformance({
    views: 0,
    reach: 0,
    videos: 1,
    totalInteractions: 0,
    saves: 0,
    shares: 0,
    averageWatchTimeMs: 0,
  });

  assert.equal(performance.views, 0);
  assert.equal(performance.viewsPerReachedAccount, null);
  assert.equal(performance.engagementPerThousandReach, null);
  assert.equal(performance.savesPerThousandReach, null);
  assert.equal(performance.sharesPerThousandReach, null);
  assert.equal(performance.interactionsPerReel, 0);
});

test("preserves missing values instead of inventing zero performance", () => {
  const performance = summarizeInstagramPerformance({});

  assert.equal(performance.views, null);
  assert.equal(performance.averageWatchTimeMs, null);
  assert.equal(performance.interactionsPerReel, null);
});
