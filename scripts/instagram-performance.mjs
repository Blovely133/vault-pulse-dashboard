function numeric(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function perThousand(value, denominator) {
  const numerator = numeric(value);
  const base = numeric(denominator);
  return numerator != null && base > 0 ? (numerator / base) * 1000 : null;
}

export function summarizeInstagramPerformance(metric = {}) {
  const views = numeric(metric.views);
  const reach = numeric(metric.reach);
  const reels = numeric(metric.videos);
  const totalInteractions = numeric(metric.totalInteractions);

  return {
    views,
    reach,
    reels,
    totalInteractions,
    averageWatchTimeMs: numeric(metric.averageWatchTimeMs),
    viewsPerReachedAccount:
      views != null && reach > 0 ? views / reach : null,
    engagementPerThousandReach: perThousand(totalInteractions, reach),
    savesPerThousandReach: perThousand(metric.saves, reach),
    sharesPerThousandReach: perThousand(metric.shares, reach),
    interactionsPerReel:
      totalInteractions != null && reels > 0
        ? totalInteractions / reels
        : null,
  };
}
