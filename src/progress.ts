import { c } from "./render.js";

const FRAMES = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
const CLEAR_LINE = "\r\u001b[2K";

export interface Progress {
  tick(message?: string): void;
  fail(message?: string): void;
  done(summary?: string): void;
}

export function createProgress(options: { total: number; label: string }): Progress {
  const { total, label } = options;
  const stream = process.stderr;
  const tty = Boolean(stream.isTTY);
  let count = 0;
  let frame = 0;

  function render(message: string, failed: boolean): void {
    count += 1;
    if (!tty) {
      stream.write(`${label} ${count}/${total}: ${message}\n`);
      return;
    }
    const spinner = c.accent(FRAMES[frame % FRAMES.length] ?? "");
    frame += 1;
    const counter = c.muted(`${count}/${total}`);
    const status = failed ? c.danger(message) : message;
    stream.write(`${CLEAR_LINE}${spinner} ${label} ${counter} ${status}`);
  }

  return {
    tick(message = ""): void {
      render(message, false);
    },
    fail(message = ""): void {
      render(message, true);
    },
    done(summary?: string): void {
      if (tty) stream.write(CLEAR_LINE);
      if (summary) stream.write(`${summary}\n`);
    },
  };
}
