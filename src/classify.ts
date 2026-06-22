import type { TikTokClassification, TikTokVideo } from "./types.js";
import { searchableText, tokenize } from "./search.js";

export interface ClassifyOptions {
  engine?: "regex" | "ollama";
  model?: string;
  ollamaBaseUrl?: string;
}

interface KeywordRule {
  label: string;
  keywords: string[];
}

const CATEGORY_RULES: KeywordRule[] = [
  { label: "career", keywords: ["career", "job", "work", "interview", "manager", "promotion", "resume", "business"] },
  { label: "relationships", keywords: ["relationship", "friend", "partner", "dating", "marriage", "family", "boundaries"] },
  { label: "health", keywords: ["health", "sleep", "fitness", "diet", "body", "therapy", "mental", "anxiety", "stress"] },
  { label: "money", keywords: ["money", "finance", "invest", "budget", "saving", "debt", "wealth", "income"] },
  { label: "productivity", keywords: ["productivity", "habit", "routine", "focus", "discipline", "calendar", "system"] },
  { label: "learning", keywords: ["learn", "study", "read", "book", "skill", "practice", "teach"] },
  { label: "mindset", keywords: ["mindset", "confidence", "fear", "failure", "motivation", "identity", "belief"] },
  { label: "creativity", keywords: ["create", "writing", "artist", "idea", "taste", "creative", "make"] },
  { label: "spirituality", keywords: ["meaning", "purpose", "gratitude", "meditation", "spiritual", "presence"] },
];

const DOMAIN_RULES: KeywordRule[] = [
  { label: "decision-making", keywords: ["choice", "decision", "tradeoff", "choose", "option", "clarity"] },
  { label: "self-regulation", keywords: ["emotion", "calm", "stress", "discipline", "impulse", "nervous"] },
  { label: "social-dynamics", keywords: ["people", "friend", "relationship", "boundary", "conversation", "trust"] },
  { label: "work-and-ambition", keywords: ["career", "job", "interview", "promotion", "work", "business", "goal", "ambition", "manager"] },
  { label: "health-and-energy", keywords: ["sleep", "health", "body", "exercise", "food", "energy"] },
  { label: "money-and-security", keywords: ["money", "budget", "wealth", "debt", "invest", "rent"] },
  { label: "meaning-and-values", keywords: ["meaning", "purpose", "values", "life", "death", "legacy"] },
];

export function classifyRegex(video: TikTokVideo): TikTokClassification {
  const text = searchableText(video).toLowerCase();
  const tokens = new Set(tokenize(text));
  const category = bestRule(tokens, CATEGORY_RULES) ?? "life-advice";
  const domain = bestRule(tokens, DOMAIN_RULES) ?? "general-life";
  const topics = topTopics(video, tokens);
  return {
    category,
    domain,
    topics,
    summary: summarize(video),
    engine: "regex",
    classifiedAt: new Date().toISOString(),
  };
}

export async function classifyOllama(video: TikTokVideo, options: ClassifyOptions): Promise<TikTokClassification> {
  const baseUrl = options.ollamaBaseUrl ?? "http://localhost:11434";
  const model = options.model ?? "llama3.1";
  const prompt = [
    "Classify this saved TikTok life-advice video.",
    "Return compact JSON with keys: category, domain, topics, summary.",
    "Categories should be short lowercase labels. Topics should be 3 to 7 short phrases.",
    "",
    `Author: ${video.author?.username ?? "unknown"}`,
    `Description: ${video.description ?? ""}`,
    `Transcript: ${(video.transcript?.text ?? "").slice(0, 6000)}`,
  ].join("\n");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
  });
  if (!response.ok) throw new Error(`Ollama classify failed: ${response.status} ${response.statusText}`);
  const body = (await response.json()) as { response?: string };
  const parsed = parseJsonObject(body.response ?? "{}");
  const fallback = classifyRegex(video);
  return {
    category: stringValue(parsed.category) ?? fallback.category,
    domain: stringValue(parsed.domain) ?? fallback.domain,
    topics: arrayOfStrings(parsed.topics) ?? fallback.topics,
    summary: stringValue(parsed.summary) ?? fallback.summary,
    engine: "ollama",
    model,
    classifiedAt: new Date().toISOString(),
  };
}

export async function classifyOne(video: TikTokVideo, options: ClassifyOptions): Promise<TikTokClassification> {
  if (options.engine === "ollama") return classifyOllama(video, options);
  return classifyRegex(video);
}

function bestRule(tokens: Set<string>, rules: KeywordRule[]): string | undefined {
  let best: { label: string; score: number } | undefined;
  for (const rule of rules) {
    const score = rule.keywords.reduce((sum, keyword) => sum + (tokens.has(keyword) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { label: rule.label, score };
  }
  return best?.label;
}

function topTopics(video: TikTokVideo, tokens: Set<string>): string[] {
  const hashtags = video.hashtags.slice(0, 8).map((tag) => tag.toLowerCase());
  const meaningful = [...tokens].filter((token) => token.length > 4).slice(0, 8);
  return [...new Set([...hashtags, ...meaningful])].slice(0, 7);
}

function summarize(video: TikTokVideo): string {
  const text = video.transcript?.text || video.description || "";
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0]?.replace(/\s+/g, " ").trim();
  return firstSentence?.slice(0, 260) || "No transcript summary available yet.";
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}
