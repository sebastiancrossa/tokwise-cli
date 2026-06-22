import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function skillContent(): string {
  return [
    "---",
    "name: tiktoktheory",
    "description: Search and use the user's local TikTok Theory archive of saved TikTok transcripts.",
    "---",
    "",
    "# TikTok Theory",
    "",
    "Use this skill when the user asks about saved TikTok videos, life advice clips, transcript patterns, or similarities across saved TikToks.",
    "",
    "## Commands",
    "",
    "- `tt status` shows whether the archive exists and how many transcripts are available.",
    "- `tt search \"query\" --limit 8` searches descriptions, hashtags, summaries, and transcripts.",
    "- `tt show <id>` prints full metadata and transcript for one video.",
    "- `tt similar <id>` finds related videos by transcript and metadata overlap.",
    "- `tt ask \"question\"` returns top local evidence; add `--engine ollama --model <model>` only when the user wants local synthesis.",
    "- `tt md` and `tt wiki` export Markdown pages under the local library.",
    "",
    "## Grounding",
    "",
    "Cite TikTok video ids or Markdown page paths when drawing conclusions. Treat transcripts as user-owned local context and do not assume videos are public.",
    "",
  ].join("\n");
}

export async function installSkill(target: "codex" | "claude" | "all" = "all"): Promise<string[]> {
  const destinations: string[] = [];
  if (target === "codex" || target === "all") {
    destinations.push(path.join(os.homedir(), ".codex", "skills", "tiktoktheory", "SKILL.md"));
  }
  if (target === "claude" || target === "all") {
    destinations.push(path.join(os.homedir(), ".claude", "skills", "tiktoktheory", "SKILL.md"));
  }
  for (const destination of destinations) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, skillContent(), "utf8");
  }
  return destinations;
}

export async function uninstallSkill(target: "codex" | "claude" | "all" = "all"): Promise<string[]> {
  const destinations: string[] = [];
  if (target === "codex" || target === "all") {
    destinations.push(path.join(os.homedir(), ".codex", "skills", "tiktoktheory"));
  }
  if (target === "claude" || target === "all") {
    destinations.push(path.join(os.homedir(), ".claude", "skills", "tiktoktheory"));
  }
  for (const destination of destinations) {
    await fs.rm(destination, { recursive: true, force: true });
  }
  return destinations;
}
