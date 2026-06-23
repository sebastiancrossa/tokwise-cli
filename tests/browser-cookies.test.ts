import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  buildCookieHeader,
  chromiumTargets,
  decryptCookieValue,
  deriveKey,
  parseSqliteJsonRows,
} from "../src/browser-cookies.js";

function encryptCookieValue(value: string, key: Buffer, hostKey?: string): Buffer {
  const iv = Buffer.alloc(16, 0x20);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  const plaintext = hostKey
    ? Buffer.concat([crypto.createHash("sha256").update(hostKey).digest(), Buffer.from(value, "utf8")])
    : Buffer.from(value, "utf8");
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "latin1"), body]);
}

test("deriveKey matches the documented Chromium PBKDF2 vector", () => {
  const key = deriveKey("peanuts");
  assert.equal(key.length, 16);
  assert.equal(key.toString("hex"), "d9a09d499b4e1b7461f28e67972c6dbd");
});

test("decryptCookieValue round-trips a v10 value", () => {
  const key = deriveKey("test-password");
  const encrypted = encryptCookieValue("session-abc123", key);
  assert.equal(decryptCookieValue(encrypted, key), "session-abc123");
});

test("decryptCookieValue strips the 32-byte domain hash prefix", () => {
  const key = deriveKey("test-password");
  const hostKey = ".tiktok.com";
  const encrypted = encryptCookieValue("session-with-prefix", key, hostKey);
  assert.equal(decryptCookieValue(encrypted, key, hostKey), "session-with-prefix");
});

test("decryptCookieValue keeps the value when the prefix does not match the host", () => {
  const key = deriveKey("test-password");
  const encrypted = encryptCookieValue("plain-value", key);
  assert.equal(decryptCookieValue(encrypted, key, ".tiktok.com"), "plain-value");
});

test("buildCookieHeader joins decrypted name=value pairs", () => {
  const key = deriveKey("test-password");
  const rows = [
    { host_key: ".tiktok.com", name: "sessionid", encrypted_hex: encryptCookieValue("abc", key, ".tiktok.com").toString("hex") },
    { host_key: ".tiktok.com", name: "tt_csrf_token", encrypted_hex: encryptCookieValue("xyz", key, ".tiktok.com").toString("hex") },
  ];
  assert.equal(buildCookieHeader(rows, key), "sessionid=abc; tt_csrf_token=xyz");
});

test("buildCookieHeader skips rows that fail to decrypt", () => {
  const key = deriveKey("test-password");
  const rows = [
    { host_key: ".tiktok.com", name: "sessionid", encrypted_hex: encryptCookieValue("abc", key, ".tiktok.com").toString("hex") },
    { host_key: ".tiktok.com", name: "broken", encrypted_hex: "v10deadbeef" },
  ];
  assert.equal(buildCookieHeader(rows, key), "sessionid=abc");
});

test("chromiumTargets resolves cookie DB path and keychain identity", () => {
  const target = chromiumTargets("brave", "Default");
  assert.equal(
    target.cookieDbPath,
    path.join(os.homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "Default", "Cookies"),
  );
  assert.equal(target.keychainService, "Brave Safe Storage");
  assert.equal(target.keychainAccount, "Brave");
});

test("chromiumTargets honors a non-default profile for chrome", () => {
  const target = chromiumTargets("chrome", "Profile 1");
  assert.equal(
    target.cookieDbPath,
    path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "Profile 1", "Cookies"),
  );
  assert.equal(target.keychainService, "Chrome Safe Storage");
});

test("parseSqliteJsonRows parses the sqlite3 -json output", () => {
  const rows = parseSqliteJsonRows(
    '[{"host_key":".tiktok.com","name":"sessionid","encrypted_hex":"763130AA"}]',
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { host_key: ".tiktok.com", name: "sessionid", encrypted_hex: "763130AA" });
});

test("parseSqliteJsonRows returns empty for empty output", () => {
  assert.deepEqual(parseSqliteJsonRows(""), []);
  assert.deepEqual(parseSqliteJsonRows("   "), []);
});
