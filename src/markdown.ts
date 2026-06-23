import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TikTokVideo } from "./types.js";
import {
  ensureDataDirs,
  libraryDir,
  markdownCategoriesDir,
  markdownDomainsDir,
  markdownVideosDir,
} from "./paths.js";
import { sanitizeFilePart } from "./store.js";

export interface MarkdownExportResult {
  written: number;
  skipped: number;
  files: string[];
}

export async function exportMarkdown(videos: TikTokVideo[], options?: { changedOnly?: boolean }): Promise<MarkdownExportResult> {
  ensureDataDirs();
  let written = 0;
  let skipped = 0;
  const files: string[] = [];
  for (const video of videos) {
    const filePath = videoMarkdownPath(video);
    const body = renderVideoMarkdown(video);
    if (options?.changedOnly && (await sameContent(filePath, body))) {
      skipped += 1;
      continue;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
    written += 1;
    files.push(filePath);
  }
  return { written, skipped, files };
}

export async function compileWiki(videos: TikTokVideo[]): Promise<MarkdownExportResult> {
  const exported = await exportMarkdown(videos);
  await fs.mkdir(markdownCategoriesDir(), { recursive: true });
  await fs.mkdir(markdownDomainsDir(), { recursive: true });
  const byCategory = groupBy(videos, (video) => video.classification?.category ?? "uncategorized");
  const byDomain = groupBy(videos, (video) => video.classification?.domain ?? "general");
  const files = [...exported.files];

  for (const [category, group] of byCategory) {
    const filePath = path.join(markdownCategoriesDir(), `${sanitizeFilePart(category)}.md`);
    await fs.writeFile(filePath, renderGroupPage("Category", category, group), "utf8");
    files.push(filePath);
  }
  for (const [domain, group] of byDomain) {
    const filePath = path.join(markdownDomainsDir(), `${sanitizeFilePart(domain)}.md`);
    await fs.writeFile(filePath, renderGroupPage("Domain", domain, group), "utf8");
    files.push(filePath);
  }

  const indexPath = path.join(libraryDir(), "index.md");
  await fs.writeFile(indexPath, renderIndex(videos, byCategory, byDomain), "utf8");
  files.push(indexPath);
  return { written: files.length, skipped: exported.skipped, files };
}

export function videoMarkdownPath(video: TikTokVideo): string {
  return path.join(markdownVideosDir(), `${sanitizeFilePart(video.id)}.md`);
}

export function renderVideoMarkdown(video: TikTokVideo): string {
  const title = video.description?.split(/\r?\n/)[0]?.slice(0, 80) || `Clip ${video.id}`;
  const category = video.classification?.category ?? "uncategorized";
  const domain = video.classification?.domain ?? "general";
  const topics = video.classification?.topics ?? [];
  return [
    "---",
    `id: ${yamlString(video.id)}`,
    `url: ${yamlString(video.canonicalUrl ?? video.url)}`,
    `author: ${yamlString(video.author?.username ?? "")}`,
    `created_at: ${yamlString(video.createdAt ?? "")}`,
    `category: ${yamlString(category)}`,
    `domain: ${yamlString(domain)}`,
    `topics: [${topics.map(yamlString).join(", ")}]`,
    "---",
    "",
    `# ${title}`,
    "",
    `Source: ${video.canonicalUrl ?? video.url}`,
    video.author?.username ? `Author: @${video.author.username}` : "",
    `Category: [[categories/${sanitizeFilePart(category)}|${category}]]`,
    `Domain: [[domains/${sanitizeFilePart(domain)}|${domain}]]`,
    "",
    "## Summary",
    "",
    video.classification?.summary ?? "No summary yet.",
    "",
    "## Description",
    "",
    video.description ?? "",
    "",
    "## Transcript",
    "",
    video.transcript?.text ?? "_No transcript yet._",
    "",
    "## Metadata",
    "",
    `- Hashtags: ${video.hashtags.map((tag) => `#${tag}`).join(" ") || "none"}`,
    `- Music: ${[video.music?.title, video.music?.author].filter(Boolean).join(" - ") || "unknown"}`,
    `- Plays: ${video.stats?.plays ?? "unknown"}`,
    `- Likes: ${video.stats?.likes ?? "unknown"}`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function lintWiki(options?: { fix?: boolean }): Promise<{ broken: string[]; fixed: number }> {
  const files = await listMarkdownFiles(libraryDir());
  const existing = new Set(files.map((file) => stripMd(path.relative(libraryDir(), file))));
  const broken: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const link of extractWikiLinks(text)) {
      const target = stripAlias(link);
      if (/^https?:\/\//.test(target)) continue;
      if (!existing.has(stripMd(target))) broken.push(`${path.relative(libraryDir(), file)} -> ${target}`);
    }
  }
  let fixed = 0;
  if (options?.fix) {
    for (const item of broken) {
      const target = item.split(" -> ")[1];
      if (!target) continue;
      const filePath = path.join(libraryDir(), `${stripMd(target)}.md`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, `# ${path.basename(target)}\n\n`, "utf8");
        fixed += 1;
      }
    }
  }
  return { broken, fixed };
}

function renderIndex(
  videos: TikTokVideo[],
  byCategory: Map<string, TikTokVideo[]>,
  byDomain: Map<string, TikTokVideo[]>,
): string {
  return [
    "# Tokwise Library",
    "",
    `${videos.length} videos. ${videos.filter((video) => video.transcript?.text).length} transcripts.`,
    "",
    "## Categories",
    "",
    ...[...byCategory.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, group]) => `- [[categories/${sanitizeFilePart(category)}|${category}]] (${group.length})`),
    "",
    "## Domains",
    "",
    ...[...byDomain.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([domain, group]) => `- [[domains/${sanitizeFilePart(domain)}|${domain}]] (${group.length})`),
    "",
    "## Recent Videos",
    "",
    ...videos.slice(0, 50).map((video) => `- [[videos/${sanitizeFilePart(video.id)}|${videoTitle(video)}]]`),
    "",
  ].join("\n");
}

function renderGroupPage(kind: string, name: string, videos: TikTokVideo[]): string {
  return [
    `# ${kind}: ${name}`,
    "",
    `${videos.length} videos.`,
    "",
    ...videos.map((video) => `- [[videos/${sanitizeFilePart(video.id)}|${videoTitle(video)}]]`),
    "",
  ].join("\n");
}

function videoTitle(video: TikTokVideo): string {
  return video.description?.replace(/\s+/g, " ").slice(0, 80) || video.id;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

async function sameContent(filePath: string, body: string): Promise<boolean> {
  try {
    return crypto.createHash("sha256").update(await fs.readFile(filePath, "utf8")).digest("hex") === crypto.createHash("sha256").update(body).digest("hex");
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function extractWikiLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]).filter((value): value is string => Boolean(value));
}

function stripAlias(link: string): string {
  return link.split("|")[0] ?? link;
}

function stripMd(link: string): string {
  return link.replace(/\.md$/i, "");
}
