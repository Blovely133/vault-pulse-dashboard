const state = {
  tab: "overview",
  data: null,
};

const titles = {
  overview: "The whole network, one pulse.",
  videos: "Every post. Every signal.",
  connections: "Connect once. Track from here.",
};

const view = document.querySelector("#view");
const reloadButton = document.querySelector("#reload-button");
const notice = document.querySelector("#notice");
const noticeText = document.querySelector("#notice-text");

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    document.querySelector("#page-title").textContent = titles[state.tab];
    render();
  });
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
  const response = await fetch(`./data/dashboard.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Dashboard data returned ${response.status}`);
  state.data = await response.json();
  updateShell();
  render();
}

function updateShell() {
  const connected = state.data.connections?.connectedSources ?? 0;
  const total = state.data.connections?.totalSources ?? 6;
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
  if (state.tab === "connections") {
    view.innerHTML = connectionsMarkup(state.data);
  }
  view.querySelectorAll("[data-go-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`[data-tab="${button.dataset.goTab}"]`).click();
    });
  });
}

function overviewMarkup(data) {
  const metrics = [
    ["Total views", formatMetric(data.totals.views), "YouTube + TikTok", "coral"],
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
                  The GitHub-hosted dashboard and hourly refresh workflow are live.
                  Add platform credentials to repository Secrets to replace the
                  dashes with real performance.
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
            <h2>Three brands, six data sources</h2>
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
  return `
    <div class="view-stack">
      <section class="metric-grid compact">
        ${compactMetric("Tracked videos", data.videos.length || "—", "Latest 30 across all sources", "coral")}
        ${compactMetric("YouTube library", youtubeCount || "—", "Recent public uploads", "mint")}
        ${compactMetric("TikTok library", tiktokCount || "—", "Authorized public posts", "violet")}
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

function connectionsMarkup(data) {
  const connected = data.connections.connectedSources ?? 0;
  const total = data.connections.totalSources ?? 6;
  const percent = total ? Math.round((connected / total) * 100) : 0;
  return `
    <div class="view-stack">
      <section class="connection-hero">
        <div class="connection-hero-art" aria-hidden="true"></div>
        <div class="connection-hero-copy">
          <p class="kicker">GitHub-powered network</p>
          <h2>Your accounts stay connected backstage.</h2>
          <p>
            GitHub Actions retrieves platform stats with encrypted repository
            Secrets. No access key is stored in this website or sent to a browser.
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
            The dashboard checks each configured platform hourly and redeploys
            this page with a new snapshot. Credentials are configured once in
            repository Settings → Secrets and variables → Actions.
          </p>
        </div>
      </section>
    </div>
  `;
}

function channelCardMarkup(channel) {
  const image = channel.avatar
    ? `<img class="channel-avatar" src="${escapeAttribute(channel.avatar)}" alt="" />`
    : `<div class="channel-avatar">${escapeHtml(channel.displayName.charAt(0) || "?")}</div>`;
  return `
    <article class="channel-card" style="--channel-accent:${escapeAttribute(channel.accent)}">
      <div class="channel-card-top">
        ${image}
        <div>
          <span>Channel ${String(channel.slot).padStart(2, "0")}</span>
          <h3>${escapeHtml(channel.displayName)}</h3>
        </div>
      </div>
      ${platformLineMarkup("youtube", channel.youtube)}
      ${platformLineMarkup("tiktok", channel.tiktok)}
    </article>
  `;
}

function platformLineMarkup(platform, metrics) {
  const label = platform === "youtube" ? "YouTube" : "TikTok";
  const icon = platform === "youtube" ? "YT" : "TT";
  const statusClass = metrics.connected
    ? "status-live"
    : metrics.views != null
      ? "status-stale"
      : "status-offline";
  return `
    <div class="platform-line">
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
    </div>
  `;
}

function connectionCardMarkup(channel) {
  return `
    <article class="connection-card" style="--channel-accent:${escapeAttribute(channel.accent)}">
      <p class="kicker">Channel ${String(channel.slot).padStart(2, "0")}</p>
      <h3>${escapeHtml(channel.displayName)}</h3>
      <p>${escapeHtml(channel.slug)}</p>
      <div class="connection-field">
        <span>YouTube channel</span>
        <strong>${escapeHtml(channel.youtubeChannelId || channel.youtubeHandle || "Not configured")}</strong>
      </div>
      <div class="connection-field">
        <span>TikTok account</span>
        <strong>${channel.tiktokUsername ? `@${escapeHtml(channel.tiktokUsername)}` : "Not configured"}</strong>
      </div>
      <div class="connection-field">
        <span>TikTok secret</span>
        <strong><code>${escapeHtml(channel.tiktokTokenEnv)}</code></strong>
      </div>
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
                  <td><span class="table-platform ${video.platform}">${video.platform === "youtube" ? "YouTube" : "TikTok"}</span></td>
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
    }
  });
