import assert from "node:assert/strict";
import test from "node:test";
import { mergeVideos } from "./video-merge.mjs";

test("fresh video metrics overwrite the cached record", () => {
  const cachedVideos = [
    {
      id: "youtube:abc",
      views: 30,
      likes: 3,
      publishedAt: "2026-07-25T12:00:00.000Z",
    },
    {
      id: "youtube:unchanged",
      views: 10,
      likes: 1,
      publishedAt: "2026-07-24T12:00:00.000Z",
    },
  ];
  const freshVideos = [
    {
      id: "youtube:abc",
      views: 1_903,
      likes: 70,
      publishedAt: "2026-07-25T12:00:00.000Z",
    },
  ];
  const videos = mergeVideos(cachedVideos, freshVideos);

  assert.deepEqual(videos, [freshVideos[0], cachedVideos[1]]);
});
