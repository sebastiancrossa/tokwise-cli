import * as p from "@clack/prompts";
import type { BookmarkFolder } from "./types.js";

export interface PipelineSelection {
  download: boolean;
  transcribe: boolean;
  classify: boolean;
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export function intro(message: string): void {
  p.intro(message);
}

export function cancelled(message: string): void {
  p.cancel(message);
}

function folderHint(folder: BookmarkFolder): string | undefined {
  const parts: string[] = [];
  if (folder.kind === "favorites") parts.push("saved videos");
  if (typeof folder.itemCount === "number") parts.push(`${folder.itemCount} videos`);
  return parts.length ? parts.join(" \u00b7 ") : undefined;
}

export async function promptFolderSelection(folders: BookmarkFolder[]): Promise<BookmarkFolder[] | undefined> {
  const selection = await p.multiselect({
    message: "Select bookmarks to sync",
    options: folders.map((folder) => ({
      value: folder.id,
      label: folder.name,
      hint: folderHint(folder),
    })),
    required: false,
  });
  if (p.isCancel(selection)) return undefined;
  const ids = new Set(selection as string[]);
  return folders.filter((folder) => ids.has(folder.id));
}

export async function promptPipelineSelection(defaults: PipelineSelection): Promise<PipelineSelection | undefined> {
  const initialValues: string[] = [];
  if (defaults.download) initialValues.push("download");
  if (defaults.transcribe) initialValues.push("transcribe");
  if (defaults.classify) initialValues.push("classify");

  const selection = await p.multiselect({
    message: "What should we do with these?",
    options: [
      { value: "download", label: "Download audio" },
      { value: "transcribe", label: "Transcribe" },
      { value: "classify", label: "Classify" },
    ],
    initialValues,
    required: false,
  });
  if (p.isCancel(selection)) return undefined;
  const chosen = new Set(selection as string[]);
  return {
    download: chosen.has("download"),
    transcribe: chosen.has("transcribe"),
    classify: chosen.has("classify"),
  };
}
