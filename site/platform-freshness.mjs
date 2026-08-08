const platformDefinitions = Object.freeze([
  {
    platform: "youtube",
    label: "YouTube",
    shortLabel: "YT",
    configured: (channel) =>
      Boolean(channel.youtubeChannelId || channel.youtubeHandle),
    matchesError: (message) => /YouTube:/i.test(message),
    matchesSkip: (message) => /YouTube API key$/i.test(message),
  },
  {
    platform: "tiktok",
    label: "TikTok",
    shortLabel: "TT",
    configured: (channel) => Boolean(channel.tiktokUsername),
    matchesError: (message) => /TikTok(?: \([^)]+\))?:/i.test(message),
    matchesSkip: (message) => /TikTok access$/i.test(message),
  },
  {
    platform: "instagram",
    label: "Instagram",
    shortLabel: "IG",
    configured: (channel) =>
      Boolean(channel.instagramUsername || channel.instagram),
    matchesError: (message) => /Instagram:/i.test(message),
    matchesSkip: (message) => /Instagram feed$/i.test(message),
  },
]);

export function summarizePlatformFreshness(data, options = {}) {
  const channels = Array.isArray(data?.channels) ? data.channels : [];
  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const errors = Array.isArray(data?.refresh?.errors)
    ? data.refresh.errors.map(String)
    : [];
  const skipped = Array.isArray(data?.refresh?.skipped)
    ? data.refresh.skipped.map(String)
    : [];
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const staleAfterMinutes = Number.isFinite(options.staleAfterMinutes)
    ? Math.max(1, options.staleAfterMinutes)
    : 45;
  const staleBefore = now - staleAfterMinutes * 60 * 1000;

  const platforms = platformDefinitions
    .map((definition) => {
      const configuredChannels = channels.filter(definition.configured);
      const configuredIds = new Set(
        configuredChannels.map((channel) => String(channel.id)),
      );
      const latestByChannel = new Map();

      for (const snapshot of snapshots) {
        if (
          snapshot?.platform !== definition.platform ||
          !configuredIds.has(String(snapshot.channelId))
        ) {
          continue;
        }
        const capturedAt = Date.parse(snapshot.capturedAt);
        if (!Number.isFinite(capturedAt)) continue;
        const key = String(snapshot.channelId);
        const current = latestByChannel.get(key);
        if (current == null || capturedAt > current) {
          latestByChannel.set(key, capturedAt);
        }
      }

      const platformErrors = errors.filter(definition.matchesError);
      const platformSkips = skipped.filter(
        (message) =>
          definition.matchesSkip(message) &&
          configuredChannels.some((channel) => {
            const displayName = String(channel.displayName ?? "").trim();
            if (!displayName || !message.startsWith(displayName)) return false;
            // Refresh messages use a middle-dot separator. Looking for the dot
            // also tolerates older mojibake variants such as "Â·".
            return message.slice(displayName.length).includes("·");
          }),
      );
      const hasEverySnapshot =
        configuredChannels.length > 0 &&
        latestByChannel.size === configuredChannels.length;
      const completeThrough = hasEverySnapshot
        ? new Date(Math.min(...latestByChannel.values())).toISOString()
        : null;
      const completeThroughTime = completeThrough
        ? Date.parse(completeThrough)
        : null;
      const status = platformErrors.some((message) => /quota/i.test(message))
        ? "quota"
        : platformErrors.length > 0
          ? "error"
          : platformSkips.length > 0
            ? "paused"
            : !hasEverySnapshot
              ? "waiting"
              : completeThroughTime < staleBefore
                ? "stale"
                : "ok";

      return {
        platform: definition.platform,
        label: definition.label,
        shortLabel: definition.shortLabel,
        configuredCount: configuredChannels.length,
        reportedCount: latestByChannel.size,
        completeThrough,
        status,
        errorCount: platformErrors.length,
        skippedCount: platformSkips.length,
      };
    })
    .filter((platform) => platform.configuredCount > 0);

  const issues = platforms.filter((platform) => platform.status !== "ok");
  const matchedErrorCount = platforms.reduce(
    (total, platform) => total + platform.errorCount,
    0,
  );
  const completeThrough =
    platforms.length > 0 &&
    issues.length === 0 &&
    platforms.every((platform) => platform.completeThrough)
      ? new Date(
          Math.min(
            ...platforms.map((platform) =>
              Date.parse(platform.completeThrough),
            ),
          ),
        ).toISOString()
      : null;

  return {
    platforms,
    issues,
    completeThrough,
    errorCount: errors.length,
    unmatchedErrorCount: Math.max(0, errors.length - matchedErrorCount),
  };
}
