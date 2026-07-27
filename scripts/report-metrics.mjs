export const reportMetricDefaults = Object.freeze({
  cadenceAdherence: null,
  swipeAwayRate: null,
  completionRate: null,
  conversionPerThousand: null,
  velocityRate: null,
  returningViewers: null,
});

export function ensureReportMetricFields(channel) {
  channel.reportMetrics = {
    ...reportMetricDefaults,
    ...(channel.reportMetrics ?? {}),
  };

  return channel.reportMetrics;
}
