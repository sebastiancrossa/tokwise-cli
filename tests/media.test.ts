import test from "node:test";
import assert from "node:assert/strict";
import { downloadTargetUrl } from "../src/media.js";
import type { TikTokVideo } from "../src/types.js";

test("downloadTargetUrl rejects hashed fake TikTok video urls before yt-dlp", () => {
  const video: TikTokVideo = {
    id: "85937719415fc3cf",
    url: "https://www.tiktok.com/404?fromUrl=/video/85937719415fc3cf",
    canonicalUrl: "https://www.tiktok.com/video/85937719415fc3cf",
    syncedAt: "2026-01-01T00:00:00.000Z",
    source: "collection",
    hashtags: [],
  };

  assert.throws(() => downloadTargetUrl(video), /does not have a valid TikTok video URL/);
});
