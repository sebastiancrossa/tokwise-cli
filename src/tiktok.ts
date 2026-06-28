import type { BookmarkFolder, BookmarkFolderKind, JsonObject, JsonValue, TikTokSource, TikTokVideo } from "./types.js";
import { stableHash, uniqueStrings } from "./store.js";
import { fetchWithRetry, sleep } from "./http.js";

const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

interface TikTokFetchOptions {
  cookie?: string;
  username?: string;
  secUid?: string;
  proxy?: string;
  limit?: number;
  page?: number;
  pages?: number;
  requestDelayMs?: number;
  maxRetries?: number;
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
  const normalized = normalizeCollectionInput(idOrUrl, options.username);
  if (!normalized.collectionId && !normalized.collectionUrl) {
    throw new Error(
      `Cannot resolve collection "${idOrUrl}". Use a full URL, @user/collection/slug, or run \`tw auth set-username <handle>\`.`,
    );
  }
  const resolved = normalized.collectionUrl ?? normalized.collectionId ?? idOrUrl;
  const context = {
    source: "collection",
    collectionId: normalized.collectionId,
    collectionUrl: normalized.collectionUrl,
  } satisfies SourceContext;

  if (options.cookie) {
    return fetchPaged(fetchCollectionWithCookie, resolved, options, context);
  }

  const api = await loadApi();
  const fn = requireFunction(api, "Collection");
  return fetchPaged(fn, resolved, options, context);
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
  const requestDelayMs = options.requestDelayMs ?? 0;
  const videos: TikTokVideo[] = [];
  let page = pageStart;

  for (let i = 0; i < maxPages && videos.length < limit; i += 1) {
    if (i > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
    const response = await fn(idOrUrl, {
      page,
      count: Math.min(30, limit - videos.length),
      postLimit: Math.min(30, limit - videos.length),
      cookie: options.cookie,
      proxy: options.proxy,
      maxRetries: options.maxRetries,
    });
    const items = extractItemsFromSuccessfulResponse(response, context.source);
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

async function fetchCollectionWithCookie(idOrUrl: string, options: UnknownRecord): Promise<unknown> {
  const collectionId = inferCollectionId(idOrUrl);
  if (!collectionId) {
    return {
      status: "error",
      message: "Invalid collection ID or URL format",
    };
  }
  const page = numberValue(options.page) ?? 1;
  const count = numberValue(options.count) ?? 30;
  const cursor = Math.max(0, page - 1) * count;
  const params = new URLSearchParams({
    WebIdLastTime: String(Date.now()),
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "MacIntel",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    collectionId,
    cookie_enabled: "true",
    count: String(count),
    cursor: String(cursor),
    device_platform: "web_pc",
    focus_state: "true",
    from_page: "user",
    history_len: "3",
    is_fullscreen: "false",
    is_page_visible: "true",
    language: "en",
    os: "mac",
    referer: looksLikeUrl(idOrUrl) ? idOrUrl : "",
    sourceType: "113",
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    user_is_login: "true",
    webcast_language: "en",
  });

  const response = await fetchWithRetry(
    `https://www.tiktok.com/api/collection/item_list/?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "user-agent": WEB_USER_AGENT,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        cookie: String(options.cookie ?? ""),
        referer: looksLikeUrl(idOrUrl) ? idOrUrl : "https://www.tiktok.com/",
      },
    },
    { maxRetries: numberValue(options.maxRetries) },
  );

  if (!response.ok) {
    return {
      status: "error",
      message: `Source returned HTTP ${response.status} ${response.statusText}`,
    };
  }

  return response.json() as Promise<unknown>;
}

function parseRehydrationScope(html: string): UnknownRecord | undefined {
  const match = html.match(/__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s);
  if (!match || !match[1]) return undefined;
  try {
    const data = asRecord(JSON.parse(match[1]));
    return asRecord(data?.["__DEFAULT_SCOPE__"]);
  } catch {
    return undefined;
  }
}

export function extractUsernameFromRehydrationHtml(html: string): string | undefined {
  const scope = parseRehydrationScope(html);
  const appContext = asRecord(scope?.["webapp.app-context"]);
  const user = asRecord(appContext?.user);
  return stringValue(user?.uniqueId);
}

export function extractSecUidFromRehydrationHtml(html: string): string | undefined {
  const scope = parseRehydrationScope(html);
  const appContext = asRecord(scope?.["webapp.app-context"]);
  const contextUser = asRecord(appContext?.user);
  const fromContext = stringValue(contextUser?.secUid);
  if (fromContext) return fromContext;
  const userDetail = asRecord(scope?.["webapp.user-detail"]);
  const userInfo = asRecord(userDetail?.userInfo);
  const detailUser = asRecord(userInfo?.user);
  return stringValue(detailUser?.secUid);
}

async function fetchRehydrationHtml(url: string, cookie: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": WEB_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        cookie,
      },
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

export async function detectLoggedInUsername(cookie: string, proxy?: string): Promise<string | undefined> {
  if (!cookie) return undefined;
  const html = await fetchRehydrationHtml("https://www.tiktok.com/", cookie);
  return html ? extractUsernameFromRehydrationHtml(html) : undefined;
}

export async function resolveSecUid(cookie: string, username?: string, proxy?: string): Promise<string | undefined> {
  if (!cookie) return undefined;
  const home = await fetchRehydrationHtml("https://www.tiktok.com/", cookie);
  const fromHome = home ? extractSecUidFromRehydrationHtml(home) : undefined;
  if (fromHome) return fromHome;
  if (username) {
    const profile = await fetchRehydrationHtml(`https://www.tiktok.com/@${username}`, cookie);
    const fromProfile = profile ? extractSecUidFromRehydrationHtml(profile) : undefined;
    if (fromProfile) return fromProfile;
  }
  return undefined;
}

const COLLECTION_LIST_PAGE_SIZE = 30;
const MAX_BOOKMARK_FOLDERS = 500;
const FAVORITES_NAMES = new Set(["favorites", "favorite", "favourites", "favourite"]);

export async function fetchBookmarkFolders(options: TikTokFetchOptions): Promise<BookmarkFolder[]> {
  const { cookie } = options;
  if (!cookie) {
    throw new Error("A browser cookie is required to list bookmarks. Run `tw auth from-browser` first.");
  }
  const secUid = options.secUid ?? (await resolveSecUid(cookie, options.username, options.proxy));
  if (!secUid) {
    throw new Error(
      "Could not resolve your TikTok secUid. Run `tw auth from-browser` (or `tw auth set-username <handle>`) and try again.",
    );
  }

  const folders: BookmarkFolder[] = [];
  const seen = new Set<string>();
  let cursor = "0";

  const requestDelayMs = options.requestDelayMs ?? 0;
  let firstPage = true;
  while (folders.length < MAX_BOOKMARK_FOLDERS) {
    if (!firstPage && requestDelayMs > 0) await sleep(requestDelayMs);
    firstPage = false;
    const response = await fetchCollectionList(secUid, cursor, COLLECTION_LIST_PAGE_SIZE, cookie, options.maxRetries);
    assertSuccessfulResponse(response, "collection");
    const entries = extractCollectionListEntries(response);
    for (const entry of entries) {
      const folder = normalizeBookmarkFolder(entry, options.username);
      if (!folder || seen.has(folder.id)) continue;
      seen.add(folder.id);
      folders.push(folder);
    }
    if (!hasMore(response) || entries.length === 0) break;
    const next = readCursor(response);
    if (!next || next === cursor) break;
    cursor = next;
  }

  return folders;
}

async function fetchCollectionList(
  secUid: string,
  cursor: string,
  count: number,
  cookie: string,
  maxRetries?: number,
): Promise<unknown> {
  const params = new URLSearchParams({
    WebIdLastTime: String(Date.now()),
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "MacIntel",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    count: String(count),
    cursor,
    device_platform: "web_pc",
    focus_state: "true",
    from_page: "user",
    history_len: "3",
    is_fullscreen: "false",
    is_page_visible: "true",
    language: "en",
    needPinnedItemIds: "true",
    os: "mac",
    secUid,
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    user_is_login: "true",
    webcast_language: "en",
  });

  const response = await fetchWithRetry(
    `https://www.tiktok.com/api/user/collection_list/?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "user-agent": WEB_USER_AGENT,
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        cookie,
        referer: "https://www.tiktok.com/",
      },
    },
    { maxRetries },
  );

  if (!response.ok) {
    return {
      status: "error",
      message: `Source returned HTTP ${response.status} ${response.statusText}`,
    };
  }

  return response.json() as Promise<unknown>;
}

export function extractCollectionListEntries(response: unknown): UnknownRecord[] {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  const candidates = [root?.collectionList, root?.collection_list, result?.collectionList, result?.collection_list];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.flatMap((item) => (asRecord(item) ? [asRecord(item) as UnknownRecord] : []));
    }
  }
  return [];
}

export function normalizeBookmarkFolder(entry: UnknownRecord, username?: string): BookmarkFolder | undefined {
  const id = stringValue(entry.collectionId) ?? stringValue(entry.id) ?? stringValue(entry.collection_id);
  if (!id) return undefined;
  const name = stringValue(entry.name) ?? stringValue(entry.collectionName) ?? "Untitled";
  const itemCount =
    numberValue(entry.total) ??
    numberValue(entry.itemCount) ??
    numberValue(entry.itemTotal) ??
    numberValue(entry.videoCount);
  const cover = firstString(entry.cover) ?? stringValue(entry.cover) ?? firstString(entry.coverUrl) ?? stringValue(entry.coverUrl);
  const kind: BookmarkFolderKind = FAVORITES_NAMES.has(name.trim().toLowerCase()) ? "favorites" : "collection";
  const url = username ? `https://www.tiktok.com/@${username}/collection/${slugifyCollection(name, id)}` : undefined;
  return { id, name, url, itemCount, cover, kind };
}

function slugifyCollection(name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-${id}` : id;
}

function readCursor(response: unknown): string | undefined {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  return stringValue(result?.cursor) ?? stringValue(root?.cursor);
}

export function extractItemsFromSuccessfulResponse(response: unknown, source: TikTokSource): UnknownRecord[] {
  assertSuccessfulResponse(response, source);
  return extractItems(response).filter(isLikelyVideoItem);
}

function assertSuccessfulResponse(response: unknown, source: TikTokSource): void {
  const root = asRecord(response);
  if (!root) return;
  const status = stringValue(root.status);
  const statusCode = numberValue(root.statusCode) ?? numberValue(root.status_code);
  if (status === "error" || (statusCode != null && statusCode !== 0)) {
    const message = stringValue(root.message) ?? stringValue(root.statusMsg) ?? stringValue(root.status_msg) ?? "unknown error";
    throw new Error(`Source ${source} fetch failed: ${message}`);
  }
}

function extractItems(response: unknown): UnknownRecord[] {
  const root = asRecord(response);
  if (!root) return [];
  const result = asRecord(root.result);
  const candidates = [
    root.itemList,
    root.collectionItemList,
    root.item_list,
    root.aweme_list,
    root.items,
    root.videos,
    root.result,
    result?.itemList,
    result?.collectionItemList,
    result?.item_list,
    result?.aweme_list,
    result?.items,
    result?.videos,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.flatMap((item) => (asRecord(item) ? [asRecord(item) as UnknownRecord] : []));
  }
  if (result) return [result];
  return [root];
}

function isLikelyVideoItem(item: UnknownRecord): boolean {
  const id = stringValue(item.id) ?? stringValue(item.awemeId) ?? stringValue(item.aweme_id);
  if (id && /^\d{8,}$/.test(id)) return true;
  const url = stringValue(item.url) ?? stringValue(item.shareUrl);
  return Boolean(inferVideoId(url));
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

function inferCollectionId(input: string): string | undefined {
  if (/^\d+$/.test(input.trim())) return input.trim();
  return input.match(/collection\/[^/\-]*-?(\d+)/i)?.[1] ?? inferTrailingId(input);
}

export interface NormalizedCollection {
  collectionId?: string;
  collectionUrl?: string;
  username?: string;
}

export function normalizeCollectionInput(input: string, fallbackUsername?: string): NormalizedCollection {
  const value = input.trim();
  let url: string | undefined;
  if (/^https?:\/\//i.test(value)) url = value;
  else if (/^(www\.)?tiktok\.com\/@/i.test(value)) url = `https://${value}`;
  else if (/^@[^/]+\/collection\//i.test(value)) url = `https://www.tiktok.com/${value}`;
  else if (fallbackUsername && !/^\d+$/.test(value)) url = `https://www.tiktok.com/@${fallbackUsername}/collection/${value}`;
  const collectionId = inferCollectionId(url ?? value);
  return { collectionId, collectionUrl: url, username: inferUsername(url) ?? fallbackUsername };
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
