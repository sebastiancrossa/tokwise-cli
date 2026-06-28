import type { TikTokVideo } from "./types.js";
import { c } from "./render.js";

const TITLE_MAX = 60;
const SHORT_ID_LENGTH = 8;

export function videoTitle(video: TikTokVideo): string {
  const candidates = [
    video.description?.split(/\r?\n/)[0],
    video.classification?.summary,
    video.classification?.topics?.[0],
    video.classification?.category,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanTitle(candidate);
    if (cleaned) return cleaned;
  }
  return "Untitled clip";
}

export function shortId(video: TikTokVideo): string {
  return video.id.slice(-SHORT_ID_LENGTH);
}

export function videoReference(video: TikTokVideo): string {
  const author = video.author?.username
    ? `@${video.author.username}`
    : video.author?.displayName || "unknown";
  const date = referenceDate(video);
  const title = videoTitle(video);
  const head = [author, date].filter(Boolean).join(" \u00b7 ");
  return `${head} \u2014 "${title}"  #${shortId(video)}`;
}

export function formatReference(video: TikTokVideo): string {
  const author = video.author?.username
    ? c.accent(`@${video.author.username}`)
    : c.muted(video.author?.displayName || "unknown");
  const date = referenceDate(video);
  const datePart = date ? ` ${c.muted("\u00b7")} ${c.muted(date)}` : "";
  const title = c.value(`"${videoTitle(video)}"`);
  return `${author}${datePart} ${c.muted("\u2014")} ${title}  ${c.muted(`#${shortId(video)}`)}`;
}

function referenceDate(video: TikTokVideo): string {
  const iso = video.createdAt ?? video.savedAt;
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function cleanTitle(value: string | undefined): string {
  if (!value) return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  const withoutTrailingTags = collapsed.replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  const base = withoutTrailingTags || collapsed;
  if (!base) return "";
  if (base.length <= TITLE_MAX) return base;
  return `${base.slice(0, TITLE_MAX - 1).trimEnd()}\u2026`;
}
