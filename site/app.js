const state = {
  tab: "overview",
  selectedChannelSlug: null,
  data: null,
};

const autoRefreshIntervalMs = 5 * 60 * 1000;
const minimumRefreshGapMs = 60 * 1000;
let dataLoadPromise = null;
let lastDataCheckAt = 0;

const tiktokSetupUrl =
  "https://testing-multiplayer-server.onrender.com/vault-pulse/setup";

const titles = {
  overview: "The whole network, one pulse.",
  videos: "Every post. Every signal.",
  instagram: "Reel performance, without the guesswork.",
  connections: "Connect once. Track from here.",
};

const view = document.querySelector("#view");
const reloadButton = document.querySelector("#reload-button");
const notice = document.querySelector("#notice");
const noticeText = document.querySelector("#notice-text");

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    navigateToTab(button.dataset.tab);
  });
});

window.addEventListener("hashchange", syncRoute);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshSilently();
});

document.querySelector("#dismiss-notice").addEventListener("click", () => {
  notice.hidden = true;
});

reloadButton.addEventListener("click", async () => {
  reloadButton.disabled = true;
  reloadButton.innerHTML = "<span aria-hidden=\"true\">•••</span> Checking";
  try {
    await loadData();
    showNotice("Loaded the newest GitHub snapshot.");
  } catch {
    showNotice("The latest snapshot could not be loaded. Try again shortly.");
  } finally {
    reloadButton.disabled = false;
    reloadButton.innerHTML = "<span aria-hidden=\"true\">↻</span> Check latest";
  }
});

async function loadData() {
  if (dataLoadPromise) return dataLoadPromise;

  dataLoadPromise = (async () => {
    const response = await fetch(`./data/dashboard.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Dashboard data returned ${response.status}`);
    }

    const nextData = await response.json();
    lastDataCheckAt = Date.now();
    if (state.data?.generatedAt === nextData.generatedAt) return;

    state.data = nextData;
    updateShell();
    syncRoute();
  })();

  try {
    await dataLoadPromise;
  } finally {
    dataLoadPromise = null;
  }
}

function refreshSilently() {
  if (
    document.hidden ||
    Date.now() - lastDataCheckAt < minimumRefreshGapMs
  ) {
    return;
  }
  loadData().catch(() => {});
}

function updateShell() {
  const connected = state.data.connections?.connectedSources ?? 0;
  const total = state.data.connections?.totalSources ?? 7;
  document.querySelector("#source-count").textContent =
    `${connected}/${total} sources`;
  document.querySelector("#source-status").textContent =
    connected > 0 ? "Automated tracking active" : "Setup in progress";
  document.querySelector("#last-sync").textContent =
    formatSync(state.data.updatedAt);
}

function render() {
  if (!state.data) return;
  if (state.tab === "overview") view.innerHTML = overviewMarkup(state.data);
  if (state.tab === "videos") view.innerHTML = videosMarkup(state.data);
  if (state.tab === "instagram") {
    view.innerHTML = instagramMarkup(state.data);
  }
  if (state.tab === "connections") {
    view.innerHTML = connectionsMarkup(state.data);
  }
  if (state.tab === "channel") {
    const channel = state.data.channels.find(
      (item) => item.slug === state.selectedChannelSlug,
    );
    view.innerHTML = channel
      ? channelDetailMarkup(state.data, channel)
      : overviewMarkup(state.data);
  }
  view.querySelectorAll("[data-go-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToTab(button.dataset.goTab);
    });
  });
  view.querySelectorAll("[data-channel-slug]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToChannel(button.dataset.channelSlug);
    });
  });
  view.querySelectorAll("[data-back-overview]").forEach((button) => {
    button.addEventListener("click", () => navigateToTab("overview"));
  });
}

function navigateToTab(tab) {
  const nextHash = `#${titles[tab] ? tab : "overview"}`;
  if (window.location.hash === nextHash) {
    syncRoute();
  } else {
    window.location.hash = nextHash;
  }
}

function navigateToChannel(slug) {
  const nextHash = `#channel/${encodeURIComponent(slug)}`;
  if (window.location.hash === nextHash) {
    syncRoute();
  } else {
    window.location.hash = nextHash;
  }
}

function syncRoute() {
  const hash = window.location.hash.slice(1);
  let route;
  try {
    route = decodeURIComponent(hash);
  } catch {
    route = "overview";
  }

  const channelSlug = route.startsWith("channel/")
    ? route.slice("channel/".length)
    : null;
  const channel = state.data?.channels.find(
    (item) => item.slug === channelSlug,
  );
  state.tab = channel ? "channel" : titles[route] ? route : "overview";
  state.selectedChannelSlug = channel?.slug ?? null;

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
  });
  document.querySelector("#page-title").textContent = channel
    ? `${channel.displayName} at a glance.`
    : titles[state.tab];
  render();
}

function overviewMarkup(data) {
  const metrics = [
    ["Total views", formatMetric(data.totals.views), "All connected platforms", "coral"],
    [
      "7-day view lift",
      data.totals.sevenDayViews == null
        ? "—"
        : `+${formatMetric(data.totals.sevenDayViews)}`,
      "Since last week",
      "mint",
    ],
    [
      "Total audience",
      formatMetric(data.totals.audience),
      "Subscribers + followers",
      "violet",
    ],
    [
      "Engagement",
      data.totals.engagementRate == null
        ? "—"
        : `${data.totals.engagementRate.toFixed(1)}%`,
      "Across recent videos",
      "blue",
    ],
  ];

  return `
    <div class="view-stack">
      ${
        !data.hasLiveData
          ? `
            <section class="setup-banner">
              <div>
                <p class="kicker">GitHub tracker ready</p>
                <h2>Connect once. Watch every release move.</h2>
                <p>
                  The GitHub-hosted dashboard and 15-minute refresh workflow are live.
                  Connect each platform once to replace the dashes with real
                  performance.
                </p>
              </div>
              <button class="ghost-button" type="button" data-go-tab="connections">
                Finish connections <span aria-hidden="true">→</span>
              </button>
            </section>
          `
          : ""
      }

      <section class="metric-grid" aria-label="Network metrics">
        ${metrics
          .map(
            ([label, value, note, accent]) => `
              <article class="metric-card ${accent}">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <small>${escapeHtml(note)}</small>
              </article>
            `,
          )
          .join("")}
      </section>

      <section class="analytics-grid">
        <article class="panel chart-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">View trajectory</p>
              <h2>14-day network performance</h2>
            </div>
            <div class="legend" aria-label="Chart legend">
              <span><i class="legend-youtube"></i>YouTube</span>
              <span><i class="legend-tiktok"></i>TikTok</span>
            </div>
          </div>
          ${trendMarkup(data)}
          <div class="platform-split">
            <div>
              <span>YouTube views</span>
              <strong>${formatMetric(data.platformTotals.youtube)}</strong>
            </div>
            <div>
              <span>TikTok views</span>
              <strong>${formatMetric(data.platformTotals.tiktok)}</strong>
            </div>
            <div>
              <span>Instagram views</span>
              <strong>${formatMetric(data.platformTotals.instagram)}</strong>
            </div>
          </div>
        </article>

        <article class="panel cadence-panel">
          <div class="panel-heading">
            <div>
              <p class="kicker">Publishing rhythm</p>
              <h2>Two releases. Every day.</h2>
            </div>
            <span class="timezone">Central time</span>
          </div>
          ${scheduleCard("01", "Release 1", "Morning momentum", "11:00 AM", "3:00 PM")}
          ${scheduleCard("02", "Release 2", "Evening peak", "6:00 PM", "8:00 PM", true)}
          <div class="cadence-note">
            <i class="pulse-dot" aria-hidden="true"></i>
            <p>
              <strong>14 posts per platform, per week.</strong>
              <span>GitHub preserves a new data snapshot every hour.</span>
            </p>
          </div>
        </article>
      </section>

      <section>
        <div class="section-heading">
          <div>
            <p class="kicker">Channel health</p>
            <h2>Three brands, seven data sources</h2>
          </div>
          <button class="text-button" type="button" data-go-tab="connections">
            View connections →
          </button>
        </div>
        <div class="channel-grid">
          ${data.channels.map(channelCardMarkup).join("")}
        </div>
      </section>

      <section class="panel table-panel">
        <div class="panel-heading">
          <div>
            <p class="kicker">Top performers</p>
            <h2>Videos earning attention</h2>
          </div>
          <span class="timezone">By total views</span>
        </div>
        ${videoTableMarkup(
          [...data.videos].sort((a, b) => b.views - a.views).slice(0, 5),
          "No video data yet",
        )}
      </section>
    </div>
  `;
}

function videosMarkup(data) {
  const youtubeCount = data.videos.filter(
    (video) => video.platform === "youtube",
  ).length;
  const tiktokCount = data.videos.filter(
    (video) => video.platform === "tiktok",
  ).length;
  const instagramCount = data.videos.filter(
    (video) => video.platform === "instagram",
  ).length;
  return `
    <div class="view-stack">
      <section class="metric-grid">
        ${compactMetric("Tracked videos", data.videos.length || "—", "Latest 30 across all sources", "coral")}
        ${compactMetric("YouTube library", youtubeCount || "—", "Recent public uploads", "mint")}
        ${compactMetric("TikTok library", tiktokCount || "—", "Authorized public posts", "violet")}
        ${compactMetric("Instagram library", instagramCount || "\u2014", "Reels from @sylvasblessing", "blue")}
      </section>
      <section class="panel table-panel full-table">
        <div class="panel-heading">
          <div>
            <p class="kicker">Video library</p>
            <h2>Performance by post</h2>
          </div>
          <span class="timezone">Most recent first</span>
        </div>
        ${videoTableMarkup(
          data.videos,
          "Connect a source to populate the library",
        )}
      </section>
    </div>
  `;
}

function instagramMarkup(data) {
  const channels = data.channels.filter((item) => item.instagramUsername);
  if (!channels.length) {
    return `
      <div class="view-stack">
        <section class="setup-banner">
          <div>
            <p class="kicker">Instagram</p>
            <h2>No Instagram accounts are configured yet.</h2>
          </div>
        </section>
      </div>
    `;
  }
  return `
    <div class="view-stack">
      ${channels
        .map((channel) => instagramAccountMarkup(data, channel))
        .join("")}
    </div>
  `;
}

function instagramAccountMarkup(data, channel) {
  const instagram = channel?.instagram ?? {};
  const feeds = Array.isArray(data.instagramFeeds)
    ? data.instagramFeeds
    : data.instagram
      ? [data.instagram]
      : [];
  const feed =
    feeds.find((item) => item.channelId === channel.id) ??
    (data.instagram?.channelId === channel.id ? data.instagram : {});
  const account = feed.account ?? {};
  const totals = feed.totals ?? instagram;
  const reels = Array.isArray(feed.reels)
    ? feed.reels
    : data.videos.filter(
        (video) =>
          video.platform === "instagram" && video.channelId === channel.id,
      );
  const username =
    account.username || channel?.instagramUsername || "sylvasblessing";
  const profileUrl =
    account.profileUrl ||
    instagram.profileUrl ||
    `https://www.instagram.com/${username}/`;
  const connected = Boolean(instagram.connected || account.connected);
  const freshness = feed.generatedAt || instagram.generatedAt;
  const ratio = numericValue(totals.viewToReachRatio);
  const errors = Array.isArray(feed.errors) ? feed.errors.length : 0;

  return `
      <section class="instagram-hero panel" aria-labelledby="instagram-${escapeAttribute(channel.slug)}">
        <div class="instagram-identity">
          <span class="instagram-mark" aria-hidden="true">IG</span>
          <div>
            <p class="kicker">${escapeHtml(channel?.displayName || "Kids History")} distribution</p>
            <h2 id="instagram-${escapeAttribute(channel.slug)}">@${escapeHtml(username)}</h2>
            <p>
              Reel reach, retention, and interaction data from the live
              Instagram professional account.
            </p>
          </div>
        </div>
        <div class="instagram-hero-actions">
          <span class="instagram-status ${connected ? "is-live" : "is-pending"}">
            <i aria-hidden="true"></i>
            ${connected ? "Live Graph API feed" : "First live refresh pending"}
          </span>
          <a class="primary-button instagram-open" href="${escapeAttribute(profileUrl)}" target="_blank" rel="noreferrer">
            Open Instagram <span aria-hidden="true">&#8599;</span>
          </a>
        </div>
      </section>

      ${
        connected
          ? ""
          : `
            <section class="setup-banner">
              <div>
                <p class="kicker">Connection staged</p>
                <h2>The Instagram feed is ready for its first refresh.</h2>
                <p>
                  Vault Pulse will fill this tab automatically after the
                  analytics service is deployed. No Instagram credential is
                  stored in this website.
                </p>
              </div>
            </section>
          `
      }

      <section class="metric-grid" aria-label="Instagram totals">
        ${compactMetric("Reel views", formatMetric(totals.views), `${formatMetric(totals.reels)} Reels tracked`, "coral")}
        ${compactMetric("Reach", formatMetric(totals.reach), "Accounts reached across Reels", "mint")}
        ${compactMetric("Interactions", formatMetric(totals.totalInteractions), "Likes + comments + saves + shares", "violet")}
        ${compactMetric("Avg. watch time", formatWatchTime(totals.averageWatchTimeMs), "Weighted across tracked views", "blue")}
      </section>

      <section class="instagram-signal-grid" aria-label="Instagram quality signals">
        ${instagramSignalMarkup(
          "Views / reach",
          ratio == null ? "\u2014" : `${ratio.toFixed(2)}x`,
          "Replay depth",
          ratio == null
            ? "Waiting for the first snapshot"
            : ratio > 1
              ? "Views exceed unique reach, showing repeat plays."
              : "Views compared with accounts reached.",
          "coral",
        )}
        ${instagramSignalMarkup(
          "Engagement / reach",
          formatPercent(totals.engagementRate),
          "Interaction quality",
          "Total interactions divided by accounts reached.",
          "mint",
        )}
        ${instagramSignalMarkup(
          "Saves",
          formatMetric(totals.saves),
          "Intent signal",
          "People keeping a Reel for later.",
          "violet",
        )}
        ${instagramSignalMarkup(
          "Shares",
          formatMetric(totals.shares),
          "Distribution signal",
          "Reels passed directly to another viewer.",
          "blue",
        )}
      </section>

      <section class="panel table-panel instagram-table-panel">
        <div class="panel-heading">
          <div>
            <p class="kicker">Reel scorecard</p>
            <h2>Every Instagram post, one clean comparison</h2>
          </div>
          <span class="timezone">${freshness ? `Updated ${escapeHtml(formatSync(freshness))}` : "Awaiting first snapshot"}</span>
        </div>
        ${instagramReelTableMarkup(reels)}
        ${
          errors
            ? `<p class="data-note"><i aria-hidden="true"></i>${errors} Reel${errors === 1 ? "" : "s"} could not be refreshed in the latest snapshot; the available rows remain live.</p>`
            : ""
        }
      </section>
  `;
}

function instagramSignalMarkup(label, value, eyebrow, note, accent) {
  return `
    <article class="instagram-signal ${accent}">
      <div>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(eyebrow)}</small>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

function instagramReelTableMarkup(reels) {
  if (!reels.length) {
    return `
      <div class="table-empty">
        <span>IG</span>
        <div>
          <strong>No Instagram snapshot has landed yet</strong>
          <p>Views, reach, watch time, interactions, saves, and shares will appear here.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="table-wrap">
      <table class="instagram-reel-table">
        <thead>
          <tr>
            <th>Reel</th>
            <th>Views</th>
            <th>Reach</th>
            <th>Avg. watch</th>
            <th>Interactions</th>
            <th>Saves</th>
            <th>Shares</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          ${reels
            .map(
              (reel) => `
                <tr>
                  <td>
                    <a href="${escapeAttribute(reel.url)}" target="_blank" rel="noreferrer">
                      <strong>${escapeHtml(reel.title || "Untitled Instagram Reel")}</strong>
                      <span>Open Reel &#8599;</span>
                    </a>
                  </td>
                  <td>${formatMetric(reel.views)}</td>
                  <td>${formatMetric(reel.reach)}</td>
                  <td>${formatWatchTime(reel.averageWatchTimeMs)}</td>
                  <td>${formatMetric(reel.totalInteractions)}</td>
                  <td>${formatMetric(reel.saves)}</td>
                  <td>${formatMetric(reel.shares)}</td>
                  <td>${formatDate(reel.publishedAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function connectionsMarkup(data) {
  const connected = data.connections.connectedSources ?? 0;
  const total = data.connections.totalSources ?? 7;
  const percent = total ? Math.round((connected / total) * 100) : 0;
  return `
    <div class="view-stack">
      <section class="connection-hero">
        <div class="connection-hero-art" aria-hidden="true"></div>
        <div class="connection-hero-copy">
          <p class="kicker">Secure connection layer</p>
          <h2>Your accounts stay connected backstage.</h2>
          <p>
            YouTube access stays in encrypted GitHub Secrets. TikTok connections
            stay on the Render server, while Instagram access stays on the AWS
            publisher. No platform credential is stored in this website or sent
            to a browser.
          </p>
          <div class="connection-progress">
            <span>${connected} of ${total} sources connected</span>
            <i><b style="width:${percent}%"></b></i>
          </div>
        </div>
      </section>

      <section class="connection-grid">
        ${data.channels.map(connectionCardMarkup).join("")}
      </section>

      <section class="connection-note">
        <span class="github-badge">GH</span>
        <div>
          <strong>Automated by GitHub Actions</strong>
          <p>
            The dashboard checks every configured platform each 15 minutes and
            redeploys this page with a new snapshot. TikTok and Instagram token
            refreshes happen automatically on their existing servers.
          </p>
        </div>
      </section>
    </div>
  `;
}

function channelDetailMarkup(data, channel) {
  const metrics = [
    channel.youtube,
    channel.tiktok,
    ...(channel.instagramUsername ? [channel.instagram] : []),
  ];
  const channelVideos = data.videos.filter(
    (video) => video.channelId === channel.id,
  );
  const insights = channelInsightMetrics(data, channel, channelVideos);
  const totalViews = totalPlatformMetric(metrics, "views");
  const totalAudience = totalPlatformMetric(metrics, "audience");
  const totalLikes = totalPlatformMetric(metrics, "likes");
  const image = channel.avatar
    ? `<img class="channel-detail-avatar" src="${escapeAttribute(channel.avatar)}" alt="" />`
    : `<div class="channel-detail-avatar">${escapeHtml(channel.displayName.charAt(0) || "?")}</div>`;

  return `
    <div class="view-stack">
      <section class="channel-detail-hero panel" style="--channel-accent:${escapeAttribute(channel.accent)}">
        <button class="detail-back" type="button" data-back-overview>
          <span aria-hidden="true">&larr;</span> All channels
        </button>
        <div class="channel-detail-identity">
          ${image}
          <div>
            <p class="kicker">Channel ${String(channel.slot).padStart(2, "0")} report</p>
            <h2>${escapeHtml(channel.displayName)}</h2>
            <p>Performance, publishing health, and cross-platform alignment.</p>
          </div>
        </div>
      </section>

      <section class="metric-grid" aria-label="${escapeAttribute(channel.displayName)} totals">
        ${compactMetric("Total views", formatMetric(totalViews), channel.instagramUsername ? "YouTube + TikTok + Instagram" : "YouTube + TikTok", "coral")}
        ${compactMetric("Total audience", formatMetric(totalAudience), "Subscribers + followers", "mint")}
        ${compactMetric("Total likes", formatMetric(totalLikes), channel.instagramUsername ? "Reported across three platforms" : "Reported by both platforms", "violet")}
        ${compactMetric(
          "7-day views",
          insights.sevenDayViews == null
            ? "—"
            : `+${formatMetric(insights.sevenDayViews)}`,
          insights.sevenDayViews == null
            ? "Building a 7-day snapshot"
            : "Lift across both platforms",
          "blue",
        )}
      </section>

      <section class="platform-detail-grid">
        ${platformDetailMarkup("youtube", channel.youtube, channel)}
        ${platformDetailMarkup("tiktok", channel.tiktok, channel)}
        ${
          channel.instagramUsername
            ? platformDetailMarkup("instagram", channel.instagram, channel)
            : ""
        }
      </section>

      <section class="insight-section" aria-labelledby="shorts-performance-heading">
        <div class="section-heading">
          <div>
            <p class="kicker">Shorts performance</p>
            <h2 id="shorts-performance-heading">Attention and audience quality</h2>
          </div>
          <span class="timezone">YouTube Studio metrics</span>
        </div>
        <div class="insight-grid">
          ${feedDecisionMarkup(insights.choseToViewRate, insights.swipeAwayRate)}
          ${insightMetricMarkup(
            "Average % viewed",
            formatPercent(insights.averagePercentageViewed),
            "Completion",
            metricAvailabilityNote(
              insights.averagePercentageViewed,
              "Average watched per Short",
            ),
            "violet",
          )}
          ${insightMetricMarkup(
            "Subs / 1K engaged",
            formatPerThousand(insights.subscribersPerThousandEngagedViews),
            "Conversion",
            metricAvailabilityNote(
              insights.subscribersPerThousandEngagedViews,
              "Subscribers gained per 1,000 engaged views",
            ),
            "mint",
          )}
          ${insightMetricMarkup(
            "Engagement / 1K",
            formatPerThousand(insights.engagementPerThousandViews),
            "Interaction",
            "Likes, comments, and shares per 1,000 views",
            "coral",
          )}
          ${insightMetricMarkup(
            "First 24h vs baseline",
            formatSignedPercent(insights.twentyFourHourVsBaseline),
            "Velocity",
            metricAvailabilityNote(
              insights.twentyFourHourVsBaseline,
              "First-day views against channel baseline",
            ),
            "blue",
          )}
          ${insightMetricMarkup(
            "Returning viewers",
            formatMetric(insights.returningViewers),
            "Loyalty",
            metricAvailabilityNote(
              insights.returningViewers,
              "People who came back in the selected period",
            ),
            "violet",
          )}
        </div>
        ${analyticsColumnsMarkup(insights)}
        ${
          insights.privateAnalyticsComplete
            ? ""
            : `<p class="data-note"><i aria-hidden="true"></i>Public channel data is live. Chose-to-view, swipe-away, completion, subscriber conversion, 24-hour velocity, and returning viewers need a private YouTube Analytics connection.</p>`
        }
      </section>

      <section class="panel operations-panel" aria-labelledby="publishing-health-heading">
        <div class="panel-heading">
          <div>
            <p class="kicker">Publishing operations</p>
            <h2 id="publishing-health-heading">Runway, parity, and cadence</h2>
          </div>
          <span class="timezone">Target: 2 posts / platform / day</span>
        </div>
        <div class="operations-grid">
          ${operationMetricMarkup(
            "Schedule runway",
            insights.scheduleRunway,
            insights.scheduleRunway === "—"
              ? "Schedule feed not connected"
              : `Scheduled through ${formatDate(channel.publishing?.scheduledThrough)}`,
          )}
          ${operationMetricMarkup(
            "Ready to review",
            formatMetric(insights.readyToReview),
            insights.readyToReview == null
              ? "Repository queue not connected"
              : "Finished videos awaiting approval",
          )}
          ${operationMetricMarkup(
            "Platform parity",
            formatPercent(insights.platformParity),
            insights.platformParity == null
              ? "No posts tracked in the last 7 days"
              : `${insights.youtubeSevenDayPosts} YT · ${insights.tiktokSevenDayPosts} TT in 7 days`,
          )}
          ${operationMetricMarkup(
            "Cadence adherence",
            formatPercent(insights.cadenceAdherence),
            insights.cadenceAdherence == null
              ? "No recent publishing data"
              : `${insights.totalSevenDayPosts} of 28 target posts`,
          )}
        </div>
        ${pipelineMarkup(channel.publishing?.pipeline)}
      </section>

      <section class="panel table-panel full-table">
        <div class="panel-heading">
          <div>
            <p class="kicker">Recent library</p>
            <h2>${escapeHtml(channel.displayName)} videos</h2>
          </div>
          <span class="timezone">${channelVideos.length} tracked</span>
        </div>
        ${videoTableMarkup(channelVideos, "No videos reported for this channel yet")}
      </section>
    </div>
  `;
}

function channelCardMarkup(channel) {
  const image = channel.avatar
    ? `<img class="channel-avatar" src="${escapeAttribute(channel.avatar)}" alt="" />`
    : `<div class="channel-avatar">${escapeHtml(channel.displayName.charAt(0) || "?")}</div>`;
  return `
    <button
      class="channel-card channel-card-button"
      type="button"
      data-channel-slug="${escapeAttribute(channel.slug)}"
      style="--channel-accent:${escapeAttribute(channel.accent)}"
      aria-label="Open ${escapeAttribute(channel.displayName)} report"
    >
      <div class="channel-card-top">
        ${image}
        <div>
          <span>Channel ${String(channel.slot).padStart(2, "0")}</span>
          <h3>${escapeHtml(channel.displayName)}</h3>
        </div>
      </div>
      ${platformLineMarkup("youtube", channel.youtube, channel, false)}
      ${platformLineMarkup("tiktok", channel.tiktok, channel, false)}
      ${
        channel.instagramUsername
          ? platformLineMarkup("instagram", channel.instagram, channel, false)
          : ""
      }
      <span class="channel-card-cta">Open channel report <span aria-hidden="true">&rarr;</span></span>
    </button>
  `;
}

function platformLineMarkup(platform, metrics, channel, linked = true) {
  const labels = {
    youtube: ["YouTube", "YT"],
    tiktok: ["TikTok", "TT"],
    instagram: ["Instagram", "IG"],
  };
  const [label, icon] = labels[platform] ?? [platform, "?"];
  const href = channelPlatformUrl(channel, platform);
  const statusClass = metrics.connected
    ? "status-live"
    : metrics.views != null
      ? "status-stale"
      : "status-offline";
  const content = `
      <span class="platform-icon ${platform}">${icon}</span>
      <div>
        <strong>${label}</strong>
        <span>${escapeHtml(metrics.connectionLabel)}</span>
      </div>
      <div class="platform-stat">
        <strong>${formatMetric(metrics.views)}</strong>
        <span>views</span>
      </div>
      <i class="${statusClass}" aria-label="${escapeAttribute(metrics.connectionLabel)}"></i>
  `;
  return href && linked
    ? `<a class="platform-line linked" href="${escapeAttribute(href)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeAttribute(channel.displayName)} on ${label}">${content}</a>`
    : `<div class="platform-line">${content}</div>`;
}

function platformDetailMarkup(platform, metrics, channel) {
  const isYouTube = platform === "youtube";
  const isInstagram = platform === "instagram";
  const label = isYouTube ? "YouTube" : isInstagram ? "Instagram" : "TikTok";
  const icon = isYouTube ? "YT" : isInstagram ? "IG" : "TT";
  const audienceLabel = isYouTube
    ? "Subscribers"
    : isInstagram
      ? "Reach"
      : "Followers";
  const likesNote = isYouTube
    ? "Recent public uploads"
    : isInstagram
      ? "Tracked Reels"
      : "Profile total";
  const url = channelPlatformUrl(channel, platform);
  const statusClass = metrics.connected
    ? "status-live"
    : metrics.views != null
      ? "status-stale"
      : "status-offline";

  return `
    <article class="platform-detail panel ${platform}">
      <div class="platform-detail-heading">
        <div>
          <span class="platform-icon ${platform}">${icon}</span>
          <div>
            <p class="kicker">${label} analytics</p>
            <h3>${escapeHtml(metrics.connectionLabel)}</h3>
          </div>
          <i class="${statusClass}" aria-hidden="true"></i>
        </div>
        ${
          url
            ? `<a class="platform-open" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">Open ${label} &#8599;</a>`
            : ""
        }
      </div>
      <div class="platform-detail-stats">
        ${detailStatMarkup("Views", metrics.views, isInstagram ? "Tracked Reels" : "Platform total")}
        ${detailStatMarkup(audienceLabel, isInstagram ? metrics.reach : metrics.audience, isInstagram ? "Accounts reached" : "Current audience")}
        ${detailStatMarkup("Likes", metrics.likes, likesNote)}
        ${detailStatMarkup(isInstagram ? "Reels" : "Videos", metrics.videos, "Published count")}
      </div>
    </article>
  `;
}

function detailStatMarkup(label, value, note) {
  return `
    <div class="detail-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${formatMetric(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}

function channelInsightMetrics(data, channel, videos) {
  const shorts = channel.shortsAnalytics ?? {};
  const publishing = channel.publishing ?? {};
  const reportMetrics = channel.reportMetrics ?? {};
  const configuredSwipeAwayRate = percentValue(
    reportMetrics.swipeAwayRate ?? shorts.swipeAwayRate,
  );
  const choseToViewRate =
    percentValue(shorts.choseToViewRate) ??
    (configuredSwipeAwayRate == null ? null : 100 - configuredSwipeAwayRate);
  const swipeAwayRate =
    configuredSwipeAwayRate ??
    (choseToViewRate == null
      ? null
      : Math.max(0, Math.min(100, 100 - choseToViewRate)));
  const engagedViews = numericValue(shorts.engagedViews);
  const subscribersGained = numericValue(shorts.subscribersGained);
  const completionRate = percentValue(
    reportMetrics.completionRate ?? shorts.averagePercentageViewed,
    false,
  );
  const conversionPerThousand =
    numericValue(reportMetrics.conversionPerThousand) ??
    numericValue(shorts.subscribersPerThousandEngagedViews) ??
    (engagedViews > 0 && subscribersGained != null
      ? (subscribersGained / engagedViews) * 1000
      : null);
  const velocityRate = numericValue(
    reportMetrics.velocityRate ?? shorts.twentyFourHourVsBaseline,
  );
  const returningViewers = numericValue(
    reportMetrics.returningViewers ?? shorts.returningViewers,
  );
  const recentPosts = recentVideos(
    videos,
    data.updatedAt ?? data.generatedAt,
    7,
  );
  const youtubeSevenDayPosts = recentPosts.filter(
    (video) => video.platform === "youtube",
  ).length;
  const tiktokSevenDayPosts = recentPosts.filter(
    (video) => video.platform === "tiktok",
  ).length;
  const totalSevenDayPosts = youtubeSevenDayPosts + tiktokSevenDayPosts;
  const largestPlatformCount = Math.max(
    youtubeSevenDayPosts,
    tiktokSevenDayPosts,
  );
  const derivedCadenceAdherence =
    totalSevenDayPosts > 0
      ? Math.min(100, (totalSevenDayPosts / 28) * 100)
      : null;
  const cadenceAdherence =
    percentValue(reportMetrics.cadenceAdherence) ??
    derivedCadenceAdherence;
  const recentViews = videos.reduce(
    (total, video) => total + Math.max(0, numericValue(video.views) ?? 0),
    0,
  );
  const recentInteractions = videos.reduce(
    (total, video) =>
      total +
      Math.max(0, numericValue(video.likes) ?? 0) +
      Math.max(0, numericValue(video.comments) ?? 0) +
      Math.max(0, numericValue(video.saves) ?? 0) +
      Math.max(0, numericValue(video.shares) ?? 0),
    0,
  );

  return {
    privateAnalyticsComplete: [
      choseToViewRate,
      swipeAwayRate,
      completionRate,
      conversionPerThousand,
      velocityRate,
      returningViewers,
    ].every((value) => numericValue(value) != null),
    sevenDayViews: channelSevenDayViews(data, channel),
    choseToViewRate,
    swipeAwayRate,
    averagePercentageViewed: completionRate,
    subscribersPerThousandEngagedViews: conversionPerThousand,
    engagementPerThousandViews:
      recentViews > 0 ? (recentInteractions / recentViews) * 1000 : null,
    twentyFourHourVsBaseline: velocityRate,
    returningViewers,
    scheduleRunway: scheduleRunway(
      publishing.scheduledThrough,
      data.updatedAt ?? data.generatedAt,
    ),
    readyToReview: numericValue(publishing.readyToReview),
    platformParity:
      largestPlatformCount > 0
        ? (Math.min(youtubeSevenDayPosts, tiktokSevenDayPosts) /
            largestPlatformCount) *
          100
        : null,
    cadenceAdherence,
    youtubeSevenDayPosts,
    tiktokSevenDayPosts,
    totalSevenDayPosts,
  };
}

function analyticsColumnsMarkup(insights) {
  const columns = [
    [
      "Cadence adherence",
      formatPercent(insights.cadenceAdherence),
      "28-post weekly target",
    ],
    [
      "Swiped away",
      formatPercent(insights.swipeAwayRate),
      "Shorts feed decision",
    ],
    [
      "Completion",
      formatPercent(insights.averagePercentageViewed),
      "Average % viewed",
    ],
    [
      "Conversion",
      formatPerThousand(insights.subscribersPerThousandEngagedViews),
      "Subs / 1K engaged",
    ],
    [
      "Velocity",
      formatSignedPercent(insights.twentyFourHourVsBaseline),
      "First 24h vs baseline",
    ],
    [
      "Returning viewers",
      formatMetric(insights.returningViewers),
      "Selected report period",
    ],
  ];

  return `
    <div class="analytics-columns-wrap" aria-label="Channel report metric fields">
      <table class="analytics-columns">
        <thead>
          <tr>
            ${columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          <tr>
            ${columns
              .map(
                ([, value, note]) => `
                  <td>
                    <strong>${escapeHtml(value)}</strong>
                    <small>${escapeHtml(note)}</small>
                  </td>
                `,
              )
              .join("")}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function feedDecisionMarkup(choseToViewRate, swipeAwayRate) {
  const hasData = choseToViewRate != null && swipeAwayRate != null;
  return `
    <article class="feed-decision-card">
      <div class="insight-card-heading">
        <div>
          <span>Shorts feed decision</span>
          <small>Hook strength</small>
        </div>
        <span class="source-chip">YT</span>
      </div>
      <div class="feed-decision-values">
        <div>
          <strong>${formatPercent(choseToViewRate)}</strong>
          <span>Chose to view</span>
        </div>
        <div>
          <strong>${formatPercent(swipeAwayRate)}</strong>
          <span>Swiped away</span>
        </div>
      </div>
      <div class="feed-decision-bar${hasData ? "" : " is-empty"}" aria-label="${
        hasData
          ? `${formatPercent(choseToViewRate)} chose to view and ${formatPercent(swipeAwayRate)} swiped away`
          : "YouTube Analytics connection needed"
      }">
        <i style="width:${hasData ? choseToViewRate : 50}%"></i>
      </div>
      <p>${hasData ? "Swipe-away is 100% minus chose-to-view." : "YouTube Analytics access needed"}</p>
    </article>
  `;
}

function insightMetricMarkup(label, value, eyebrow, note, accent) {
  return `
    <article class="insight-card ${accent}">
      <div class="insight-card-heading">
        <div>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(eyebrow)}</small>
        </div>
        <i aria-hidden="true"></i>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

function operationMetricMarkup(label, value, note) {
  return `
    <div class="operation-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `;
}

function pipelineMarkup(pipeline = {}) {
  const stages = [
    ["Planned", pipeline?.planned],
    ["Editing", pipeline?.editing],
    ["Review", pipeline?.review],
    ["Scheduled", pipeline?.scheduled],
    ["Published", pipeline?.publishedThisWeek],
  ];
  return `
    <div class="pipeline-block">
      <div class="pipeline-heading">
        <div>
          <span>Content pipeline</span>
          <small>Repository workflow</small>
        </div>
        <span>${stages.some(([, value]) => numericValue(value) != null) ? "Live counts" : "Repository queue not connected"}</span>
      </div>
      <div class="pipeline-grid">
        ${stages
          .map(
            ([label, value], index) => `
              <div class="pipeline-stage">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${formatMetric(numericValue(value))}</strong>
                <small>${escapeHtml(label)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function metricAvailabilityNote(value, availableNote) {
  return value == null ? "YouTube Analytics access needed" : availableNote;
}

function recentVideos(videos, referenceValue, days) {
  const reference = new Date(referenceValue);
  if (Number.isNaN(reference.getTime())) return [];
  const cutoff = reference.getTime() - days * 24 * 60 * 60 * 1000;
  return videos.filter((video) => {
    const publishedAt = new Date(video.publishedAt).getTime();
    return (
      Number.isFinite(publishedAt) &&
      publishedAt >= cutoff &&
      publishedAt <= reference.getTime()
    );
  });
}

function channelSevenDayViews(data, channel) {
  const snapshots = data.snapshots ?? [];
  const reference = new Date(data.updatedAt ?? data.generatedAt);
  if (Number.isNaN(reference.getTime())) return null;
  const target = reference.getTime() - 7 * 24 * 60 * 60 * 1000;
  const latestByPlatform = new Map();

  for (const snapshot of snapshots) {
    if (snapshot.channelId !== channel.id) continue;
    const capturedAt = new Date(snapshot.capturedAt).getTime();
    if (!Number.isFinite(capturedAt) || capturedAt > target) continue;
    const current = latestByPlatform.get(snapshot.platform);
    if (
      !current ||
      new Date(current.capturedAt).getTime() < capturedAt
    ) {
      latestByPlatform.set(snapshot.platform, snapshot);
    }
  }

  if (!latestByPlatform.size) return null;
  const availablePlatforms = [
    ["youtube", channel.youtube],
    ["tiktok", channel.tiktok],
    ...(channel.instagramUsername
      ? [["instagram", channel.instagram]]
      : []),
  ]
    .filter(([, metric]) => metric?.views != null)
    .map(([platform]) => platform);
  if (
    !availablePlatforms.every((platform) =>
      latestByPlatform.has(platform),
    )
  ) {
    return null;
  }
  const previousViews = [...latestByPlatform.values()].reduce(
    (total, snapshot) => total + Math.max(0, numericValue(snapshot.views) ?? 0),
    0,
  );
  const currentViews = totalPlatformMetric(
    [channel.youtube, channel.tiktok],
    "views",
  );
  return currentViews == null
    ? null
    : Math.max(0, currentViews - previousViews);
}

function scheduleRunway(scheduledThroughValue, referenceValue) {
  if (!scheduledThroughValue) return "—";
  const scheduledThrough = new Date(scheduledThroughValue);
  const reference = new Date(referenceValue);
  if (
    Number.isNaN(scheduledThrough.getTime()) ||
    Number.isNaN(reference.getTime())
  ) {
    return "—";
  }
  const hours = Math.max(
    0,
    (scheduledThrough.getTime() - reference.getTime()) / (60 * 60 * 1000),
  );
  return hours < 24 ? `${Math.round(hours)}h` : `${Math.ceil(hours / 24)}d`;
}

function numericValue(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentValue(value, clamp = true) {
  const parsed = numericValue(value);
  if (parsed == null) return null;
  return clamp ? Math.max(0, Math.min(100, parsed)) : Math.max(0, parsed);
}

function formatPercent(value) {
  const parsed = numericValue(value);
  return parsed == null ? "—" : `${parsed.toFixed(1)}%`;
}

function formatSignedPercent(value) {
  const parsed = numericValue(value);
  if (parsed == null) return "—";
  return `${parsed > 0 ? "+" : ""}${parsed.toFixed(1)}%`;
}

function formatPerThousand(value) {
  const parsed = numericValue(value);
  return parsed == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 1,
      }).format(parsed);
}

function totalPlatformMetric(metrics, key) {
  const values = metrics
    .map((metric) => metric?.[key])
    .filter((value) => value != null);
  return values.length
    ? values.reduce((total, value) => total + Number(value || 0), 0)
    : null;
}

function channelPlatformUrl(channel, platform) {
  if (platform === "youtube") {
    if (channel.youtubeChannelId) {
      return `https://www.youtube.com/channel/${channel.youtubeChannelId}`;
    }
    if (channel.youtubeHandle) {
      return `https://www.youtube.com/${channel.youtubeHandle.startsWith("@") ? channel.youtubeHandle : `@${channel.youtubeHandle}`}`;
    }
    return "";
  }
  if (platform === "instagram") {
    return (
      channel.instagram?.profileUrl ||
      (channel.instagramUsername
        ? `https://www.instagram.com/${channel.instagramUsername.replace(/^@/, "")}/`
        : "")
    );
  }
  return channel.tiktokUsername
    ? `https://www.tiktok.com/@${channel.tiktokUsername}`
    : "";
}

function connectionCardMarkup(channel) {
  const youtubeUrl = channel.youtubeChannelId
    ? `https://www.youtube.com/channel/${channel.youtubeChannelId}`
    : channel.youtubeHandle
      ? `https://www.youtube.com/${channel.youtubeHandle.startsWith("@") ? channel.youtubeHandle : `@${channel.youtubeHandle}`}`
      : "";
  const tiktokUrl = channel.tiktokUsername
    ? `https://www.tiktok.com/@${channel.tiktokUsername}`
    : "";
  const instagramUrl = channel.instagramUsername
    ? `https://www.instagram.com/${channel.instagramUsername.replace(/^@/, "")}/`
    : "";
  return `
    <article class="connection-card" style="--channel-accent:${escapeAttribute(channel.accent)}">
      <p class="kicker">Channel ${String(channel.slot).padStart(2, "0")}</p>
      <h3>${escapeHtml(channel.displayName)}</h3>
      <p>${escapeHtml(channel.slug)}</p>
      <div class="connection-field">
        <span>YouTube channel</span>
        <strong>${
          youtubeUrl
            ? `<a href="${escapeAttribute(youtubeUrl)}" target="_blank" rel="noreferrer">${escapeHtml(channel.youtubeChannelId || channel.youtubeHandle)} ↗</a>`
            : "Not configured"
        }</strong>
      </div>
      <div class="connection-field">
        <span>TikTok account</span>
        <strong>${
          tiktokUrl
            ? `<a href="${escapeAttribute(tiktokUrl)}" target="_blank" rel="noreferrer">@${escapeHtml(channel.tiktokUsername)} ↗</a>`
            : "Not configured"
        }</strong>
      </div>
      <div class="connection-field">
        <span>TikTok connection</span>
        <strong><a href="${escapeAttribute(tiktokSetupUrl)}" target="_blank" rel="noreferrer">Secure setup &#8599;</a></strong>
      </div>
      ${
        channel.instagramUsername
          ? `
            <div class="connection-field">
              <span>Instagram account</span>
              <strong><a href="${escapeAttribute(instagramUrl)}" target="_blank" rel="noreferrer">@${escapeHtml(channel.instagramUsername.replace(/^@/, ""))} &#8599;</a></strong>
            </div>
            <div class="connection-field">
              <span>Instagram analytics</span>
              <strong>${channel.instagram?.connected ? "Connected through AWS" : "First refresh pending"}</strong>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function trendMarkup(data) {
  if (!data.hasLiveData || !data.trend.some((point) => point.youtube || point.tiktok)) {
    return `
      <div class="chart-empty">
        <div class="chart-gridlines" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="chart-empty-copy">
          <strong>Your first automated refresh starts the graph.</strong>
          <span>Daily snapshots will build the view trajectory here.</span>
        </div>
      </div>
    `;
  }
  const max = Math.max(
    1,
    ...data.trend.flatMap((point) => [
      point.youtube ?? 0,
      point.tiktok ?? 0,
    ]),
  );
  return `
    <div class="bar-chart" aria-label="Fourteen day view trajectory">
      ${data.trend
        .map(
          (point, index) => `
            <div class="bar-column">
              <div class="bar-pair">
                <i class="bar youtube" style="height:${((point.youtube ?? 0) / max) * 100}%"></i>
                <i class="bar tiktok" style="height:${((point.tiktok ?? 0) / max) * 100}%"></i>
              </div>
              <span>${index % 3 === 0 || index === data.trend.length - 1 ? escapeHtml(point.label) : ""}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function scheduleCard(number, title, subtitle, tiktokTime, youtubeTime, featured = false) {
  return `
    <div class="schedule-card${featured ? " featured" : ""}">
      <div class="release-number">${number}</div>
      <div class="schedule-copy">
        <strong>${title}</strong>
        <span>${subtitle}</span>
      </div>
      <div class="platform-time">
        <span><b>TT</b> ${tiktokTime}</span>
        <span><b>YT</b> ${youtubeTime}</span>
      </div>
    </div>
  `;
}

function compactMetric(label, value, note, accent) {
  return `
    <article class="metric-card ${accent}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

function videoTableMarkup(videos, emptyLabel) {
  if (!videos.length) {
    return `
      <div class="table-empty">
        <span>00</span>
        <div>
          <strong>${escapeHtml(emptyLabel)}</strong>
          <p>Views, likes, comments, shares, and engagement will appear here.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Video</th>
            <th>Platform</th>
            <th>Views</th>
            <th>Likes</th>
            <th>Engagement</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          ${videos
            .map(
              (video) => `
                <tr>
                  <td>
                    <a href="${escapeAttribute(video.url)}" target="_blank" rel="noreferrer">
                      <strong>${escapeHtml(video.title)}</strong>
                      <span>${escapeHtml(video.channelName)}</span>
                    </a>
                  </td>
                  <td><span class="table-platform ${video.platform}">${platformLabel(video.platform)}</span></td>
                  <td>${formatMetric(video.views)}</td>
                  <td>${formatMetric(video.likes)}</td>
                  <td>${Number(video.engagementRate || 0).toFixed(1)}%</td>
                  <td>${formatDate(video.publishedAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatMetric(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function platformLabel(platform) {
  return {
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
  }[platform] ?? String(platform || "Unknown");
}

function formatWatchTime(value) {
  const milliseconds = numericValue(value);
  if (milliseconds == null) return "\u2014";
  const seconds = milliseconds / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSync(value) {
  if (!value) return "Waiting for first refresh";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Waiting for first refresh";
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function showNotice(message) {
  noticeText.textContent = message;
  notice.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

loadData()
  .catch(() => {
    document.querySelector("#loading-screen").innerHTML = `
      <div class="loading-mark">!</div>
      <p>The dashboard snapshot could not be loaded.</p>
    `;
  })
  .finally(() => {
    if (state.data) {
      document.querySelector("#loading-screen").hidden = true;
      document.querySelector("#app").hidden = false;
      window.setInterval(refreshSilently, autoRefreshIntervalMs);
    }
  });
