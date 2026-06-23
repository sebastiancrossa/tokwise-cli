import test from "node:test";
import assert from "node:assert/strict";
import { runProcess } from "../src/process.js";

test("runProcess reports missing commands without throwing raw spawn errors", async () => {
  const result = await runProcess("definitely-not-a-real-command-for-tokwise", []);

  assert.equal(result.code, 127);
  assert.match(result.stderr, /Command not found/);
  assert.match(result.stderr, /definitely-not-a-real-command-for-tokwise/);
});
