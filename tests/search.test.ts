import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchIndex, searchWithIndex, tokenize } from "../src/search.js";
import type { TikTokVideo } from "../src/types.js";

test("tokenize removes common stop words and keeps useful terms", () => {
  assert.deepEqual(tokenize("How do you make a career change?"), ["do", "make", "career", "change"]);
});

test("search ranks transcript and classification matches", () => {
  const videos: TikTokVideo[] = [
    video("1", "A clip about meal prep", "cook rice and vegetables", "health"),
    video("2", "Career advice", "when changing careers, talk to people already doing the job", "career"),
  ];
  const index = buildSearchIndex(videos);
  const results = searchWithIndex(videos, index, { query: "career change", limit: 5 });
  assert.equal(results[0]?.video.id, "2");
  assert.ok((results[0]?.score ?? 0) > 0);
});

function video(id: string, description: string, transcript: string, category: string): TikTokVideo {
  return {
    id,
    url: `https://www.tiktok.com/@user/video/${id}`,
    description,
    syncedAt: "2026-01-01T00:00:00.000Z",
    source: "url",
    hashtags: [],
    transcript: { text: transcript, generatedAt: "2026-01-01T00:00:00.000Z" },
    classification: { category, domain: "general", topics: [category] },
  };
}
