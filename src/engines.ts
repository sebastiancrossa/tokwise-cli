import { access, constants } from "node:fs/promises";
import path from "node:path";

export interface EngineAvailability {
  ytDlp: boolean;
  whisper: boolean;
}

async function canExecute(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Detect a command by resolving it on PATH rather than executing it with a
// flag: tools disagree on whether `--version`/`--help` exit 0 (OpenAI whisper
// errors on `--version`), so a PATH lookup is the only reliable presence check.
async function isOnPath(command: string): Promise<boolean> {
  if (command.includes(path.sep)) return canExecute(command);
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (await canExecute(path.join(dir, command + ext))) return true;
    }
  }
  return false;
}

export async function detectEngines(options?: { ytDlp?: string }): Promise<EngineAvailability> {
  const ytDlpCommand = options?.ytDlp ?? "yt-dlp";
  const [ytDlp, whisper, whisperCpp] = await Promise.all([
    isOnPath(ytDlpCommand),
    isOnPath("whisper"),
    isOnPath("whisper-cli"),
  ]);
  return { ytDlp, whisper: whisper || whisperCpp };
}
