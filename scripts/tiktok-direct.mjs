// Direct TikTok reader for the channels whose OAuth refresh token is held as
// an Actions secret, so the dashboard no longer has to ask the Render proxy
// for its TikTok numbers.
//
// Why a static refresh token in a secret is safe here: TikTok does not rotate
// refresh tokens. A probe (run 30460611292, account axlotyl2, 2026-07-29)
// refreshed the same token twice six seconds apart and both calls returned
// HTTP 200 with a refresh_token byte-identical to the one sent -- TikTok echoes
// the token back rather than minting a new one, and re-serves the live access
// token as well. There is nothing to persist, so this path needs no write-back
// credential and cannot burn the stored token.
//
// The one thing refreshing does NOT do is extend the token's life.
// `refresh_expires_in` is an absolute countdown from the ORIGINAL grant: it
// ticked down by exactly the six seconds between the two probe calls. Each
// account therefore has to be re-authorized by hand roughly a year after it was
// first connected, which is what `refreshTokenExpiryWarning` watches for.
//
// Nothing here reads a previously written file. Every value is rebuilt from the
// current API response, so a figure that stops being available becomes null
// again instead of surviving as a stale number that still looks fresh.

const tokenEndpoint = "https://open.tiktokapis.com/v2/oauth/token/";
const userInfoEndpoint = "https://open.tiktokapis.com/v2/user/info/";
const videoListEndpoint = "https://open.tiktokapis.com/v2/video/list/";
const userFields =
  "open_id,display_name,username,follower_count,following_count,likes_count,video_count";
const videoFields =
  "id,title,video_description,share_url,create_time,duration,view_count,like_count,comment_count,share_count";
const userAgent = "Vault-Pulse-GitHub-Action";
const defaultVideoCount = 20;
const secondsPerDay = 86_400;

// Re-authorizing an account is a manual browser job, so the warning has to fire
// with enough runway to actually schedule it.
export const refreshExpiryWarningDays = 30;

// Maps a dashboard channel slug to the Actions secret holding its TikTok
// refresh token. A channel that is absent here has no direct authorization and
// falls back to the Render proxy.
export const channelRefreshTokenEnv = Object.freeze({
  "axolotl-drama": "TT_REFRESH_AXOLOTL2",
  "anime-countdown-vault": "TT_REFRESH_ANIMEHYPE41",
  // The account behind this slug is @thearchivelives. The dashboard label is
  // still "Kids History" from before the channel was renamed.
  "kids-history": "TT_REFRESH_THEARCHIVELIVES",
});

export function refreshTokenEnvForSlug(slug) {
  return channelRefreshTokenEnv[String(slug ?? "")] ?? null;
}

// Unknown must stay unknown. Number(null) is 0, which on a chart is
// indistinguishable from a real zero, so anything a reader could mistake for a
// measurement goes through here instead.
function nullableInteger(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(0, parsed)) : null;
}

// TikTok answers 200 with an `error` envelope whose code is "ok" on success, so
// the HTTP status alone is not enough to tell a good response from a bad one.
function apiErrorMessage(response, payload) {
  const error = payload?.error;
  const code = typeof error === "string" ? error : String(error?.code ?? "");
  if (response.ok && (code === "" || code === "ok")) return null;

  return (
    (typeof error === "object" ? error?.message : "") ||
    payload?.error_description ||
    (code && code !== "ok" ? code : "") ||
    `${response.status} ${response.statusText}`
  );
}

// A sum is only honest when every row contributed. Summing a column with gaps
// silently treats the gaps as zero and returns a confident, wrong number.
function total(records, field) {
  if (!records.length) return null;
  if (records.some((record) => record[field] == null)) return null;
  return records.reduce((sum, record) => sum + record[field], 0);
}

export function shapeUser(payload) {
  const user = payload?.data?.user ?? {};
  return {
    openId: String(user.open_id ?? "") || null,
    displayName: String(user.display_name ?? "") || null,
    username: String(user.username ?? "") || null,
    followerCount: nullableInteger(user.follower_count),
    followingCount: nullableInteger(user.following_count),
    likesCount: nullableInteger(user.likes_count),
    videoCount: nullableInteger(user.video_count),
  };
}

// The list endpoint has been served under both keys across API revisions.
export function videoListOf(payload) {
  const data = payload?.data ?? {};
  const videos = data.videos ?? data.video_list;
  return Array.isArray(videos) ? videos : [];
}

export function buildVideoRecords(
  videos,
  { channelId, channelName, username, capturedAt },
) {
  return (Array.isArray(videos) ? videos : []).map((video) => {
    const views = nullableInteger(video.view_count);
    const likes = nullableInteger(video.like_count);
    const comments = nullableInteger(video.comment_count);
    const shares = nullableInteger(video.share_count);
    const counted = [likes, comments, shares];
    const interactions = counted.some((value) => value == null)
      ? null
      : counted.reduce((sum, value) => sum + value, 0);

    return {
      id: `tiktok:${video.id}`,
      channelId,
      channelName,
      platform: "tiktok",
      title:
        video.title || video.video_description || "Untitled TikTok video",
      url:
        video.share_url ||
        `https://www.tiktok.com/@${username}/video/${video.id}`,
      publishedAt: video.create_time
        ? new Date(video.create_time * 1000).toISOString()
        : capturedAt,
      views,
      likes,
      comments,
      shares,
      durationSeconds: nullableInteger(video.duration),
      engagementRate:
        views != null && views > 0 && interactions != null
          ? (interactions / views) * 100
          : null,
    };
  });
}

// Same keys as the Render-proxy metric so either source drops into the same
// dashboard slot, plus `source` so a reader can see which one served it.
export function buildTikTokMetric({ user = null, videos = [], source }) {
  const views = total(videos, "views");
  const interactions = ["likes", "comments", "shares"]
    .map((field) => total(videos, field))
    .reduce(
      (sum, value) => (sum == null || value == null ? null : sum + value),
      0,
    );

  return {
    connected: true,
    connectionLabel: "Connected",
    views,
    audience: user?.followerCount ?? null,
    videos: user?.videoCount ?? null,
    likes: user?.likesCount ?? null,
    engagementRate:
      views != null && views > 0 && interactions != null
        ? (interactions / views) * 100
        : null,
    source,
  };
}

// `refresh_expires_in` counts down from the original authorization and is NOT
// extended by refreshing, so this is the only warning the pipeline will ever
// get before the account goes dark and needs a manual re-grant.
export function refreshTokenExpiryWarning(
  refreshExpiresInSeconds,
  warningDays = refreshExpiryWarningDays,
) {
  if (refreshExpiresInSeconds == null) return null;
  const days = Math.floor(refreshExpiresInSeconds / secondsPerDay);
  if (days > warningDays) return null;
  return `TikTok authorization expires in ${days} day(s) and has to be re-granted by hand`;
}

export function refreshTokenExpiresAt(refreshExpiresInSeconds, now = new Date()) {
  if (refreshExpiresInSeconds == null) return null;
  return new Date(
    now.getTime() + refreshExpiresInSeconds * 1000,
  ).toISOString();
}

export async function refreshAccessToken(
  { clientKey, clientSecret, refreshToken },
  fetchImpl = fetch,
) {
  if (!clientKey || !clientSecret || !refreshToken) {
    throw new Error("TikTok client credentials or refresh token are missing");
  }

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const payload = await response.json();
  // Only TikTok's own message is surfaced, never the request that carried the
  // client secret or the refresh token.
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      apiErrorMessage(response, payload) ||
        `${response.status} ${response.statusText}`,
    );
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds: nullableInteger(payload.expires_in),
    refreshExpiresInSeconds: nullableInteger(payload.refresh_expires_in),
  };
}

export async function fetchUserStats({ accessToken }, fetchImpl = fetch) {
  if (!accessToken) throw new Error("TikTok access token is missing");

  const url = new URL(userInfoEndpoint);
  url.searchParams.set("fields", userFields);
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": userAgent,
    },
  });
  const payload = await response.json();
  const message = apiErrorMessage(response, payload);
  if (message) throw new Error(message);

  return shapeUser(payload);
}

export async function fetchVideos(
  { accessToken, maxCount = defaultVideoCount },
  fetchImpl = fetch,
) {
  if (!accessToken) throw new Error("TikTok access token is missing");

  // The field list goes in the query string on this endpoint; the JSON body
  // carries paging only. Putting the fields in the body returns an empty list.
  const url = new URL(videoListEndpoint);
  url.searchParams.set("fields", videoFields);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ max_count: maxCount }),
  });
  const payload = await response.json();
  const message = apiErrorMessage(response, payload);
  if (message) throw new Error(message);

  return videoListOf(payload);
}

export async function fetchChannelTikTok(
  {
    channelId,
    channelName,
    username,
    capturedAt,
    clientKey,
    clientSecret,
    refreshToken,
  },
  fetchImpl = fetch,
) {
  const { accessToken, refreshExpiresInSeconds } = await refreshAccessToken(
    { clientKey, clientSecret, refreshToken },
    fetchImpl,
  );
  const user = await fetchUserStats({ accessToken }, fetchImpl);
  const videos = buildVideoRecords(
    await fetchVideos({ accessToken }, fetchImpl),
    {
      channelId,
      channelName,
      username: user.username || username,
      capturedAt,
    },
  );

  return {
    metric: buildTikTokMetric({ user, videos, source: "direct" }),
    videos,
    user,
    refreshExpiresInSeconds,
    expiryWarning: refreshTokenExpiryWarning(refreshExpiresInSeconds),
  };
}
