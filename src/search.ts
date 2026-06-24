import fs from "node:fs/promises";
import type { SearchDocument, SearchFilters, SearchIndex, SearchResult, TikTokVideo } from "./types.js";
import { searchIndexPath } from "./paths.js";
import { readJsonFile, writeJsonFile } from "./jsonl.js";
import { c } from "./render.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "you",
  "your",
]);

export function tokenize(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['']/g, "")
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function searchableText(video: TikTokVideo): string {
  return [
    video.description,
    video.transcript?.text,
    video.classification?.summary,
    video.classification?.category,
    video.classification?.domain,
    ...(video.classification?.topics ?? []),
    ...video.hashtags,
    video.author?.username,
    video.author?.displayName,
    video.music?.title,
    video.music?.author,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSearchIndex(videos: TikTokVideo[]): SearchIndex {
  const docs = videos.map(toSearchDocument);
  const termDocFreq: Record<string, number> = {};
  for (const doc of docs) {
    for (const term of Object.keys(doc.terms)) {
      termDocFreq[term] = (termDocFreq[term] ?? 0) + 1;
    }
  }
  const totalLength = docs.reduce((sum, doc) => sum + doc.length, 0);
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    recordCount: docs.length,
    avgDocLength: docs.length === 0 ? 0 : totalLength / docs.length,
    termDocFreq,
    docs,
  };
}

function toSearchDocument(video: TikTokVideo): SearchDocument {
  const weightedTerms: Record<string, number> = {};
  addTerms(weightedTerms, tokenize(video.description), 3);
  addTerms(weightedTerms, tokenize(video.transcript?.text), 2);
  addTerms(weightedTerms, tokenize(video.classification?.summary), 3);
  addTerms(weightedTerms, tokenize(video.classification?.category), 4);
  addTerms(weightedTerms, tokenize(video.classification?.domain), 4);
  addTerms(weightedTerms, tokenize((video.classification?.topics ?? []).join(" ")), 4);
  addTerms(weightedTerms, tokenize(video.hashtags.join(" ")), 4);
  addTerms(weightedTerms, tokenize([video.author?.username, video.author?.displayName].filter(Boolean).join(" ")), 2);
  addTerms(weightedTerms, tokenize([video.music?.title, video.music?.author].filter(Boolean).join(" ")), 1);
  const length = Object.values(weightedTerms).reduce((sum, count) => sum + count, 0);
  return {
    id: video.id,
    length,
    terms: weightedTerms,
    title: video.description?.split(/\r?\n/)[0]?.slice(0, 100) ?? video.id,
    preview: makePreview(video),
  };
}

function addTerms(target: Record<string, number>, terms: string[], weight: number): void {
  for (const term of terms) {
    target[term] = (target[term] ?? 0) + weight;
  }
}

function makePreview(video: TikTokVideo): string {
  const text = video.transcript?.text || video.description || "";
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

export async function saveSearchIndex(videos: TikTokVideo[]): Promise<SearchIndex> {
  const index = buildSearchIndex(videos);
  await writeJsonFile(searchIndexPath(), index);
  return index;
}

export async function loadSearchIndex(): Promise<SearchIndex | undefined> {
  try {
    await fs.access(searchIndexPath());
  } catch {
    return undefined;
  }
  return readJsonFile<SearchIndex | undefined>(searchIndexPath(), undefined);
}

export function filterVideos(videos: TikTokVideo[], filters: SearchFilters): TikTokVideo[] {
  const author = filters.author?.replace(/^@/, "").toLowerCase();
  const category = filters.category?.toLowerCase();
  const domain = filters.domain?.toLowerCase();
  const collection = filters.collection?.toLowerCase();
  const after = filters.after ? new Date(filters.after) : undefined;
  const before = filters.before ? new Date(filters.before) : undefined;

  return videos.filter((video) => {
    if (author && !video.author?.username?.toLowerCase().includes(author)) return false;
    if (category && video.classification?.category?.toLowerCase() !== category) return false;
    if (domain && video.classification?.domain?.toLowerCase() !== domain) return false;
    if (collection) {
      const haystack = [video.collection?.id, video.collection?.name, video.collection?.url].filter(Boolean).join(" ");
      if (!haystack.toLowerCase().includes(collection)) return false;
    }
    if (filters.source && video.source !== filters.source) return false;
    if (filters.hasTranscript != null && Boolean(video.transcript?.text) !== filters.hasTranscript) return false;
    const date = video.createdAt ? new Date(video.createdAt) : undefined;
    if (after && date && date < after) return false;
    if (before && date && date > before) return false;
    return true;
  });
}

export function searchWithIndex(videos: TikTokVideo[], index: SearchIndex, filters: SearchFilters): SearchResult[] {
  const filtered = filterVideos(videos, filters);
  const allowedIds = new Set(filtered.map((video) => video.id));
  const byId = new Map(videos.map((video) => [video.id, video]));
  const query = filters.query?.trim() ?? "";
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  if (!query) {
    return filtered.slice(offset, offset + limit).map((video) => ({ video, score: 0, highlights: highlights(video, []) }));
  }

  const queryTerms = tokenize(query);
  const phrase = query.toLowerCase();
  const scored: SearchResult[] = [];
  for (const doc of index.docs) {
    if (!allowedIds.has(doc.id)) continue;
    const video = byId.get(doc.id);
    if (!video) continue;
    let score = 0;
    for (const term of queryTerms) {
      score += bm25(term, doc, index);
    }
    if (searchableText(video).toLowerCase().includes(phrase)) score += 1.5;
    if (score > 0) scored.push({ video, score, highlights: highlights(video, queryTerms) });
  }

  return scored.sort((a, b) => b.score - a.score).slice(offset, offset + limit);
}

function bm25(term: string, doc: SearchDocument, index: SearchIndex): number {
  const tf = doc.terms[term] ?? 0;
  if (tf <= 0) return 0;
  const n = index.recordCount;
  const df = index.termDocFreq[term] ?? 0;
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const k1 = 1.4;
  const b = 0.75;
  const avg = index.avgDocLength || 1;
  return idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / avg))));
}

function highlights(video: TikTokVideo, terms: string[]): string[] {
  const parts = [video.description, video.transcript?.text].filter(Boolean) as string[];
  if (terms.length === 0) return parts.slice(0, 1).map((part) => part.replace(/\s+/g, " ").slice(0, 220));
  const normalizedTerms = new Set(terms);
  for (const part of parts) {
    const sentences = part.split(/(?<=[.!?])\s+|\n+/);
    const matched = sentences.find((sentence) => tokenize(sentence).some((term) => normalizedTerms.has(term)));
    if (matched) return [matched.replace(/\s+/g, " ").slice(0, 240)];
  }
  return parts.slice(0, 1).map((part) => part.replace(/\s+/g, " ").slice(0, 220));
}

export function formatSearchResults(results: SearchResult[], options?: { json?: boolean }): string {
  if (options?.json) return JSON.stringify(results, null, 2);
  if (results.length === 0) return c.muted("No matches.");
  return results
    .map((result, idx) => {
      const video = result.video;
      const author = video.author?.username ? c.accent(`@${video.author.username}`) : c.muted("unknown");
      const category = video.classification?.category ? ` ${c.warn(`[${video.classification.category}]`)}` : "";
      const score = result.score > 0 ? ` ${c.muted(`score ${result.score.toFixed(2)}`)}` : "";
      const line = `${c.muted(`${idx + 1}.`)} ${c.value(video.id)} ${author}${category}${score}`;
      const desc = video.description ? `   ${video.description.replace(/\s+/g, " ").slice(0, 160)}` : "";
      const hit = result.highlights[0] ? `   ${c.muted(">")} ${c.success(result.highlights[0])}` : "";
      return [line, desc, hit, `   ${c.muted(video.canonicalUrl ?? video.url)}`].filter(Boolean).join("\n");
    })
    .join("\n\n");
}
