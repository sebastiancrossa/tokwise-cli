import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function dataDir(): string {
  return path.resolve(
    expandHome(process.env.TT_DATA_DIR ?? process.env.TIKTOK_THEORY_DATA_DIR ?? "~/.tiktoktheory"),
  );
}

export function videosDir(): string {
  return path.join(dataDir(), "videos");
}

export function mediaDir(): string {
  return path.join(videosDir(), "media");
}

export function audioDir(): string {
  return path.join(videosDir(), "audio");
}

export function transcriptDir(): string {
  return path.join(videosDir(), "transcripts");
}

export function videosJsonlPath(): string {
  return path.join(videosDir(), "videos.jsonl");
}

export function searchIndexPath(): string {
  return path.join(videosDir(), "search-index.json");
}

export function authPath(): string {
  return path.join(videosDir(), "auth.json");
}

export function preferencesPath(): string {
  return path.join(dataDir(), "preferences.json");
}

export function libraryDir(): string {
  return path.resolve(expandHome(process.env.TT_LIBRARY_DIR ?? path.join(dataDir(), "library")));
}

export function markdownVideosDir(): string {
  return path.join(libraryDir(), "videos");
}

export function markdownCategoriesDir(): string {
  return path.join(libraryDir(), "categories");
}

export function markdownDomainsDir(): string {
  return path.join(libraryDir(), "domains");
}

export function commandsDir(): string {
  return path.resolve(expandHome(process.env.TT_COMMANDS_DIR ?? path.join(dataDir(), "commands")));
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureDataDirs(): void {
  for (const dir of [
    dataDir(),
    videosDir(),
    mediaDir(),
    audioDir(),
    transcriptDir(),
    libraryDir(),
    markdownVideosDir(),
    markdownCategoriesDir(),
    markdownDomainsDir(),
    commandsDir(),
  ]) {
    ensureDir(dir);
  }
}

export function toDisplayPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
