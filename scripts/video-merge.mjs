// `limit` is a PER-PLATFORM cap, not a global one.
//
// It used to be global (`.slice(0, limit)` over the cross-platform sort), which
// silently starved whichever platform posted least recently. Instagram was the
// casualty: all 43 reels were older than the 60th-newest YouTube/TikTok entry,
// so every one of them fell outside the top 60 and `videos[]` carried zero
// Instagram rows - which is why the Videos tab's "Instagram library" tile and
// the overview's top-performers table could never show a reel.
//
// A global cap is also not durably fixable by raising the number: refreshYouTube
// pulls up to 30 videos across 7 channels, so YouTube alone can produce ~210
// fresher entries in one run and crowd the others back out.
export function mergeVideos(cachedVideos, freshVideos, limit = 60) {
  const byId = new Map(
    [...cachedVideos, ...freshVideos].map((video) => [video.id, video]),
  );

  const sorted = [...byId.values()].sort(
    (left, right) =>
      new Date(right.publishedAt).getTime() -
      new Date(left.publishedAt).getTime(),
  );

  const usedByPlatform = new Map();
  const kept = [];

  for (const video of sorted) {
    const platform = video.platform ?? "unknown";
    const used = usedByPlatform.get(platform) ?? 0;
    if (used >= limit) continue;
    usedByPlatform.set(platform, used + 1);
    kept.push(video);
  }

  return kept;
}
