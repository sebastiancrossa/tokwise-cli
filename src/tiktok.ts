import type { JsonObject, JsonValue, TikTokSource, TikTokVideo } from "./types.js";
import { stableHash, uniqueStrings } from "./store.js";

interface TikTokFetchOptions {
  cookie?: string;
  proxy?: string;
  limit?: number;
  page?: number;
  pages?: number;
}

interface SourceContext {
  source: TikTokSource;
  collectionName?: string;
  collectionId?: string;
  collectionUrl?: string;
}

type UnknownRecord = Record<string, unknown>;

async function loadApi(): Promise<UnknownRecord> {
  const mod = (await import("@tobyg74/tiktok-api-dl")) as UnknownRecord & { default?: UnknownRecord };
  return mod.default ?? mod;
}

export async function fetchCollection(idOrUrl: string, options: TikTokFetchOptions): Promise<TikTokVideo[]> {
  const api = await loadApi();
  const fn = requireFunction(api, "Collection");
  return fetchPaged(fn, idOrUrl, options, {
    source: "collection",
    collectionId: inferTrailingId(idOrUrl),
    collectionUrl: looksLikeUrl(idOrUrl) ? idOrUrl : undefined,
  });
}

export async function fetchPlaylist(idOrUrl: string, options: TikTokFetchOptions): Promise<TikTokVideo[]> {
  const api = await loadApi();
  const fn = requireFunction(api, "Playlist");
  return fetchPaged(fn, idOrUrl, options, {
    source: "playlist",
    collectionId: inferTrailingId(idOrUrl),
    collectionUrl: looksLikeUrl(idOrUrl) ? idOrUrl : undefined,
  });
}

export async function fetchLiked(username: string, options: TikTokFetchOptions): Promise<TikTokVideo[]> {
  const api = await loadApi();
  const fn = requireFunction(api, "GetUserLiked");
  return fetchPaged(fn, username, options, {
    source: "liked",
    collectionName: `${username} liked videos`,
    collectionId: username,
  });
}

export async function fetchUserPosts(username: string, options: TikTokFetchOptions): Promise<TikTokVideo[]> {
  const api = await loadApi();
  const fn = requireFunction(api, "GetUserPosts");
  return fetchPaged(fn, username, options, {
    source: "user",
    collectionName: `${username} posts`,
    collectionId: username,
  });
}

export async function fetchVideoSearch(query: string, options: TikTokFetchOptions): Promise<TikTokVideo[]> {
  const api = await loadApi();
  const fn = requireFunction(api, "Search");
  const response = await fn(query, {
    type: "video",
    page: options.page ?? 1,
    cookie: options.cookie,
    proxy: options.proxy,
  });
  return extractItems(response)
    .slice(0, options.limit)
    .map((item) =>
      normalizeVideo(item, {
        source: "search",
        collectionName: `Search: ${query}`,
        collectionId: query,
      }),
    );
}

export async function fetchSingleUrl(url: string, options: TikTokFetchOptions): Promise<TikTokVideo> {
  const api = await loadApi();
  const fn = requireFunction(api, "Downloader");
  const response = await fn(url, {
    version: "v1",
    proxy: options.proxy,
    showOriginalResponse: true,
  });
  const items = extractItems(response);
  const responseRecord = asRecord(response);
  const item = items[0] ?? asRecord(responseRecord?.result) ?? responseRecord ?? {};
  return normalizeVideo({ ...item, url }, { source: "url" });
}

export function videosFromUrls(urls: string[]): TikTokVideo[] {
  return urls.map((url) =>
    normalizeVideo({ id: inferVideoId(url) ?? stableHash(url), url }, { source: "url" }),
  );
}

export function videosFromImport(value: unknown): TikTokVideo[] {
  if (Array.isArray(value)) return value.map((item) => normalizeVideo(asRecord(item) ?? { value: item }, { source: "import" }));
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items.map((item) => normalizeVideo(asRecord(item) ?? { value: item }, { source: "import" }));
  }
  if (isRecord(value) && Array.isArray(value.result)) {
    return value.result.map((item) => normalizeVideo(asRecord(item) ?? { value: item }, { source: "import" }));
  }
  const record = asRecord(value);
  return record ? [normalizeVideo(record, { source: "import" })] : [];
}

async function fetchPaged(
  fn: (idOrUrl: string, options: UnknownRecord) => Promise<unknown>,
  idOrUrl: string,
  options: TikTokFetchOptions,
  context: SourceContext,
): Promise<TikTokVideo[]> {
  const limit = options.limit ?? 30;
  const pageStart = options.page ?? 1;
  const maxPages = options.pages ?? Math.ceil(limit / 30);
  const videos: TikTokVideo[] = [];
  let page = pageStart;

  for (let i = 0; i < maxPages && videos.length < limit; i += 1) {
    const response = await fn(idOrUrl, {
      page,
      count: Math.min(30, limit - videos.length),
      postLimit: Math.min(30, limit - videos.length),
      cookie: options.cookie,
      proxy: options.proxy,
    });
    const items = extractItems(response);
    videos.push(...items.map((item) => normalizeVideo(item, context)));
    if (!hasMore(response) || items.length === 0) break;
    page += 1;
  }

  return dedupeById(videos).slice(0, limit);
}

function requireFunction(api: UnknownRecord, name: string): (arg: string, options: UnknownRecord) => Promise<unknown> {
  const value = api[name];
  if (typeof value !== "function") {
    throw new Error(`@tobyg74/tiktok-api-dl does not expose ${name}().`);
  }
  return value as (arg: string, options: UnknownRecord) => Promise<unknown>;
}

function extractItems(response: unknown): UnknownRecord[] {
  const root = asRecord(response);
  if (!root) return [];
  const result = asRecord(root.result);
  const candidates = [
    root.itemList,
    root.items,
    root.videos,
    root.result,
    result?.itemList,
    result?.items,
    result?.videos,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.flatMap((item) => (asRecord(item) ? [asRecord(item) as UnknownRecord] : []));
  }
  if (result) return [result];
  return [root];
}

function hasMore(response: unknown): boolean {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  const value = result?.hasMore ?? root?.hasMore;
  return value === true || value === "true";
}

export function normalizeVideo(item: UnknownRecord, context: SourceContext): TikTokVideo {
  const id = stringValue(item.id) ?? stringValue(item.awemeId) ?? stringValue(item.aweme_id) ?? inferVideoId(stringValue(item.url)) ?? stableHash(JSON.stringify(item));
  const authorRecord = asRecord(item.author) ?? asRecord(item.owner);
  const statsRecord = asRecord(item.stats) ?? asRecord(item.statistics);
  const videoRecord = asRecord(item.video);
  const musicRecord = asRecord(item.music);
  const textExtra = Array.isArray(item.textExtra) ? item.textExtra.flatMap((entry) => (asRecord(entry) ? [entry] : [])) : [];
  const challenges = Array.isArray(item.challenges) ? item.challenges.flatMap((entry) => (asRecord(entry) ? [entry] : [])) : [];
  const hashtags = uniqueStrings([
    ...arrayOfStrings(item.hashtag),
    ...textExtra.map((entry) => stringValue(entry.hashtagName)),
    ...challenges.map((entry) => stringValue(entry.title)),
  ]);
  const username =
    stringValue(authorRecord?.username) ??
    stringValue(authorRecord?.uniqueId) ??
    stringValue(item.username) ??
    inferUsername(stringValue(item.url));
  const url = stringValue(item.url) ?? stringValue(item.shareUrl) ?? (username ? `https://www.tiktok.com/@${username}/video/${id}` : `https://www.tiktok.com/video/${id}`);
  const createdAt = toIsoTime(item.createTime);
  const now = new Date().toISOString();
  const raw = JSON.parse(JSON.stringify(item)) as JsonValue;

  return {
    id,
    url,
    canonicalUrl: username ? `https://www.tiktok.com/@${username}/video/${id}` : url,
    description: stringValue(item.desc) ?? stringValue(item.description) ?? stringValue(item.title),
    createdAt,
    savedAt: now,
    syncedAt: now,
    source: context.source,
    collection: {
      source: context.source,
      id: context.collectionId,
      name: context.collectionName,
      url: context.collectionUrl,
    },
    author: {
      id: stringValue(authorRecord?.id) ?? stringValue(authorRecord?.uid),
      username,
      displayName: stringValue(authorRecord?.nickname) ?? stringValue(authorRecord?.displayName),
      signature: stringValue(authorRecord?.signature),
      verified: booleanValue(authorRecord?.verified),
      avatarUrl: firstString(authorRecord?.avatarThumb) ?? firstString(authorRecord?.avatarMedium) ?? stringValue(authorRecord?.avatar),
    },
    hashtags,
    stats: {
      plays: numberValue(statsRecord?.playCount),
      likes: numberValue(statsRecord?.likeCount) ?? numberValue(statsRecord?.diggCount),
      comments: numberValue(statsRecord?.commentCount),
      shares: numberValue(statsRecord?.shareCount),
      saves: numberValue(statsRecord?.collectCount),
      reposts: numberValue(statsRecord?.repostCount),
    },
    music: {
      id: stringValue(musicRecord?.id),
      title: stringValue(musicRecord?.title),
      author: stringValue(musicRecord?.authorName) ?? stringValue(musicRecord?.author),
      durationSeconds: numberValue(musicRecord?.duration),
      url: firstString(musicRecord?.playUrl) ?? stringValue(musicRecord?.playUrl),
    },
    media: {
      videoUrl: firstString(videoRecord?.playAddr) ?? stringValue(videoRecord?.playAddr),
      downloadUrl: firstString(videoRecord?.downloadAddr) ?? stringValue(videoRecord?.downloadAddr),
      coverUrl: firstString(videoRecord?.cover) ?? stringValue(videoRecord?.cover) ?? stringValue(item.cover),
      dynamicCoverUrl: firstString(videoRecord?.dynamicCover) ?? stringValue(videoRecord?.dynamicCover),
      durationSeconds: numberValue(videoRecord?.duration),
      width: numberValue(videoRecord?.width),
      height: numberValue(videoRecord?.height),
    },
    raw,
  };
}

function dedupeById(videos: TikTokVideo[]): TikTokVideo[] {
  return [...new Map(videos.map((video) => [video.id, video])).values()];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return stringValue(value);
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = stringValue(entry);
    return text ? [text] : [];
  });
}

function toIsoTime(value: unknown): string | undefined {
  const numeric = numberValue(value);
  if (numeric == null) return undefined;
  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function inferTrailingId(input: string): string | undefined {
  const match = input.match(/(\d{8,})(?:\D*)$/);
  return match?.[1];
}

function inferVideoId(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return input.match(/\/video\/(\d+)/)?.[1] ?? inferTrailingId(input);
}

function inferUsername(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return input.match(/tiktok\.com\/@([^/?#]+)/)?.[1];
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

export function jsonValueFromUnknown(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function jsonObjectFromUnknown(value: unknown): JsonObject | undefined {
  const json = jsonValueFromUnknown(value);
  return typeof json === "object" && json !== null && !Array.isArray(json) ? json : undefined;
}
