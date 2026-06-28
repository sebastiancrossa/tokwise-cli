import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function skillContent(): string {
  return [
    "---",
    "name: tokwise",
    "description: Search and use the user's local Tokwise archive of saved short-form video transcripts.",
    "---",
    "",
    "# Tokwise",
    "",
    "Use this skill when the user asks about saved short-form videos, life advice clips, transcript patterns, or similarities across saved clips.",
    "",
    "## Commands",
    "",
    "- `tokwise status` shows whether the archive exists and how many transcripts are available.",
    "- `tokwise search \"query\" --limit 8` searches descriptions, hashtags, summaries, and transcripts.",
    "- `tokwise show <id>` prints full metadata and transcript for one video.",
    "- `tokwise similar <id>` finds related videos by transcript and metadata overlap.",
    "- `tokwise ask \"question\"` returns top local evidence; add `--engine ollama --model <model>` only when the user wants local synthesis.",
    "- `tokwise md` and `tokwise wiki` export Markdown pages under the local library.",
    "- `tw` is the short alias for `tokwise`.",
    "",
    "## Grounding",
    "",
    "Cite clips by their readable reference (`@author \u00b7 Mon YYYY \u2014 \"title\"`, optionally with the trailing short id like `#49952278`) or by Markdown page path when drawing conclusions. Run `tokwise show <short-id-or-url>` to pull a clip back up. Treat transcripts as user-owned local context and do not assume videos are public.",
    "",
  ].join("\n");
}

export async function installSkill(target: "codex" | "claude" | "all" = "all"): Promise<string[]> {
  const destinations: string[] = [];
  if (target === "codex" || target === "all") {
    destinations.push(path.join(os.homedir(), ".codex", "skills", "tokwise", "SKILL.md"));
  }
  if (target === "claude" || target === "all") {
    destinations.push(path.join(os.homedir(), ".claude", "skills", "tokwise", "SKILL.md"));
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
    destinations.push(path.join(os.homedir(), ".codex", "skills", "tokwise"));
  }
  if (target === "claude" || target === "all") {
    destinations.push(path.join(os.homedir(), ".claude", "skills", "tokwise"));
  }
  for (const destination of destinations) {
    await fs.rm(destination, { recursive: true, force: true });
  }
  return destinations;
}
