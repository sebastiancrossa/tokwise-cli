import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCollectionListEntries,
  extractItemsFromSuccessfulResponse,
  extractSecUidFromRehydrationHtml,
  extractUsernameFromRehydrationHtml,
  normalizeBookmarkFolder,
  normalizeCollectionInput,
  normalizeVideo,
  videosFromUrls,
} from "../src/tiktok.js";

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

test("extractItemsFromSuccessfulResponse rejects source error responses", () => {
  assert.throws(
    () =>
      extractItemsFromSuccessfulResponse(
        {
          status: "error",
          message: "Network error",
        },
        "collection",
      ),
    /Source collection fetch failed: Network error/,
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

test("normalizeCollectionInput keeps a full URL as-is", () => {
  const result = normalizeCollectionInput("https://www.tiktok.com/@user/collection/name-123");
  assert.equal(result.collectionUrl, "https://www.tiktok.com/@user/collection/name-123");
  assert.equal(result.collectionId, "123");
  assert.equal(result.username, "user");
});

test("normalizeCollectionInput expands an @user/collection/slug path", () => {
  const result = normalizeCollectionInput("@user/collection/name-123");
  assert.equal(result.collectionUrl, "https://www.tiktok.com/@user/collection/name-123");
  assert.equal(result.collectionId, "123");
  assert.equal(result.username, "user");
});

test("normalizeCollectionInput builds a URL from a bare slug using the fallback username", () => {
  const result = normalizeCollectionInput("name-123", "coach");
  assert.equal(result.collectionUrl, "https://www.tiktok.com/@coach/collection/name-123");
  assert.equal(result.collectionId, "123");
  assert.equal(result.username, "coach");
});

test("normalizeCollectionInput falls back to id-only when no username is known", () => {
  const result = normalizeCollectionInput("name-7300000000000000001");
  assert.equal(result.collectionUrl, undefined);
  assert.equal(result.collectionId, "7300000000000000001");
  assert.equal(result.username, undefined);
});

test("normalizeCollectionInput passes a pure numeric id through without a URL", () => {
  const result = normalizeCollectionInput("7300000000000000001", "coach");
  assert.equal(result.collectionUrl, undefined);
  assert.equal(result.collectionId, "7300000000000000001");
});

test("extractUsernameFromRehydrationHtml reads the logged-in uniqueId", () => {
  const data = {
    __DEFAULT_SCOPE__: {
      "webapp.app-context": {
        user: { uniqueId: "coach" },
      },
    },
  };
  const html = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></html>`;
  assert.equal(extractUsernameFromRehydrationHtml(html), "coach");
});

test("extractUsernameFromRehydrationHtml returns undefined for malformed html", () => {
  assert.equal(extractUsernameFromRehydrationHtml("<html><body>no data here</body></html>"), undefined);
  assert.equal(
    extractUsernameFromRehydrationHtml(
      '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">not json</script>',
    ),
    undefined,
  );
});

test("extractSecUidFromRehydrationHtml reads the logged-in app-context secUid", () => {
  const data = {
    __DEFAULT_SCOPE__: {
      "webapp.app-context": { user: { uniqueId: "coach", secUid: "MS4wLjABAAAAhome" } },
    },
  };
  const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`;
  assert.equal(extractSecUidFromRehydrationHtml(html), "MS4wLjABAAAAhome");
});

test("extractSecUidFromRehydrationHtml falls back to the user-detail scope", () => {
  const data = {
    __DEFAULT_SCOPE__: {
      "webapp.user-detail": { userInfo: { user: { secUid: "MS4wLjABAAAAprofile" } } },
    },
  };
  const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`;
  assert.equal(extractSecUidFromRehydrationHtml(html), "MS4wLjABAAAAprofile");
});

test("extractCollectionListEntries reads a root-level collectionList", () => {
  const entries = extractCollectionListEntries({
    statusCode: 0,
    collectionList: [{ id: "1", name: "Career" }],
    hasMore: false,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, "Career");
});

test("extractCollectionListEntries reads a result-wrapped collection_list", () => {
  const entries = extractCollectionListEntries({
    status: "success",
    result: { collection_list: [{ collectionId: "9", name: "Cooking" }] },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.collectionId, "9");
});

test("normalizeBookmarkFolder maps fields and builds a url from the username", () => {
  const folder = normalizeBookmarkFolder({ id: "123", name: "Startup ideas", total: 18 }, "coach");
  assert.equal(folder?.id, "123");
  assert.equal(folder?.name, "Startup ideas");
  assert.equal(folder?.itemCount, 18);
  assert.equal(folder?.kind, "collection");
  assert.equal(folder?.url, "https://www.tiktok.com/@coach/collection/startup-ideas-123");
});

test("normalizeBookmarkFolder tags the Favorites bucket", () => {
  const folder = normalizeBookmarkFolder({ collectionId: "7", name: "Favorites", itemCount: 4 });
  assert.equal(folder?.kind, "favorites");
  assert.equal(folder?.url, undefined);
});

test("normalizeBookmarkFolder skips entries without an id", () => {
  assert.equal(normalizeBookmarkFolder({ name: "No id" }), undefined);
});
