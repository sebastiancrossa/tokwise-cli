import test from "node:test";
import assert from "node:assert/strict";
import { shortId, videoReference, videoTitle } from "../src/reference.js";
import { findVideo } from "../src/store.js";
import type { TikTokVideo } from "../src/types.js";

function video(overrides: Partial<TikTokVideo> & { id: string }): TikTokVideo {
  return {
    url: `https://www.tiktok.com/@user/video/${overrides.id}`,
    syncedAt: "2026-01-01T00:00:00.000Z",
    source: "url",
    hashtags: [],
    ...overrides,
  };
}

test("videoReference combines author and date", () => {
  const ref = videoReference(
    video({
      id: "7570832472749952278",
      description: "Why fiction beats self-help",
      createdAt: "2024-03-15T00:00:00.000Z",
      author: { username: "thephilosopher" },
    }),
  );
  assert.equal(ref, "@thephilosopher (Mar 2024)");
});

test("videoReference omits date when no timestamp exists", () => {
  const ref = videoReference(
    video({ id: "123456789012", description: "A clip", author: { username: "x" } }),
  );
  assert.equal(ref, "@x");
});

test("videoReference falls back to display name then unknown", () => {
  const withDisplay = videoReference(
    video({ id: "12345678", description: "Clip", author: { displayName: "The Author" } }),
  );
  assert.equal(withDisplay, "The Author");
  const noAuthor = videoReference(video({ id: "12345678", description: "Clip" }));
  assert.equal(noAuthor, "unknown");
});

test("videoTitle falls back through summary, topic, then Untitled clip", () => {
  assert.equal(videoTitle(video({ id: "1", classification: { summary: "A summary" } })), "A summary");
  assert.equal(videoTitle(video({ id: "1", classification: { topics: ["careers"] } })), "careers");
  assert.equal(videoTitle(video({ id: "1" })), "Untitled clip");
});

test("videoTitle strips trailing hashtags and caps length", () => {
  assert.equal(videoTitle(video({ id: "1", description: "Real talk #fyp #advice" })), "Real talk");
  const long = "a".repeat(80);
  const title = videoTitle(video({ id: "1", description: long }));
  assert.ok(title.length <= 60);
  assert.ok(title.endsWith("\u2026"));
});

test("shortId returns the last 8 digits", () => {
  assert.equal(shortId(video({ id: "7570832472749952278" })), "49952278");
});

test("findVideo resolves a short id suffix", () => {
  const videos = [
    video({ id: "7570832472749952278" }),
    video({ id: "1111111122223333" }),
  ];
  assert.equal(findVideo(videos, "49952278")?.id, "7570832472749952278");
});
