import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { commandsDir, ensureDataDirs, libraryDir } from "./paths.js";
import { readTextInput, resolveMaybeRelative } from "./store.js";
import { tokenize } from "./search.js";

export interface LibrarySearchResult {
  path: string;
  score: number;
  preview: string;
}

export async function searchLibrary(query: string, limit = 20): Promise<LibrarySearchResult[]> {
  ensureDataDirs();
  const terms = new Set(tokenize(query));
  const files = await listMarkdownFiles(libraryDir());
  const results: LibrarySearchResult[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const tokens = tokenize(text);
    const score = tokens.reduce((sum, token) => sum + (terms.has(token) ? 1 : 0), 0);
    if (score > 0) {
      results.push({
        path: path.relative(libraryDir(), file),
        score,
        preview: text.replace(/\s+/g, " ").slice(0, 220),
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function showLibraryPage(pagePath: string): Promise<{ path: string; sha256: string; body: string }> {
  const safePath = resolveUnder(libraryDir(), pagePath);
  const body = await fs.readFile(safePath, "utf8");
  return { path: path.relative(libraryDir(), safePath), sha256: sha256(body), body };
}

export async function createLibraryPage(pagePath: string, inputPath: string): Promise<string> {
  const safePath = resolveUnder(libraryDir(), pagePath);
  const body = await readTextInput(inputPath);
  await fs.mkdir(path.dirname(safePath), { recursive: true });
  await fs.writeFile(safePath, body, { encoding: "utf8", flag: "wx" });
  return safePath;
}

export async function updateLibraryPage(pagePath: string, inputPath: string, expectedSha256?: string): Promise<string> {
  const safePath = resolveUnder(libraryDir(), pagePath);
  const previous = await fs.readFile(safePath, "utf8");
  if (expectedSha256 && sha256(previous) !== expectedSha256) {
    throw new Error("Library page changed since it was read. Re-run show and pass the new sha256.");
  }
  const body = await readTextInput(inputPath);
  await fs.writeFile(safePath, body, "utf8");
  return safePath;
}

export async function deleteLibraryPage(pagePath: string): Promise<string> {
  const safePath = resolveUnder(libraryDir(), pagePath);
  const trashDir = path.join(libraryDir(), ".trash");
  await fs.mkdir(trashDir, { recursive: true });
  const target = path.join(trashDir, `${Date.now()}-${path.basename(pagePath)}`);
  await fs.rename(safePath, target);
  return target;
}

export async function listCommands(): Promise<string[]> {
  ensureDataDirs();
  try {
    return (await fs.readdir(commandsDir())).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

export async function createCommand(name: string): Promise<string> {
  ensureDataDirs();
  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  const safePath = resolveUnder(commandsDir(), fileName);
  const body = [
    `# ${path.basename(fileName, ".md")}`,
    "",
    "## Purpose",
    "",
    "Describe the reusable workflow this command should run.",
    "",
    "## Steps",
    "",
    "1. Search the local TikTok Theory archive when relevant.",
    "2. Ground claims in video ids or Markdown pages.",
    "3. Report uncertainty clearly.",
    "",
  ].join("\n");
  await fs.writeFile(safePath, body, { encoding: "utf8", flag: "wx" });
  return safePath;
}

export async function validateCommands(name?: string): Promise<{ ok: string[]; issues: string[] }> {
  const names = name ? [name.endsWith(".md") ? name : `${name}.md`] : await listCommands();
  const ok: string[] = [];
  const issues: string[] = [];
  for (const commandName of names) {
    const filePath = resolveUnder(commandsDir(), commandName);
    try {
      const body = await fs.readFile(filePath, "utf8");
      if (!body.startsWith("# ")) issues.push(`${commandName}: missing title`);
      else if (!body.includes("##")) issues.push(`${commandName}: add at least one section heading`);
      else ok.push(commandName);
    } catch (error) {
      issues.push(`${commandName}: ${(error as Error).message}`);
    }
  }
  return { ok, issues };
}

function resolveUnder(root: string, requested: string): string {
  const resolved = path.resolve(root, requested);
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(`${normalizedRoot}${path.sep}`) && resolved !== normalizedRoot) {
    throw new Error(`Path escapes ${root}: ${requested}`);
  }
  return resolved;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== ".trash") files.push(...(await listMarkdownFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function sha256(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function resolveExternalPath(filePath: string): string {
  return resolveMaybeRelative(filePath);
}
