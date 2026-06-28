import { c } from "./render.js";

const FRAMES = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
const CLEAR_LINE = "\r\u001b[2K";
const FRAME_INTERVAL_MS = 80;

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
  let current = "";
  let failed = false;
  let timer: NodeJS.Timeout | undefined;

  function draw(): void {
    const spinner = c.accent(FRAMES[frame % FRAMES.length] ?? "");
    const counter = c.muted(`${count}/${total}`);
    const status = failed ? c.danger(current) : current;
    stream.write(`${CLEAR_LINE}${spinner} ${label} ${counter} ${status}`.trimEnd());
  }

  if (tty && total > 0) {
    draw();
    timer = setInterval(() => {
      frame += 1;
      draw();
    }, FRAME_INTERVAL_MS);
    timer.unref();
  }

  function update(message: string, isFailure: boolean): void {
    count += 1;
    current = message;
    failed = isFailure;
    if (!tty) {
      stream.write(`${label} ${count}/${total}: ${message}\n`);
      return;
    }
    draw();
  }

  return {
    tick(message = ""): void {
      update(message, false);
    },
    fail(message = ""): void {
      update(message, true);
    },
    done(summary?: string): void {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (tty) stream.write(CLEAR_LINE);
      if (summary) stream.write(`${summary}\n`);
    },
  };
}

const DEFAULT_SPINNER_MESSAGES = [
  "Thinking",
  "Pondering",
  "Rummaging through your bookmarks",
  "Connecting the dots",
  "Cogitating",
  "Synthesizing",
  "Consulting the archive",
  "Musing",
  "Distilling insights",
];

const MESSAGE_INTERVAL_MS = 2500;

export interface Spinner {
  start(): void;
  stop(): void;
}

export function createSpinner(options: { messages?: string[]; messageIntervalMs?: number } = {}): Spinner {
  const messages = options.messages ?? DEFAULT_SPINNER_MESSAGES;
  const messageIntervalMs = options.messageIntervalMs ?? MESSAGE_INTERVAL_MS;
  const stream = process.stderr;
  const tty = Boolean(stream.isTTY);
  let running = false;
  let frame = 0;
  let messageIndex = 0;
  let startedAt = 0;
  let frameTimer: NodeJS.Timeout | undefined;
  let messageTimer: NodeJS.Timeout | undefined;

  function draw(): void {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    const spinner = c.accent(FRAMES[frame % FRAMES.length] ?? "");
    const message = messages[messageIndex % messages.length] ?? "Thinking";
    stream.write(`${CLEAR_LINE}${spinner} ${message}\u2026 ${c.muted(`(${elapsedSec}s)`)}`);
  }

  function clearTimers(): void {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = undefined;
    }
    if (messageTimer) {
      clearInterval(messageTimer);
      messageTimer = undefined;
    }
  }

  return {
    start(): void {
      if (running || !tty) return;
      running = true;
      startedAt = Date.now();
      frame = 0;
      messageIndex = 0;
      draw();
      frameTimer = setInterval(() => {
        frame += 1;
        draw();
      }, FRAME_INTERVAL_MS);
      frameTimer.unref();
      messageTimer = setInterval(() => {
        messageIndex += 1;
        draw();
      }, messageIntervalMs);
      messageTimer.unref();
    },
    stop(): void {
      if (!running) return;
      running = false;
      clearTimers();
      if (tty) stream.write(CLEAR_LINE);
    },
  };
}
