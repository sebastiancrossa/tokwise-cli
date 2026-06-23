import test from "node:test";
import assert from "node:assert/strict";
import { extractItemsFromSuccessfulResponse, normalizeVideo, videosFromUrls } from "../src/tiktok.js";

test("normalizeVideo maps collection response fields", () => {
  const video = normalizeVideo(
    {
      id: "7500000000000000001",
      desc: "Set better boundaries #life",
      createTime: 1_700_000_000,
      author: { uniqueId: "coach", nickname: "Coach" },
      statistics: { playCount: 100, diggCount: 10, commentCount: 2, shareCount: 3, collectCount: 4 },
      textExtra: [{ hashtagName: "life" }, { hashtagName: "boundaries" }],
      video: { duration: 42, cover: "cover.jpg", playAddr: "play.mp4" },
      music: { id: "m1", title: "Original sound", authorName: "Coach" },
    },
    { source: "collection", collectionId: "c1", collectionName: "Advice" },
  );

  assert.equal(video.author?.username, "coach");
  assert.equal(video.canonicalUrl, "https://www.tiktok.com/@coach/video/7500000000000000001");
  assert.equal(video.stats?.likes, 10);
  assert.deepEqual(video.hashtags, ["life", "boundaries"]);
});

test("videosFromUrls infers video ids", () => {
  const [video] = videosFromUrls(["https://www.tiktok.com/@user/video/7123456789012345678"]);
  assert.equal(video?.id, "7123456789012345678");
});

test("extractItemsFromSuccessfulResponse reads wrapped collection item lists", () => {
  const items = extractItemsFromSuccessfulResponse(
    {
      status: "success",
      result: {
        itemList: [{ id: "7123456789012345678", desc: "real video" }],
      },
    },
    "collection",
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "7123456789012345678");
});

test("extractItemsFromSuccessfulResponse rejects TikTok error responses", () => {
  assert.throws(
    () =>
      extractItemsFromSuccessfulResponse(
        {
          status: "error",
          message: "Network error",
        },
        "collection",
      ),
    /TikTok collection fetch failed: Network error/,
  );
});

test("extractItemsFromSuccessfulResponse does not treat response wrappers as videos", () => {
  const items = extractItemsFromSuccessfulResponse(
    {
      status: "success",
      result: {
        hasMore: false,
      },
    },
    "collection",
  );

  assert.deepEqual(items, []);
});
