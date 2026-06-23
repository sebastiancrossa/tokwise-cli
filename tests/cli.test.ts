import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isCliEntrypoint } from "../src/cli.js";

test("CLI entrypoint check accepts npm-link style symlinks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-entrypoint-"));
  const target = path.join(dir, "cli.js");
  const link = path.join(dir, "tt");
  fs.writeFileSync(target, "#!/usr/bin/env node\n");
  fs.symlinkSync(target, link);

  assert.equal(isCliEntrypoint(pathToFileURL(target).href, link), true);
});
