export function mergeVideos(cachedVideos, freshVideos, limit = 60) {
  const byId = new Map(
    [...cachedVideos, ...freshVideos].map((video) => [video.id, video]),
  );

  return [...byId.values()]
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime(),
    )
    .slice(0, limit);
}
