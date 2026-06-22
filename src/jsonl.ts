import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const rows: T[] = [];
  for (const [idx, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${filePath}:${idx + 1}: ${(error as Error).message}`);
    }
  }
  return rows;
}

export async function writeJsonl<T>(filePath: string, rows: T[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(tmpPath, body.length > 0 ? `${body}\n` : "", "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonFile<T>(filePath: string, value: T, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, mode == null ? undefined : { mode });
  await fs.rename(tmpPath, filePath);
  if (mode != null) await fs.chmod(filePath, mode);
}
