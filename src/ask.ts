import type { SearchResult } from "./types.js";

export interface AskOptions {
  engine?: "extractive" | "ollama";
  model?: string;
  ollamaBaseUrl?: string;
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
      const author = video.author?.username ? `@${video.author.username}` : "unknown";
      const summary = video.classification?.summary ?? result.highlights[0] ?? video.description ?? "No text.";
      return `${idx + 1}. ${video.id} ${author}\n   ${summary}\n   ${video.canonicalUrl ?? video.url}`;
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
        `[${idx + 1}] ${video.id} ${video.canonicalUrl ?? video.url}`,
        `Author: ${video.author?.username ?? "unknown"}`,
        `Category: ${video.classification?.category ?? "unknown"}`,
        `Summary: ${video.classification?.summary ?? ""}`,
        `Transcript: ${(video.transcript?.text ?? video.description ?? "").slice(0, 2500)}`,
      ].join("\n");
    })
    .join("\n\n");
  const prompt = [
    "Answer the user's question using only the saved clip evidence below.",
    "Cite video ids in brackets when making claims. If evidence is thin, say so.",
    "",
    `Question: ${question}`,
    "",
    "Evidence:",
    context,
  ].join("\n");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!response.ok) throw new Error(`Ollama ask failed: ${response.status} ${response.statusText}`);
  const body = (await response.json()) as { response?: string };
  return body.response?.trim() || "Ollama returned an empty answer.";
}
