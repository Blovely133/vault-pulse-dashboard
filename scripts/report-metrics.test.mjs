import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureReportMetricFields,
  reportMetricDefaults,
} from "./report-metrics.mjs";

test("report metric fields are added without overwriting saved values", () => {
  const channel = {
    reportMetrics: {
      swipeAwayRate: 41.5,
      returningViewers: 120,
    },
  };

  const metrics = ensureReportMetricFields(channel);

  assert.deepEqual(metrics, {
    ...reportMetricDefaults,
    swipeAwayRate: 41.5,
    returningViewers: 120,
  });
  assert.equal(channel.reportMetrics, metrics);
});

test("report metric fields default to null for a new channel", () => {
  const channel = {};

  assert.deepEqual(ensureReportMetricFields(channel), reportMetricDefaults);
});
