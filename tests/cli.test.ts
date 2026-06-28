import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hasExplicitSource, isCliEntrypoint, progressLabel } from "../src/cli.js";

test("CLI entrypoint check accepts npm-link style symlinks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokwise-entrypoint-"));
  const target = path.join(dir, "cli.js");
  const link = path.join(dir, "tw");
  fs.writeFileSync(target, "#!/usr/bin/env node\n");
  fs.symlinkSync(target, link);

  assert.equal(isCliEntrypoint(pathToFileURL(target).href, link), true);
});

const emptySync = {
  collection: [],
  playlist: [],
  liked: [],
  user: [],
  searchVideo: [],
  url: [],
};

test("hasExplicitSource is false for bare sync (routes to interactive picker)", () => {
  assert.equal(hasExplicitSource({ ...emptySync }), false);
});

test("hasExplicitSource is true when a source flag is supplied", () => {
  assert.equal(hasExplicitSource({ ...emptySync, collection: ["name-123"] }), true);
  assert.equal(hasExplicitSource({ ...emptySync, urlsFile: "urls.txt" }), true);
  assert.equal(hasExplicitSource({ ...emptySync, input: "export.jsonl" }), true);
});

test("progressLabel appends the collection label only when present", () => {
  assert.equal(progressLabel("media"), "media");
  assert.equal(progressLabel("media", undefined), "media");
  assert.equal(progressLabel("media", "Career advice"), "media \u00b7 Career advice");
});
