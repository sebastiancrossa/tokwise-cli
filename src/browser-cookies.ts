import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./process.js";

export type ChromiumBrowser = "chrome" | "brave" | "edge" | "arc" | "dia" | "chromium";

export const SUPPORTED_BROWSERS: ChromiumBrowser[] = ["chrome", "brave", "edge", "arc", "dia", "chromium"];

interface ChannelConfig {
  dir: string;
  service: string;
  account: string;
}

const CHANNELS: Record<ChromiumBrowser, ChannelConfig> = {
  chrome: { dir: "Google/Chrome", service: "Chrome Safe Storage", account: "Chrome" },
  brave: { dir: "BraveSoftware/Brave-Browser", service: "Brave Safe Storage", account: "Brave" },
  edge: { dir: "Microsoft Edge", service: "Microsoft Edge Safe Storage", account: "Microsoft Edge" },
  arc: { dir: "Arc/User Data", service: "Arc Safe Storage", account: "Arc" },
  dia: { dir: "Dia/User Data", service: "Dia Safe Storage", account: "Dia" },
  chromium: { dir: "Chromium", service: "Chromium Safe Storage", account: "Chromium" },
};

export interface ChromiumTarget {
  cookieDbPath: string;
  keychainService: string;
  keychainAccount: string;
}

export interface CookieRow {
  host_key: string;
  name: string;
  encrypted_hex: string;
}

export interface ExtractedCookie {
  cookie: string;
  browser: ChromiumBrowser;
  profile: string;
}

export function isChromiumBrowser(value: string): value is ChromiumBrowser {
  return (SUPPORTED_BROWSERS as string[]).includes(value);
}

export function chromiumTargets(browser: ChromiumBrowser, profile: string): ChromiumTarget {
  const channel = CHANNELS[browser];
  return {
    cookieDbPath: path.join(os.homedir(), "Library", "Application Support", channel.dir, profile, "Cookies"),
    keychainService: channel.service,
    keychainAccount: channel.account,
  };
}

export function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

export function decryptCookieValue(encrypted: Buffer, key: Buffer, hostKey?: string): string {
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  const body = prefix === "v10" || prefix === "v11" ? encrypted.subarray(3) : encrypted;
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(body), decipher.final()]);
  const unpadded = removePkcs7Padding(padded);
  const stripped = stripDomainHashPrefix(unpadded, hostKey);
  return stripped.toString("utf8");
}

function removePkcs7Padding(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer;
  const padLength = buffer[buffer.length - 1] ?? 0;
  if (padLength > 0 && padLength <= 16 && padLength <= buffer.length) {
    return buffer.subarray(0, buffer.length - padLength);
  }
  return buffer;
}

// Recent Chrome builds prepend a 32-byte SHA-256 hash of the cookie's domain to
// the decrypted plaintext. When the host key is known and matches that prefix,
// strip it so the clean cookie value is recovered.
function stripDomainHashPrefix(buffer: Buffer, hostKey?: string): Buffer {
  if (!hostKey || buffer.length < 32) return buffer;
  const domainHash = crypto.createHash("sha256").update(hostKey).digest();
  if (buffer.subarray(0, 32).equals(domainHash)) {
    return buffer.subarray(32);
  }
  return buffer;
}

export function buildCookieHeader(rows: CookieRow[], key: Buffer): string {
  const pairs: string[] = [];
  for (const row of rows) {
    if (!row.name || !row.encrypted_hex) continue;
    try {
      const value = decryptCookieValue(Buffer.from(row.encrypted_hex, "hex"), key, row.host_key);
      if (value) pairs.push(`${row.name}=${value}`);
    } catch {
      continue;
    }
  }
  return pairs.join("; ");
}

export async function readKeychainPassword(service: string, account: string): Promise<string> {
  const result = await runProcess("security", ["find-generic-password", "-w", "-a", account, "-s", service]);
  if (result.code !== 0) {
    throw new Error(
      `Keychain access for "${service}" failed. Re-run and click Allow when macOS asks, or pass --cookie manually.`,
    );
  }
  const password = result.stdout.trim();
  if (!password) {
    throw new Error(`Keychain returned an empty password for "${service}".`);
  }
  return password;
}

export async function readTikTokCookieRows(cookieDbPath: string): Promise<CookieRow[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tokwise-cookies-"));
  const tmpDb = path.join(tmpDir, "Cookies");
  try {
    await fs.copyFile(cookieDbPath, tmpDb);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        await fs.copyFile(`${cookieDbPath}${suffix}`, `${tmpDb}${suffix}`);
      } catch {
        // Sidecar files are optional; ignore when absent.
      }
    }
    const sql =
      "SELECT host_key, name, hex(encrypted_value) AS encrypted_hex FROM cookies WHERE host_key LIKE '%tiktok.com%';";
    const result = await runProcess("/usr/bin/sqlite3", ["-json", tmpDb, sql]);
    if (result.code !== 0) {
      throw new Error(`Could not read cookies database: ${result.stderr || result.stdout || "unknown error"}`);
    }
    return parseSqliteJsonRows(result.stdout);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export function parseSqliteJsonRows(stdout: string): CookieRow[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const host_key = typeof record.host_key === "string" ? record.host_key : "";
    const name = typeof record.name === "string" ? record.name : "";
    const encrypted_hex = typeof record.encrypted_hex === "string" ? record.encrypted_hex : "";
    return [{ host_key, name, encrypted_hex }];
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function extractTikTokCookie(options: {
  browser?: ChromiumBrowser;
  profile: string;
}): Promise<ExtractedCookie> {
  const candidates = options.browser ? [options.browser] : SUPPORTED_BROWSERS;
  const detected: ChromiumBrowser[] = [];
  for (const browser of candidates) {
    const target = chromiumTargets(browser, options.profile);
    if (await fileExists(target.cookieDbPath)) detected.push(browser);
  }

  if (detected.length === 0) {
    throw new Error(
      `No supported Chromium browser found on macOS for profile "${options.profile}" (looked for: ${candidates.join(", ")}). Use \`tw auth set --cookie\` instead.`,
    );
  }

  for (const browser of detected) {
    const target = chromiumTargets(browser, options.profile);
    const rows = await readTikTokCookieRows(target.cookieDbPath);
    if (rows.length === 0) continue;
    const password = await readKeychainPassword(target.keychainService, target.keychainAccount);
    const cookie = buildCookieHeader(rows, deriveKey(password));
    if (!cookie) continue;
    return { cookie, browser, profile: options.profile };
  }

  throw new Error(
    `Found ${detected.join(", ")} but no tiktok.com cookies in profile "${options.profile}". Open tiktok.com in your browser, log in, then retry.`,
  );
}
