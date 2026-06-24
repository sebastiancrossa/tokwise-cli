import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Preferences, SyncResult, TikTokClassification, TikTokVideo } from "./types.js";
import { authPath, ensureDataDirs, preferencesPath, videosJsonlPath } from "./paths.js";
import { readJsonFile, readJsonl, writeJsonFile, writeJsonl } from "./jsonl.js";

export function stableHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

export function sanitizeFilePart(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}

export async function loadVideos(): Promise<TikTokVideo[]> {
  ensureDataDirs();
  return readJsonl<TikTokVideo>(videosJsonlPath());
}

export async function saveVideos(videos: TikTokVideo[]): Promise<void> {
  ensureDataDirs();
  const sorted = [...videos].sort((a, b) => {
    const aTime = a.savedAt ?? a.createdAt ?? a.syncedAt;
    const bTime = b.savedAt ?? b.createdAt ?? b.syncedAt;
    return bTime.localeCompare(aTime);
  });
  await writeJsonl(videosJsonlPath(), sorted);
}

export function mergeVideo(existing: TikTokVideo | undefined, incoming: TikTokVideo): TikTokVideo {
  if (!existing) return incoming;
  const classification = mergeClassification(existing.classification, incoming.classification);
  return {
    ...existing,
    ...incoming,
    savedAt: incoming.savedAt ?? existing.savedAt,
    syncedAt: incoming.syncedAt,
    author: { ...existing.author, ...incoming.author },
    stats: { ...existing.stats, ...incoming.stats },
    media: {
      ...existing.media,
      ...incoming.media,
      videoPath: existing.media?.videoPath ?? incoming.media?.videoPath,
      audioPath: existing.media?.audioPath ?? incoming.media?.audioPath,
      infoJsonPath: existing.media?.infoJsonPath ?? incoming.media?.infoJsonPath,
      downloadedAt: existing.media?.downloadedAt ?? incoming.media?.downloadedAt,
    },
    transcript: existing.transcript ?? incoming.transcript,
    classification,
    hashtags: uniqueStrings([...existing.hashtags, ...incoming.hashtags]),
    raw: incoming.raw ?? existing.raw,
  };
}

function mergeClassification(
  existing: TikTokClassification | undefined,
  incoming: TikTokClassification | undefined,
): TikTokClassification | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    ...existing,
    ...incoming,
    topics: uniqueStrings([...(existing.topics ?? []), ...(incoming.topics ?? [])]),
  };
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export async function mergeVideos(incoming: TikTokVideo[], options?: { rebuild?: boolean }): Promise<SyncResult> {
  const existing = options?.rebuild ? [] : await loadVideos();
  const existingById = new Map(existing.map((video) => [video.id, video]));
  const before = new Map(existing.map((video) => [video.id, JSON.stringify(video)]));

  for (const video of incoming) {
    existingById.set(video.id, mergeVideo(existingById.get(video.id), video));
  }

  const merged = [...existingById.values()];
  await saveVideos(merged);

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const video of incoming) {
    const old = before.get(video.id);
    if (old == null) {
      added += 1;
    } else if (old === JSON.stringify(existingById.get(video.id))) {
      unchanged += 1;
    } else {
      updated += 1;
    }
  }

  return { added, updated, unchanged, total: merged.length, ids: incoming.map((video) => video.id) };
}

export function findVideo(videos: TikTokVideo[], query: string): TikTokVideo | undefined {
  const normalized = query.trim();
  return (
    videos.find((video) => video.id === normalized) ??
    videos.find((video) => video.id.startsWith(normalized)) ??
    videos.find((video) => video.url === normalized || video.canonicalUrl === normalized)
  );
}

export async function updateVideosById(
  updates: Map<string, Partial<TikTokVideo> | ((video: TikTokVideo) => TikTokVideo)>,
): Promise<TikTokVideo[]> {
  const videos = await loadVideos();
  const next = videos.map((video) => {
    const update = updates.get(video.id);
    if (!update) return video;
    if (typeof update === "function") return update(video);
    return mergeVideo(video, { ...video, ...update, syncedAt: update.syncedAt ?? video.syncedAt });
  });
  await saveVideos(next);
  return next;
}

export async function readTextInput(filePath: string): Promise<string> {
  if (filePath === "-") {
    return new Promise<string>((resolve, reject) => {
      let body = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        body += chunk;
      });
      process.stdin.on("end", () => resolve(body));
      process.stdin.on("error", reject);
    });
  }
  return fs.readFile(filePath, "utf8");
}

export async function loadPreferences(): Promise<Preferences> {
  return readJsonFile<Preferences>(preferencesPath(), {});
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await writeJsonFile(preferencesPath(), preferences, 0o600);
}

export interface SavedAuth {
  cookie?: string;
  username?: string;
  updatedAt?: string;
  source?: "manual" | "browser";
  browser?: string;
  profile?: string;
}

export async function loadAuth(): Promise<SavedAuth> {
  return readJsonFile<SavedAuth>(authPath(), {});
}

export async function saveAuth(auth: SavedAuth): Promise<void> {
  await writeJsonFile(authPath(), auth, 0o600);
}

export async function clearAuth(): Promise<void> {
  try {
    await fs.rm(authPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function loadCookie(options?: { cookie?: string; cookieFile?: string }): Promise<string | undefined> {
  if (options?.cookie) return options.cookie;
  if (options?.cookieFile) return (await fs.readFile(options.cookieFile, "utf8")).trim();
  return (await loadAuth()).cookie;
}

export function resolveMaybeRelative(filePath: string, cwd = process.cwd()): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}
