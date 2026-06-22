import test from "node:test";
import assert from "node:assert/strict";
import { classifyRegex } from "../src/classify.js";
import type { TikTokVideo } from "../src/types.js";

test("regex classifier identifies career and work advice", () => {
  const result = classifyRegex({
    id: "career",
    url: "https://www.tiktok.com/@user/video/1",
    description: "How to prepare for a job interview and earn a promotion",
    syncedAt: "2026-01-01T00:00:00.000Z",
    source: "url",
    hashtags: ["careeradvice"],
  } satisfies TikTokVideo);

  assert.equal(result.category, "career");
  assert.equal(result.domain, "work-and-ambition");
});
