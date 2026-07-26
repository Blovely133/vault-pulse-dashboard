import assert from "node:assert/strict";
import test from "node:test";
import { isSnapshotStale } from "./check-freshness.mjs";

const now = Date.parse("2026-07-26T05:00:00.000Z");

test("a recent snapshot is fresh", () => {
  assert.equal(
    isSnapshotStale("2026-07-26T04:50:00.000Z", 18, now),
    false,
  );
});

test("an old snapshot is stale", () => {
  assert.equal(
    isSnapshotStale("2026-07-26T04:40:00.000Z", 18, now),
    true,
  );
});

test("a missing or invalid timestamp is stale", () => {
  assert.equal(isSnapshotStale("", 18, now), true);
  assert.equal(isSnapshotStale("not-a-date", 18, now), true);
});
