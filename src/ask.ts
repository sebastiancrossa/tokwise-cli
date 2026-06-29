import type { SearchResult } from "./types.js";
import { videoReference } from "./reference.js";

export interface AskOptions {
  engine?: "extractive" | "ollama";
  model?: string;
  ollamaBaseUrl?: string;
  onFirstToken?: () => void;
  onToken?: (chunk: string) => void;
}

export async function answerQuestion(question: string, results: SearchResult[], options: AskOptions): Promise<string> {
  if (results.length === 0) return "No local evidence matched that question.";
  if (options.engine === "ollama") return answerWithOllama(question, results, options);
  return answerExtractively(question, results);
}

function answerExtractively(question: string, results: SearchResult[]): string {
  return [
    `Question: ${question}`,
    "",
    "Top local evidence:",
    "",
    ...results.slice(0, 8).map((result, idx) => {
      const video = result.video;
      const summary = video.classification?.summary ?? result.highlights[0] ?? video.description ?? "No text.";
      return `${idx + 1}. ${videoReference(video)}\n   ${summary}\n   ${video.canonicalUrl ?? video.url}`;
    }),
    "",
    "Use --engine ollama --model <model> for a synthesized answer from a local model.",
  ].join("\n");
}

async function answerWithOllama(question: string, results: SearchResult[], options: AskOptions): Promise<string> {
  const baseUrl = options.ollamaBaseUrl ?? "http://localhost:11434";
  const model = options.model ?? "llama3.1";
  const context = results
    .slice(0, 10)
    .map((result, idx) => {
      const video = result.video;
      return [
        `[${idx + 1}] ${videoReference(video)}`,
        `Source: ${video.canonicalUrl ?? video.url}`,
        `Category: ${video.classification?.category ?? "unknown"}`,
        `Summary: ${video.classification?.summary ?? ""}`,
        `Transcript: ${(video.transcript?.text ?? video.description ?? "").slice(0, 2500)}`,
      ].join("\n");
    })
    .join("\n\n");
  const prompt = [
    "Answer the user's question using only the saved clip evidence below.",
    "Cite clips by their readable reference (e.g. @author (Mon YYYY)) when making claims; include the clip's Source URL when a claim needs to be traceable. If evidence is thin, say so.",
    "",
    `Question: ${question}`,
    "",
    "Evidence:",
    context,
  ].join("\n");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true }),
  });
  if (!response.ok) throw new Error(`Ollama ask failed: ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error("Ollama ask failed: empty response body");

  let full = "";
  let firstToken = false;
  for await (const chunk of iterateNdjson(response.body)) {
    const piece = chunk.response ?? "";
    if (!piece) {
      if (chunk.done) break;
      continue;
    }
    if (!firstToken) {
      firstToken = true;
      options.onFirstToken?.();
    }
    full += piece;
    options.onToken?.(piece);
    if (chunk.done) break;
  }
  return full.trim() || "Ollama returned an empty answer.";
}

interface OllamaStreamChunk {
  response?: string;
  done?: boolean;
}

async function* iterateNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<OllamaStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        yield JSON.parse(trimmed) as OllamaStreamChunk;
      }
    }
    const trailing = buffer.trim();
    if (trailing) yield JSON.parse(trailing) as OllamaStreamChunk;
  } finally {
    reader.releaseLock();
  }
}
