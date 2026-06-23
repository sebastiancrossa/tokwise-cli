import fs from "node:fs/promises";
import path from "node:path";
import type { TikTokMedia, TikTokVideo } from "./types.js";
import { audioDir, ensureDataDirs, mediaDir } from "./paths.js";
import { runProcess } from "./process.js";
import { sanitizeFilePart } from "./store.js";

export interface DownloadOptions {
  ytDlp?: string;
  proxy?: string;
  cookiesFile?: string;
  cookiesFromBrowser?: string;
  audioOnly?: boolean;
  audioFormat?: string;
  force?: boolean;
}

export interface DownloadOutcome {
  id: string;
  changed: boolean;
  media: TikTokMedia;
}

// TikTok advertises aac on every format, but without yt-dlp impersonation its
// HEVC (bytevc1) "best" formats download video-only. That breaks audio
// extraction ("unable to obtain file audio codec") and yields silent videos.
// h264 formats carry a real audio track, so prefer them and only fall back to
// yt-dlp's default best when no h264 rendition exists.
const PREFERRED_FORMAT = "b[vcodec^=h264]/b";

export async function downloadMedia(video: TikTokVideo, options: DownloadOptions = {}): Promise<DownloadOutcome> {
  ensureDataDirs();
  const command = options.ytDlp ?? "yt-dlp";
  const outputDir = options.audioOnly ? audioDir() : mediaDir();
  const safeId = sanitizeFilePart(video.id);
  const existingPath = options.audioOnly ? video.media?.audioPath : video.media?.videoPath;
  if (!options.force && existingPath && (await exists(existingPath))) {
    return { id: video.id, changed: false, media: video.media ?? {} };
  }

  const before = new Set(await listFiles(outputDir));
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    // Redownload instead of reusing a leftover intermediate. A prior failed
    // audio extraction can leave a video-only <id>.mp4 behind; yt-dlp would
    // otherwise treat it as "already downloaded" and keep failing to extract
    // audio from that stale file on every subsequent run.
    "--force-overwrites",
    "-f",
    PREFERRED_FORMAT,
    "--print",
    "after_move:filepath",
    "-o",
    path.join(outputDir, `${safeId}.%(ext)s`),
  ];
  if (options.proxy) args.push("--proxy", options.proxy);
  if (options.cookiesFile) args.push("--cookies", options.cookiesFile);
  if (options.cookiesFromBrowser) args.push("--cookies-from-browser", options.cookiesFromBrowser);
  if (options.audioOnly) {
    args.push("-x", "--audio-format", options.audioFormat ?? "m4a");
  } else {
    args.push("--write-info-json");
  }
  args.push(downloadTargetUrl(video));

  const result = await runProcess(command, args);
  if (result.code !== 0) {
    throw new Error(`yt-dlp failed for ${video.id}: ${result.stderr || result.stdout}`);
  }

  const printed = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => path.isAbsolute(line));
  const discovered = printed ?? (await newestCreatedFile(outputDir, before, safeId));
  const nextMedia: TikTokMedia = { ...(video.media ?? {}), downloadedAt: new Date().toISOString() };
  if (options.audioOnly) nextMedia.audioPath = discovered;
  else {
    nextMedia.videoPath = discovered;
    const infoPath = await findInfoJson(outputDir, safeId);
    if (infoPath) nextMedia.infoJsonPath = infoPath;
  }
  return { id: video.id, changed: true, media: nextMedia };
}

export function downloadTargetUrl(video: TikTokVideo): string {
  const target = video.canonicalUrl ?? video.url;
  if (isMalformedTikTokVideoUrl(target)) {
    throw new Error(
      `${video.id} does not have a valid source video URL (${target}). Remove this malformed record or resync the source with the latest CLI.`,
    );
  }
  return target;
}

function isMalformedTikTokVideoUrl(url: string): boolean {
  if (!/https?:\/\/(?:www\.)?tiktok\.com\//i.test(url)) return false;
  if (/\/404(?:[/?#]|$)/i.test(url)) return true;
  const videoMatch = url.match(/\/video\/([^/?#]+)/i);
  return Boolean(videoMatch && !/^\d{8,}$/.test(videoMatch[1] ?? ""));
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function newestCreatedFile(dir: string, before: Set<string>, prefix: string): Promise<string | undefined> {
  const candidates = (await listFiles(dir)).filter((filePath) => !before.has(filePath) && path.basename(filePath).startsWith(prefix));
  let newest: { filePath: string; mtimeMs: number } | undefined;
  for (const filePath of candidates) {
    const stat = await fs.stat(filePath);
    if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { filePath, mtimeMs: stat.mtimeMs };
  }
  return newest?.filePath;
}

async function findInfoJson(dir: string, prefix: string): Promise<string | undefined> {
  const files = await listFiles(dir);
  return files.find((filePath) => path.basename(filePath).startsWith(prefix) && filePath.endsWith(".info.json"));
}
