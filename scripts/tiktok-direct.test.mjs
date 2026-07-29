import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTikTokMetric,
  buildVideoRecords,
  fetchChannelTikTok,
  fetchUserStats,
  fetchVideos,
  refreshAccessToken,
  refreshTokenEnvForSlug,
  refreshTokenExpiryWarning,
  shapeUser,
} from "./tiktok-direct.mjs";

const capturedAt = "2026-07-29T15:00:00.000Z";

const userPayload = {
  data: {
    user: {
      open_id: "open-id",
      display_name: "Axolotl Drama",
      username: "axlotyl2",
      follower_count: 4,
      following_count: 11,
      likes_count: 39,
      video_count: 7,
    },
  },
  error: { code: "ok", message: "", log_id: "log" },
};

const videoPayload = {
  data: {
    videos: [
      {
        id: "7100000000000000001",
        title: "The axolotl files",
        share_url: "https://www.tiktok.com/@axlotyl2/video/7100000000000000001",
        create_time: 1_753_800_000,
        duration: 21,
        view_count: 600,
        like_count: 24,
        comment_count: 5,
        share_count: 1,
      },
      {
        id: "7100000000000000002",
        video_description: "Round two",
        create_time: 1_753_700_000,
        duration: 18,
        view_count: 400,
        like_count: 15,
        comment_count: 3,
        share_count: 2,
      },
    ],
  },
  error: { code: "ok", message: "", log_id: "log" },
};

function stubFetch(responses) {
  return async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return {
      ok: next.status < 400,
      status: next.status,
      statusText: next.statusText ?? "",
      json: async () => next.payload,
    };
  };
}

function tokenResponse(refreshExpiresIn = 31_535_496) {
  return {
    status: 200,
    payload: {
      access_token: "access-token",
      expires_in: 86_400,
      // TikTok echoes the same refresh token back rather than rotating it,
      // which is why a static Actions secret is a viable design here.
      refresh_token: "static-refresh-token",
      refresh_expires_in: refreshExpiresIn,
      token_type: "Bearer",
    },
  };
}

test("only the mapped channels have a direct token", () => {
  assert.equal(
    refreshTokenEnvForSlug("axolotl-drama"),
    "TT_REFRESH_AXOLOTL2",
  );
  assert.equal(
    refreshTokenEnvForSlug("kids-history"),
    "TT_REFRESH_THEARCHIVELIVES",
  );
  assert.equal(refreshTokenEnvForSlug("not-a-channel"), null);
  assert.equal(refreshTokenEnvForSlug(undefined), null);
});

test("a missing token never reaches the network", async () => {
  await assert.rejects(
    () =>
      refreshAccessToken(
        { clientKey: "client-key", clientSecret: "client-secret" },
        stubFetch([]),
      ),
    /refresh token are missing/,
  );
  await assert.rejects(
    () => fetchUserStats({ accessToken: "" }, stubFetch([])),
    /access token is missing/,
  );
  await assert.rejects(
    () => fetchVideos({}, stubFetch([])),
    /access token is missing/,
  );
});

test("a rejected refresh token reports TikTok's message without the token", async () => {
  await assert.rejects(
    () =>
      refreshAccessToken(
        {
          clientKey: "client-key",
          clientSecret: "top-secret-client-secret",
          refreshToken: "top-secret-refresh-token",
        },
        stubFetch([
          {
            status: 400,
            statusText: "Bad Request",
            payload: {
              error: "invalid_grant",
              error_description: "Refresh token is invalid or expired.",
            },
          },
        ]),
      ),
    (error) => {
      assert.equal(error.message, "Refresh token is invalid or expired.");
      assert.equal(error.message.includes("top-secret-refresh-token"), false);
      assert.equal(error.message.includes("top-secret-client-secret"), false);
      return true;
    },
  );
});

test("a 200 carrying an error code is still a failure", async () => {
  // TikTok answers 200 with an `error` envelope, so trusting the HTTP status
  // alone would turn a scope rejection into a confident set of empty numbers.
  await assert.rejects(
    () =>
      fetchUserStats(
        { accessToken: "access-token" },
        stubFetch([
          {
            status: 200,
            payload: {
              error: {
                code: "scope_not_authorized",
                message: "The user did not authorize the scope required.",
              },
            },
          },
        ]),
      ),
    /did not authorize the scope/,
  );

  await assert.rejects(
    () =>
      fetchChannelTikTok(
        {
          channelId: 1,
          channelName: "Axolotl Drama",
          username: "axlotyl2",
          capturedAt,
          clientKey: "client-key",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        },
        stubFetch([
          tokenResponse(),
          { status: 200, payload: userPayload },
          {
            status: 401,
            statusText: "Unauthorized",
            payload: {
              error: { code: "access_token_invalid", message: "" },
            },
          },
        ]),
      ),
    /access_token_invalid/,
  );
});

test("a live channel is shaped like the proxy result, tagged direct", async () => {
  const result = await fetchChannelTikTok(
    {
      channelId: 1,
      channelName: "Axolotl Drama",
      username: "axlotyl2",
      capturedAt,
      clientKey: "client-key",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    },
    stubFetch([
      tokenResponse(),
      { status: 200, payload: userPayload },
      { status: 200, payload: videoPayload },
    ]),
  );

  assert.deepEqual(result.metric, {
    connected: true,
    connectionLabel: "Connected",
    views: 1_000,
    audience: 4,
    videos: 7,
    likes: 39,
    engagementRate: 5,
    source: "direct",
  });
  assert.equal(result.videos.length, 2);
  assert.equal(result.videos[0].id, "tiktok:7100000000000000001");
  assert.equal(result.videos[0].channelName, "Axolotl Drama");
  assert.equal(result.videos[0].platform, "tiktok");
  assert.equal(result.videos[0].views, 600);
  assert.equal(result.videos[0].engagementRate, 5);
  assert.equal(result.videos[1].title, "Round two");
  assert.equal(
    result.videos[1].url,
    "https://www.tiktok.com/@axlotyl2/video/7100000000000000002",
  );
  assert.equal(result.expiryWarning, null);
});

test("an empty video list reads as unknown, never as zero views", () => {
  // An empty list can mean "no posts" or "the list call returned nothing this
  // run". Reporting 0 views would make the second case look like a real
  // collapse to zero, so it stays unknown.
  const metric = buildTikTokMetric({
    user: shapeUser(userPayload),
    videos: buildVideoRecords([], {
      channelId: 1,
      channelName: "Axolotl Drama",
      username: "axlotyl2",
      capturedAt,
    }),
    source: "direct",
  });

  assert.equal(metric.views, null);
  assert.equal(metric.engagementRate, null);
  // The account-level figures still came back, so those are not blanked out.
  assert.equal(metric.audience, 4);
  assert.equal(metric.videos, 7);
  assert.equal(metric.likes, 39);
});

test("a failure yields nulls rather than zeros", () => {
  const metric = buildTikTokMetric({ user: null, videos: [], source: "direct" });

  for (const field of ["views", "audience", "videos", "likes", "engagementRate"]) {
    assert.equal(metric[field], null, `${field} must stay null, not 0`);
  }
  assert.equal(metric.source, "direct");

  // A hole in one column makes the total unknown instead of a smaller number.
  const partial = buildTikTokMetric({
    user: shapeUser({ data: { user: { follower_count: 4 } } }),
    videos: buildVideoRecords(
      [
        { id: "1", view_count: 600, like_count: 24, comment_count: 5, share_count: 1 },
        { id: "2", view_count: null, like_count: 15 },
      ],
      { channelId: 1, channelName: "Axolotl Drama", username: "axlotyl2", capturedAt },
    ),
    source: "direct",
  });

  assert.equal(partial.views, null);
  assert.equal(partial.engagementRate, null);
  assert.equal(partial.audience, 4);
  assert.equal(partial.videos, null);
});

test("the expiry watch fires only inside the manual re-grant window", () => {
  // refresh_expires_in counts down from the original grant and refreshing does
  // not extend it, so this warning is the only notice before the account dies.
  assert.equal(refreshTokenExpiryWarning(31_535_496), null);
  assert.equal(refreshTokenExpiryWarning(null), null);
  assert.match(
    refreshTokenExpiryWarning(12 * 24 * 60 * 60),
    /expires in 12 day\(s\)/,
  );
  assert.match(refreshTokenExpiryWarning(0), /expires in 0 day\(s\)/);
});
