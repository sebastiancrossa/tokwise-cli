import test from "node:test";
import assert from "node:assert/strict";
import { mergeVideo } from "../src/store.js";
import type { TikTokVideo } from "../src/types.js";

test("mergeVideo preserves local transcript and media paths", () => {
  const existing: TikTokVideo = {
    id: "123",
    url: "old",
    syncedAt: "2026-01-01T00:00:00.000Z",
    source: "url",
    hashtags: ["old"],
    media: { audioPath: "/tmp/audio.m4a" },
    transcript: { text: "local transcript", generatedAt: "2026-01-02T00:00:00.000Z" },
  };
  const incoming: TikTokVideo = {
    id: "123",
    url: "new",
    description: "fresh metadata",
    syncedAt: "2026-01-03T00:00:00.000Z",
    source: "collection",
    hashtags: ["new"],
    media: { coverUrl: "https://example.com/cover.jpg" },
  };

  const merged = mergeVideo(existing, incoming);
  assert.equal(merged.url, "new");
  assert.equal(merged.media?.audioPath, "/tmp/audio.m4a");
  assert.equal(merged.media?.coverUrl, "https://example.com/cover.jpg");
  assert.equal(merged.transcript?.text, "local transcript");
  assert.deepEqual(merged.hashtags.sort(), ["new", "old"]);
});
