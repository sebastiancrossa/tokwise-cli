export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type TikTokSource =
  | "collection"
  | "playlist"
  | "liked"
  | "user"
  | "search"
  | "url"
  | "import";

export interface TikTokAuthor {
  id?: string;
  username?: string;
  displayName?: string;
  signature?: string;
  verified?: boolean;
  avatarUrl?: string;
}

export interface TikTokStats {
  plays?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
}

export interface TikTokMusic {
  id?: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  url?: string;
}

export interface TikTokCollectionRef {
  id?: string;
  name?: string;
  url?: string;
  source: TikTokSource;
}

export interface TikTokMedia {
  videoUrl?: string;
  downloadUrl?: string;
  coverUrl?: string;
  dynamicCoverUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  videoPath?: string;
  audioPath?: string;
  infoJsonPath?: string;
  downloadedAt?: string;
}

export interface TranscriptSegment {
  start?: number;
  end?: number;
  text: string;
}

export interface TikTokTranscript {
  text: string;
  language?: string;
  engine?: string;
  model?: string;
  sourcePath?: string;
  jsonPath?: string;
  textPath?: string;
  generatedAt: string;
  segments?: TranscriptSegment[];
}

export interface TikTokClassification {
  category?: string;
  domain?: string;
  topics?: string[];
  summary?: string;
  engine?: string;
  model?: string;
  classifiedAt?: string;
}

export interface TikTokVideo {
  id: string;
  url: string;
  canonicalUrl?: string;
  description?: string;
  createdAt?: string;
  savedAt?: string;
  syncedAt: string;
  source: TikTokSource;
  collection?: TikTokCollectionRef;
  author?: TikTokAuthor;
  hashtags: string[];
  stats?: TikTokStats;
  music?: TikTokMusic;
  media?: TikTokMedia;
  transcript?: TikTokTranscript;
  classification?: TikTokClassification;
  raw?: JsonValue;
}

export interface SearchDocument {
  id: string;
  length: number;
  terms: Record<string, number>;
  title: string;
  preview: string;
}

export interface SearchIndex {
  version: 1;
  builtAt: string;
  recordCount: number;
  avgDocLength: number;
  termDocFreq: Record<string, number>;
  docs: SearchDocument[];
}

export interface SearchFilters {
  query?: string;
  author?: string;
  after?: string;
  before?: string;
  category?: string;
  domain?: string;
  collection?: string;
  hasTranscript?: boolean;
  source?: TikTokSource;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  video: TikTokVideo;
  score: number;
  highlights: string[];
}

export interface Preferences {
  classifyEngine?: "regex" | "ollama";
  askEngine?: "extractive" | "ollama";
  model?: string;
  ollamaBaseUrl?: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  total: number;
  ids: string[];
}
