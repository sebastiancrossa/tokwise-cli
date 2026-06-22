import fs from "node:fs/promises";
import path from "node:path";
import type { TikTokTranscript, TikTokVideo, TranscriptSegment } from "./types.js";
import { ensureDataDirs, transcriptDir } from "./paths.js";
import { quoteShell, runProcess, runShell, templateCommand } from "./process.js";
import { sanitizeFilePart } from "./store.js";

export type SttEngine = "whisper" | "whisper-cpp" | "custom";

export interface TranscribeOptions {
  engine: SttEngine;
  command?: string;
  model?: string;
  language?: string;
  force?: boolean;
}

export interface TranscribeOutcome {
  id: string;
  changed: boolean;
  transcript?: TikTokTranscript;
}

export async function transcribeVideo(video: TikTokVideo, options: TranscribeOptions): Promise<TranscribeOutcome> {
  ensureDataDirs();
  if (!options.force && video.transcript?.text) {
    return { id: video.id, changed: false, transcript: video.transcript };
  }
  const input = video.media?.audioPath ?? video.media?.videoPath;
  if (!input) throw new Error(`${video.id} has no downloaded audio or video. Run tt fetch-media --audio first.`);
  const safeId = sanitizeFilePart(video.id);
  const outJson = path.join(transcriptDir(), `${safeId}.json`);
  const outText = path.join(transcriptDir(), `${safeId}.txt`);
  let raw: unknown;
  let stdout = "";

  if (options.engine === "whisper") {
    raw = await runWhisper(input, options);
  } else if (options.engine === "whisper-cpp") {
    raw = await runWhisperCpp(input, safeId, options);
  } else {
    const result = await runCustom(input, outJson, options);
    raw = result.raw;
    stdout = result.stdout;
  }

  const parsed = await transcriptFromRaw(raw, stdout, {
    id: video.id,
    input,
    outJson,
    outText,
    engine: options.engine,
    model: options.model,
    language: options.language,
  });
  await fs.writeFile(outJson, `${JSON.stringify(raw ?? parsed, null, 2)}\n`, "utf8");
  await fs.writeFile(outText, `${parsed.text.trim()}\n`, "utf8");
  return { id: video.id, changed: true, transcript: parsed };
}

async function runWhisper(input: string, options: TranscribeOptions): Promise<unknown> {
  const command = options.command ?? "whisper";
  const args = [input, "--output_dir", transcriptDir(), "--output_format", "json"];
  if (options.model) args.push("--model", options.model);
  if (options.language) args.push("--language", options.language);
  const result = await runProcess(command, args);
  if (result.code !== 0) throw new Error(`whisper failed: ${result.stderr || result.stdout}`);
  const expected = path.join(transcriptDir(), `${path.basename(input, path.extname(input))}.json`);
  return readJsonIfExists(expected) ?? { stdout: result.stdout };
}

async function runWhisperCpp(input: string, safeId: string, options: TranscribeOptions): Promise<unknown> {
  const command = options.command ?? "whisper-cli";
  const prefix = path.join(transcriptDir(), safeId);
  const args = ["-f", input, "-oj", "-of", prefix];
  if (options.model) args.unshift("-m", options.model);
  if (options.language) args.push("-l", options.language);
  const result = await runProcess(command, args);
  if (result.code !== 0) throw new Error(`whisper.cpp failed: ${result.stderr || result.stdout}`);
  return readJsonIfExists(`${prefix}.json`) ?? { stdout: result.stdout };
}

async function runCustom(
  input: string,
  output: string,
  options: TranscribeOptions,
): Promise<{ raw: unknown; stdout: string }> {
  if (!options.command) throw new Error("--command is required for --engine custom.");
  const command = templateCommand(options.command, {
    input,
    output,
    language: options.language,
    model: options.model,
  });
  const result = await runShell(command);
  if (result.code !== 0) throw new Error(`custom STT failed: ${result.stderr || result.stdout}`);
  const raw = (await readJsonIfExists(output)) ?? (await readTextIfExists(output)) ?? { stdout: result.stdout };
  return { raw, stdout: result.stdout };
}

async function transcriptFromRaw(
  raw: unknown,
  stdout: string,
  context: {
    id: string;
    input: string;
    outJson: string;
    outText: string;
    engine: string;
    model?: string;
    language?: string;
  },
): Promise<TikTokTranscript> {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
  const text =
    stringValue(record?.text) ??
    stringValue(record?.transcript) ??
    stringValue(record?.stdout) ??
    (typeof raw === "string" ? raw : undefined) ??
    stdout;
  const segments = parseSegments(record?.segments);
  return {
    text: text.trim(),
    language: stringValue(record?.language) ?? context.language,
    engine: context.engine,
    model: context.model,
    sourcePath: context.input,
    jsonPath: context.outJson,
    textPath: context.outText,
    generatedAt: new Date().toISOString(),
    segments,
  };
}

function parseSegments(value: unknown): TranscriptSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments = value.flatMap((segment) => {
    if (typeof segment !== "object" || segment === null) return [];
    const record = segment as Record<string, unknown>;
    const text = stringValue(record.text);
    if (!text) return [];
    return [
      {
        start: numberValue(record.start),
        end: numberValue(record.end),
        text,
      },
    ];
  });
  return segments.length > 0 ? segments : undefined;
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function renderCustomTemplateHelp(): string {
  return [
    "Custom STT command placeholders:",
    `  {input}    ${quoteShell("/path/to/audio.m4a")}`,
    `  {output}   ${quoteShell("/path/to/transcript.json")}`,
    "  {language} requested language",
    "  {model}    requested model",
  ].join("\n");
}
