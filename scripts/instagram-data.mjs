function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function integer(value) {
  return Math.round(numeric(value));
}

export function normalizeInstagramFeed(channel, payload, capturedAt) {
  const account = payload?.account ?? {};
  const expectedUsername = String(channel.instagramUsername ?? "")
    .replace(/^@/, "")
    .toLowerCase();
  const returnedUsername = String(account.username ?? "")
    .replace(/^@/, "")
    .toLowerCase();
  if (!account.connected || !returnedUsername) {
    throw new Error("Instagram analytics feed is not connected");
  }
  if (expectedUsername && returnedUsername !== expectedUsername) {
    throw new Error(
      `Instagram feed belongs to @${returnedUsername}, expected @${expectedUsername}`,
    );
  }

  const sourceReels = Array.isArray(payload.reels) ? payload.reels : [];
  const videos = sourceReels.map((reel) => ({
    id: `instagram:${reel.id}`,
    channelId: channel.id,
    channelName: channel.displayName,
    platform: "instagram",
    title: reel.title || "Untitled Instagram Reel",
    url: reel.url || account.profileUrl,
    publishedAt: reel.publishedAt || capturedAt,
    views: integer(reel.views),
    reach: integer(reel.reach),
    likes: integer(reel.likes),
    comments: integer(reel.comments),
    saves: integer(reel.saves),
    shares: integer(reel.shares),
    totalInteractions: integer(reel.totalInteractions),
    averageWatchTimeMs: integer(reel.averageWatchTimeMs),
    totalWatchTimeMs: integer(reel.totalWatchTimeMs),
    engagementRate: numeric(reel.engagementRate),
    viewToReachRatio: numeric(reel.viewToReachRatio),
  }));
  const totals = payload.totals ?? {};
  const metric = {
    connected: true,
    connectionLabel: payload.stale ? "Cached snapshot" : "Connected",
    views: integer(totals.views),
    audience: null,
    videos: integer(totals.reels ?? videos.length),
    likes: integer(totals.likes),
    reach: integer(totals.reach),
    comments: integer(totals.comments),
    saves: integer(totals.saves),
    shares: integer(totals.shares),
    totalInteractions: integer(totals.totalInteractions),
    averageWatchTimeMs: integer(totals.averageWatchTimeMs),
    totalWatchTimeMs: integer(totals.totalWatchTimeMs),
    engagementRate: numeric(totals.engagementRate),
    viewToReachRatio: numeric(totals.viewToReachRatio),
    profileUrl:
      account.profileUrl ||
      `https://www.instagram.com/${returnedUsername}/`,
    generatedAt: payload.generatedAt || capturedAt,
  };

  return {
    metric,
    videos,
    feed: {
      ...payload,
      channelId: channel.id,
      channelName: channel.displayName,
      account: {
        ...account,
        username: returnedUsername,
        profileUrl: metric.profileUrl,
      },
      totals: {
        ...totals,
        views: metric.views,
        reach: metric.reach,
        likes: metric.likes,
        comments: metric.comments,
        saves: metric.saves,
        shares: metric.shares,
        totalInteractions: metric.totalInteractions,
        averageWatchTimeMs: metric.averageWatchTimeMs,
        totalWatchTimeMs: metric.totalWatchTimeMs,
        engagementRate: metric.engagementRate,
        viewToReachRatio: metric.viewToReachRatio,
        reels: metric.videos,
      },
      reels: videos.map((video) => ({
        id: video.id.replace(/^instagram:/, ""),
        title: video.title,
        url: video.url,
        publishedAt: video.publishedAt,
        views: video.views,
        reach: video.reach,
        likes: video.likes,
        comments: video.comments,
        saves: video.saves,
        shares: video.shares,
        totalInteractions: video.totalInteractions,
        averageWatchTimeMs: video.averageWatchTimeMs,
        totalWatchTimeMs: video.totalWatchTimeMs,
        engagementRate: video.engagementRate,
        viewToReachRatio: video.viewToReachRatio,
      })),
    },
    snapshot: {
      channelId: channel.id,
      platform: "instagram",
      capturedAt,
      views: metric.views,
      audience: null,
      videos: metric.videos,
      likes: metric.likes,
      reach: metric.reach,
      engagementRate: metric.engagementRate,
    },
  };
}
