import { exec as execCallback } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (error.code === "ENOENT") {
        resolve({
          code: 127,
          stdout,
          stderr: `Command not found: ${command}. Install it or pass a custom command path.`,
        });
        return;
      }
      if (error.code === "EACCES") {
        resolve({
          code: 126,
          stdout,
          stderr: `Command is not executable: ${command}. Check permissions or pass a custom command path.`,
        });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

export async function runShell(command: string, options?: { cwd?: string }): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await exec(command, { cwd: options?.cwd, maxBuffer: 1024 * 1024 * 20 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as Error & { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message };
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await runProcess(command, ["--version"]);
  return result.code === 0;
}

export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function templateCommand(template: string, values: Record<string, string | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) => quoteShell(values[key] ?? ""));
}
