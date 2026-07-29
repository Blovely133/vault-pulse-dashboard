import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureReportMetricFields } from "./report-metrics.mjs";
import { normalizeInstagramFeed } from "./instagram-data.mjs";
import { summarizeInstagramPerformance } from "./instagram-performance.mjs";
import { mergeVideos } from "./video-merge.mjs";
import {
  analyticsWindow,
  buildAuthorizedAnalytics,
  fetchChannelShortsAnalytics,
  refreshTokenEnvForChannel,
  unavailableChannelAnalytics,
} from "./youtube-analytics.mjs";
import {
  fetchChannelTikTok,
  refreshTokenEnvForSlug,
  refreshTokenExpiresAt,
} from "./tiktok-direct.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataPath = path.join(repositoryRoot, "site", "data", "dashboard.json");
const authorizedDataPath = path.join(
  repositoryRoot,
  "site",
  "data",
  "authorized-analytics.json",
);
const data = JSON.parse(await readFile(dataPath, "utf8"));
const now = new Date();
const capturedAt = now.toISOString();
const authorizedWindow = analyticsWindow(now);
const refresh = { ok: [], skipped: [], warnings: [], errors: [] };
const freshVideos = [];
const freshSnapshots = [];
const authorizedChannels = [];

for (const channel of data.channels) {
  ensureReportMetricFields(channel);
  await refreshYouTube(channel);
  await refreshAuthorizedAnalytics(channel);
  await refreshTikTok(channel);
  await refreshInstagram(channel);
}

if (freshVideos.length) {
  data.videos = mergeVideos(data.videos ?? [], freshVideos);
}

if (freshSnapshots.length) {
  const cutoff = now.getTime() - 31 * 24 * 60 * 60 * 1000;
  data.snapshots = [...(data.snapshots ?? []), ...freshSnapshots].filter(
    (snapshot) => new Date(snapshot.capturedAt).getTime() >= cutoff,
  );
  data.updatedAt = capturedAt;
  data.generatedAt = capturedAt;
}

recalculateDashboard(data, now);
data.refresh = refresh;

await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

// OAuth-sourced metrics are restricted to the authorising user by YouTube
// Developer Policy III.E.3.b, so they live in their own file instead of
// dashboard.json and the planned sign-in gate becomes a path-gating change.
// This file is rewritten from the current run every time and is never read
// back in, unlike dashboard.json, so a channel that loses its token drops
// back to null instead of keeping a stale value that still looks fresh.
await writeFile(
  authorizedDataPath,
  `${JSON.stringify(
    buildAuthorizedAnalytics({
      capturedAt,
      window: authorizedWindow,
      channels: authorizedChannels,
    }),
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `Vault Pulse refresh: ${refresh.ok.length} updated, ${refresh.skipped.length} skipped, ${refresh.warnings.length} warnings, ${refresh.errors.length} errors.`,
);

async function refreshYouTube(channel) {
  if (!channel.youtubeChannelId && !channel.youtubeHandle) {
    channel.youtube.connected = false;
    channel.youtube.connectionLabel = "Channel ID needed";
    refresh.skipped.push(`${channel.displayName} · YouTube channel ID`);
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    channel.youtube.connected = false;
    channel.youtube.connectionLabel = "API key needed";
    refresh.skipped.push(`${channel.displayName} · YouTube API key`);
    return;
  }

  try {
    const channelUrl = new URL(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    channelUrl.searchParams.set(
      "part",
      "snippet,statistics,contentDetails",
    );
    channelUrl.searchParams.set("key", apiKey);
    if (channel.youtubeChannelId) {
      channelUrl.searchParams.set("id", channel.youtubeChannelId);
    } else {
      channelUrl.searchParams.set(
        "forHandle",
        channel.youtubeHandle.replace(/^@/, ""),
      );
    }

    const channelPayload = await fetchJson(channelUrl);
    const source = channelPayload.items?.[0];
    if (!source) throw new Error("channel was not found");

    channel.youtubeChannelId = source.id;
    const uploadsPlaylist =
      source.contentDetails?.relatedPlaylists?.uploads ?? "";
    const statistics = source.statistics ?? {};
    const videos = uploadsPlaylist
      ? await fetchYouTubeVideos(channel, uploadsPlaylist, apiKey)
      : [];

    const recentViews = sum(videos, "views");
    const recentInteractions =
      sum(videos, "likes") + sum(videos, "comments") + sum(videos, "shares");
    const metric = {
      connected: true,
      connectionLabel: "Connected",
      views: Math.max(integer(statistics.viewCount), recentViews),
      audience: integer(statistics.subscriberCount),
      videos: integer(statistics.videoCount),
      likes: sum(videos, "likes"),
      engagementRate:
        recentViews > 0 ? (recentInteractions / recentViews) * 100 : 0,
    };

    channel.youtube = metric;
    freshVideos.push(...videos);
    freshSnapshots.push(snapshot(channel.id, "youtube", metric));
    refresh.ok.push(`${channel.displayName} · YouTube`);
  } catch (error) {
    channel.youtube.connected = false;
    channel.youtube.connectionLabel = "Refresh error";
    refresh.errors.push(
      `${channel.displayName} · YouTube: ${errorMessage(error)}`,
    );
  }
}

async function fetchYouTubeVideos(channel, uploadsPlaylist, apiKey) {
  const playlistUrl = new URL(
    "https://www.googleapis.com/youtube/v3/playlistItems",
  );
  playlistUrl.searchParams.set("part", "contentDetails");
  playlistUrl.searchParams.set("playlistId", uploadsPlaylist);
  playlistUrl.searchParams.set("maxResults", "30");
  playlistUrl.searchParams.set("key", apiKey);
  const playlistPayload = await fetchJson(
    playlistUrl,
    {},
    { allowNotFound: true },
  );
  const videoIds = (playlistPayload.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter(Boolean);
  if (!videoIds.length) return [];

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set(
    "part",
    "snippet,statistics,contentDetails",
  );
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);
  const videosPayload = await fetchJson(videosUrl);

  return (videosPayload.items ?? []).map((video) => {
    const views = integer(video.statistics?.viewCount);
    const likes = integer(video.statistics?.likeCount);
    const comments = integer(video.statistics?.commentCount);
    return {
      id: `youtube:${video.id}`,
      channelId: channel.id,
      channelName: channel.displayName,
      platform: "youtube",
      title: video.snippet?.title || "Untitled YouTube video",
      url: `https://www.youtube.com/watch?v=${video.id}`,
      publishedAt: video.snippet?.publishedAt || capturedAt,
      views,
      likes,
      comments,
      shares: 0,
      durationSeconds: parseIsoDuration(video.contentDetails?.duration ?? ""),
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
    };
  });
}

async function refreshAuthorizedAnalytics(channel) {
  const entry = {
    channelId: channel.id,
    slug: channel.slug,
    displayName: channel.displayName,
    youtubeChannelId: channel.youtubeChannelId ?? "",
  };
  const tokenEnv = refreshTokenEnvForChannel(channel.youtubeChannelId);
  const refreshToken = tokenEnv ? process.env[tokenEnv]?.trim() : "";
  const clientId = process.env.YT_CLIENT_ID?.trim();
  const clientSecret = process.env.YT_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    authorizedChannels.push({
      ...entry,
      analytics: unavailableChannelAnalytics("Authorization needed"),
    });
    refresh.skipped.push(`${channel.displayName} · YouTube Analytics access`);
    return;
  }

  try {
    authorizedChannels.push({
      ...entry,
      analytics: await fetchChannelShortsAnalytics({
        channelId: channel.youtubeChannelId,
        clientId,
        clientSecret,
        refreshToken,
        window: authorizedWindow,
      }),
    });
    refresh.ok.push(`${channel.displayName} · YouTube Analytics`);
  } catch (error) {
    authorizedChannels.push({
      ...entry,
      analytics: unavailableChannelAnalytics("Refresh error"),
    });
    refresh.errors.push(
      `${channel.displayName} · YouTube Analytics: ${errorMessage(error)}`,
    );
  }
}

// Picks the TikTok reader for this channel and records which one it was.
// `tiktokSource` is the whole point of the direct path: it is how a reader can
// see, per channel, whether the Render proxy still served this run.
async function refreshTikTok(channel) {
  if (!channel.tiktokUsername) {
    channel.tiktokSource = null;
    channel.tiktok.connected = false;
    channel.tiktok.connectionLabel = "Username needed";
    refresh.skipped.push(`${channel.displayName} · TikTok username`);
    return;
  }

  const tokenEnv = refreshTokenEnvForSlug(channel.slug);
  const refreshToken = tokenEnv ? process.env[tokenEnv]?.trim() : "";
  const clientKey = process.env.TT_CLIENT_KEY?.trim();
  const clientSecret = process.env.TT_CLIENT_SECRET?.trim();
  if (clientKey && clientSecret && refreshToken) {
    await refreshTikTokDirect(channel, {
      clientKey,
      clientSecret,
      refreshToken,
    });
    return;
  }

  await refreshTikTokProxy(channel);
}

// TikTok does not rotate refresh tokens -- the refresh call returns the same
// token it was sent -- so running this every 15 minutes off a static Actions
// secret does not consume anything. See scripts/tiktok-direct.mjs for the probe
// that established that.
async function refreshTikTokDirect(channel, credentials) {
  channel.tiktokSource = "direct";

  try {
    const result = await fetchChannelTikTok({
      channelId: channel.id,
      channelName: channel.displayName,
      username: channel.tiktokUsername,
      capturedAt,
      ...credentials,
    });

    // The API is authoritative on the handle, so a renamed account stops
    // pointing the profile link at a name that no longer exists.
    if (result.user.username) channel.tiktokUsername = result.user.username;
    channel.tiktok = result.metric;
    // refresh_expires_in counts down from the original grant and refreshing
    // does not extend it, so this date is a real deadline for a manual
    // re-authorization rather than a rolling window.
    channel.tiktokAuthExpiresAt = refreshTokenExpiresAt(
      result.refreshExpiresInSeconds,
      now,
    );
    if (result.expiryWarning) {
      refresh.warnings.push(
        `${channel.displayName} · TikTok: ${result.expiryWarning}`,
      );
    }
    freshVideos.push(...result.videos);
    freshSnapshots.push(snapshot(channel.id, "tiktok", result.metric));
    refresh.ok.push(`${channel.displayName} · TikTok (direct)`);
  } catch (error) {
    // Deliberately no automatic fall back to the proxy. Silently covering for
    // a broken direct path would hide exactly the signal this change exists to
    // produce, and the channel would look healthy while its tokens rotted.
    channel.tiktok.connected = false;
    channel.tiktok.connectionLabel = "Refresh error";
    refresh.errors.push(
      `${channel.displayName} · TikTok (direct): ${errorMessage(error)}`,
    );
  }
}

// The pre-existing reader, kept until the direct path has been confirmed at
// parity on every channel. A silent regression would be worse than a slow
// migration.
async function refreshTikTokProxy(channel) {
  const vaultApiBase = process.env.VAULT_PULSE_TIKTOK_API_URL
    ?.trim()
    .replace(/\/+$/, "");
  const vaultDataToken = process.env.VAULT_PULSE_DATA_TOKEN?.trim();
  const legacyToken = process.env[channel.tiktokTokenEnv]?.trim();
  const usesProxy = Boolean(vaultApiBase && vaultDataToken);
  // The legacy branch calls TikTok itself, but off a bare stored access token
  // that nothing can renew, so it is not the same thing as the direct path.
  channel.tiktokSource = usesProxy
    ? "render-proxy"
    : legacyToken
      ? "legacy-access-token"
      : null;
  if (!usesProxy && !legacyToken) {
    channel.tiktok.connected = false;
    channel.tiktok.connectionLabel = "Access needed";
    refresh.skipped.push(`${channel.displayName} · TikTok access`);
    return;
  }

  try {
    let userPayload;
    let videoPayload;

    if (usesProxy) {
      const response = await fetch(
        `${vaultApiBase}/${encodeURIComponent(channel.slug)}`,
        {
          headers: { Authorization: `Bearer ${vaultDataToken}` },
        },
      );
      const payload = await response.json();
      if (response.status === 409) {
        channel.tiktok.connected = false;
        channel.tiktok.connectionLabel = "Access needed";
        refresh.skipped.push(`${channel.displayName} · TikTok access`);
        return;
      }
      if (!response.ok) {
        throw new Error(
          payload.error || `${response.status} ${response.statusText}`,
        );
      }
      userPayload = { data: { user: payload.user ?? {} } };
      videoPayload = { data: { videos: payload.videos ?? [] } };
    } else {
      const userUrl = new URL(
        "https://open.tiktokapis.com/v2/user/info/",
      );
      userUrl.searchParams.set(
        "fields",
        "open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count",
      );
      userPayload = await fetchJson(userUrl, {
        headers: { Authorization: `Bearer ${legacyToken}` },
      });
      validateTikTok(userPayload);

      const videoUrl = new URL(
        "https://open.tiktokapis.com/v2/video/list/",
      );
      videoUrl.searchParams.set(
        "fields",
        "id,title,video_description,share_url,create_time,duration,view_count,like_count,comment_count,share_count",
      );
      videoPayload = await fetchJson(videoUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${legacyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ max_count: 20 }),
      });
      validateTikTok(videoPayload);
    }

    const sourceVideos =
      videoPayload.data?.videos ?? videoPayload.data?.video_list ?? [];
    const videos = sourceVideos.map((video) => {
      const views = integer(video.view_count);
      const likes = integer(video.like_count);
      const comments = integer(video.comment_count);
      const shares = integer(video.share_count);
      return {
        id: `tiktok:${video.id}`,
        channelId: channel.id,
        channelName: channel.displayName,
        platform: "tiktok",
        title:
          video.title ||
          video.video_description ||
          "Untitled TikTok video",
        url:
          video.share_url ||
          `https://www.tiktok.com/@${channel.tiktokUsername}/video/${video.id}`,
        publishedAt: video.create_time
          ? new Date(video.create_time * 1000).toISOString()
          : capturedAt,
        views,
        likes,
        comments,
        shares,
        durationSeconds: integer(video.duration),
        engagementRate:
          views > 0 ? ((likes + comments + shares) / views) * 100 : 0,
      };
    });

    const user = userPayload.data?.user ?? {};
    const views = sum(videos, "views");
    const interactions =
      sum(videos, "likes") +
      sum(videos, "comments") +
      sum(videos, "shares");
    const metric = {
      connected: true,
      connectionLabel: "Connected",
      views,
      audience: integer(user.follower_count),
      videos: integer(user.video_count),
      likes: integer(user.likes_count),
      engagementRate: views > 0 ? (interactions / views) * 100 : 0,
      // Same key the direct reader sets, so both sources land in one shape.
      source: channel.tiktokSource,
    };

    channel.tiktok = metric;
    freshVideos.push(...videos);
    freshSnapshots.push(snapshot(channel.id, "tiktok", metric));
    refresh.ok.push(
      `${channel.displayName} · TikTok (${channel.tiktokSource})`,
    );
  } catch (error) {
    channel.tiktok.connected = false;
    channel.tiktok.connectionLabel = "Refresh error";
    refresh.errors.push(
      `${channel.displayName} · TikTok (${channel.tiktokSource}): ${errorMessage(error)}`,
    );
  }
}

async function refreshInstagram(channel) {
  if (!channel.instagramUsername) return;

  const analyticsUrl = (
    (channel.instagramFeedEnv
      ? process.env[channel.instagramFeedEnv]
      : undefined) ??
    process.env.VAULT_PULSE_INSTAGRAM_API_URL
  )?.trim();
  if (!analyticsUrl) {
    channel.instagram = {
      ...(channel.instagram ?? {}),
      connected: false,
      connectionLabel:
        channel.instagram?.views != null ? "Snapshot cached" : "Feed needed",
    };
    refresh.skipped.push(`${channel.displayName} Â· Instagram feed`);
    return;
  }

  try {
    const payload = await fetchJson(new URL(analyticsUrl));
    const normalized = normalizeInstagramFeed(channel, payload, capturedAt);
    channel.instagram = normalized.metric;
    channel.instagramPerformance = summarizeInstagramPerformance(
      normalized.metric,
    );
    data.instagramFeeds = upsertInstagramFeed(
      data.instagramFeeds,
      normalized.feed,
    );
    // Keep the original history feed key during the transition to multiple
    // Instagram accounts so older dashboard clients still render correctly.
    if (!data.instagram || channel.id === data.instagram.channelId) {
      data.instagram = normalized.feed;
    }
    freshVideos.push(...normalized.videos);
    freshSnapshots.push(normalized.snapshot);
    refresh.ok.push(`${channel.displayName} Â· Instagram`);
  } catch (error) {
    channel.instagram = {
      ...(channel.instagram ?? {}),
      connected: false,
      connectionLabel:
        channel.instagram?.views != null ? "Snapshot stale" : "Refresh error",
    };
    const staleFeed = data.instagramFeeds?.find(
      (feed) => feed.channelId === channel.id,
    );
    if (staleFeed) staleFeed.stale = true;
    if (data.instagram?.channelId === channel.id) data.instagram.stale = true;
    refresh.errors.push(
      `${channel.displayName} Â· Instagram: ${errorMessage(error)}`,
    );
  }
}

function upsertInstagramFeed(feeds, nextFeed) {
  const nextFeeds = Array.isArray(feeds) ? [...feeds] : [];
  const index = nextFeeds.findIndex(
    (feed) => feed.channelId === nextFeed.channelId,
  );
  if (index >= 0) nextFeeds[index] = nextFeed;
  else nextFeeds.push(nextFeed);
  return nextFeeds.sort((left, right) => left.channelId - right.channelId);
}

function recalculateDashboard(dashboard, referenceDate) {
  const platformMetrics = dashboard.channels.flatMap((channel) => {
    const metrics = [];
    if (channel.youtubeChannelId || channel.youtubeHandle) {
      metrics.push({ platform: "youtube", metric: channel.youtube });
    }
    if (channel.tiktokUsername) {
      metrics.push({ platform: "tiktok", metric: channel.tiktok });
    }
    if (channel.instagramUsername) {
      metrics.push({ platform: "instagram", metric: channel.instagram });
    }
    return metrics;
  });
  const metricsWithData = platformMetrics.filter(
    ({ metric }) => metric?.views != null,
  );
  const totalViews = metricsWithData.reduce(
    (total, { metric }) => total + integer(metric.views),
    0,
  );
  const totalAudience = metricsWithData.reduce(
    (total, { metric }) => total + integer(metric.audience),
    0,
  );
  const recentViews = sum(dashboard.videos ?? [], "views");
  const interactions =
    sum(dashboard.videos ?? [], "likes") +
    sum(dashboard.videos ?? [], "comments") +
    sum(dashboard.videos ?? [], "saves") +
    sum(dashboard.videos ?? [], "shares");
  const previousViews = viewsAtOrBefore(
    dashboard.snapshots ?? [],
    referenceDate.getTime() - 7 * 24 * 60 * 60 * 1000,
  );

  dashboard.hasLiveData = metricsWithData.length > 0;
  dashboard.totals = {
    views: metricsWithData.length ? totalViews : null,
    sevenDayViews:
      metricsWithData.length && previousViews != null
        ? Math.max(0, totalViews - previousViews)
        : null,
    audience: metricsWithData.length ? totalAudience : null,
    engagementRate:
      recentViews > 0 ? (interactions / recentViews) * 100 : null,
  };
  dashboard.platformTotals = {
    youtube: platformTotal(platformMetrics, "youtube"),
    tiktok: platformTotal(platformMetrics, "tiktok"),
    instagram: platformTotal(platformMetrics, "instagram"),
  };
  dashboard.trend = buildTrend(dashboard.snapshots ?? [], referenceDate);
  dashboard.connections = {
    youtubeApiKey: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
    // One-glance answer to "is the Render proxy still in the loop?".
    tiktokSources: Object.fromEntries(
      dashboard.channels.map((channel) => [
        channel.slug,
        channel.tiktokSource ?? null,
      ]),
    ),
    instagramFeed: platformMetrics.some(
      ({ platform, metric }) => platform === "instagram" && metric.connected,
    ),
    connectedSources: platformMetrics.filter(
      ({ metric }) => metric?.connected,
    ).length,
    totalSources: platformMetrics.length,
  };
}

function buildTrend(snapshots, referenceDate) {
  const points = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = new Date(referenceDate);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - offset);
    const date = day.toISOString().slice(0, 10);
    points.push({
      date,
      label: day.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      youtube: snapshotTotalForDay(snapshots, date, "youtube"),
      tiktok: snapshotTotalForDay(snapshots, date, "tiktok"),
    });
  }
  return points;
}

function snapshotTotalForDay(snapshots, date, platform) {
  const latestByChannel = new Map();
  for (const item of snapshots) {
    if (
      item.platform !== platform ||
      !item.capturedAt.startsWith(date)
    ) {
      continue;
    }
    const current = latestByChannel.get(item.channelId);
    if (!current || item.capturedAt > current.capturedAt) {
      latestByChannel.set(item.channelId, item);
    }
  }
  if (!latestByChannel.size) return null;
  return [...latestByChannel.values()].reduce(
    (total, item) => total + integer(item.views),
    0,
  );
}

function viewsAtOrBefore(snapshots, targetTime) {
  const latestBySource = new Map();
  for (const item of snapshots) {
    const capturedTime = new Date(item.capturedAt).getTime();
    if (!Number.isFinite(capturedTime) || capturedTime > targetTime) continue;
    const key = `${item.channelId}:${item.platform}`;
    const current = latestBySource.get(key);
    if (!current || item.capturedAt > current.capturedAt) {
      latestBySource.set(key, item);
    }
  }
  if (!latestBySource.size) return null;
  return [...latestBySource.values()].reduce(
    (total, item) => total + integer(item.views),
    0,
  );
}

function platformTotal(metrics, platform) {
  const values = metrics
    .filter((entry) => entry.platform === platform)
    .map((entry) => entry.metric?.views)
    .filter((value) => value != null);
  return values.length
    ? values.reduce((total, value) => total + integer(value), 0)
    : null;
}

function snapshot(channelId, platform, metric) {
  return {
    channelId,
    platform,
    capturedAt,
    views: metric.views,
    audience: metric.audience,
    videos: metric.videos,
    likes: metric.likes,
    engagementRate: metric.engagementRate,
  };
}

async function fetchJson(url, options = {}, { allowNotFound = false } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "Vault-Pulse-GitHub-Action",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    if (allowNotFound && response.status === 404) {
      return { items: [] };
    }
    const message =
      payload.error?.message ||
      payload.error_description ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

function validateTikTok(payload) {
  if (payload.error && payload.error.code && payload.error.code !== "ok") {
    throw new Error(payload.error.message || payload.error.code);
  }
}

function integer(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function sum(items, field) {
  return items.reduce((total, item) => total + integer(item[field]), 0);
}

function parseIsoDuration(value) {
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) return 0;
  return (
    integer(match[1]) * 86400 +
    integer(match[2]) * 3600 +
    integer(match[3]) * 60 +
    integer(match[4])
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown refresh error";
}
