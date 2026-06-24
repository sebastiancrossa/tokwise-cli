import pc from "picocolors";

const raw = pc.createColors(true);

let colorEnabled = pc.isColorSupported;

export function setColorEnabled(on: boolean): void {
  colorEnabled = on;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

type StyleFn = (text: string) => string;

function style(fn: StyleFn): StyleFn {
  return (text: string) => (colorEnabled ? fn(text) : text);
}

export const c = {
  heading: style((text) => raw.bold(raw.cyan(text))),
  label: style((text) => text),
  value: style((text) => raw.bold(text)),
  muted: style((text) => raw.dim(text)),
  accent: style((text) => raw.cyan(text)),
  success: style((text) => raw.green(text)),
  warn: style((text) => raw.yellow(text)),
  danger: style((text) => raw.red(text)),
} as const;

const PALETTE: StyleFn[] = [raw.cyan, raw.green, raw.yellow, raw.magenta, raw.blue, raw.red];

function paletteColor(index: number): StyleFn {
  const fn = PALETTE[index % PALETTE.length] ?? raw.cyan;
  return style(fn);
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

export function padEndVisible(text: string, width: number): string {
  const pad = width - visibleWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, Math.max(0, max));
  return `${text.slice(0, max - 1)}\u2026`;
}

export function rule(width = 60): string {
  return c.muted("\u2500".repeat(width));
}

export function box(title: string, lines: string[]): string {
  const titleWidth = visibleWidth(title);
  const bodyWidth = Math.max(titleWidth + 1, 0, ...lines.map(visibleWidth));
  const interior = bodyWidth + 2;
  const dashCount = Math.max(0, interior - (titleWidth + 3));
  const top = c.muted("\u256d\u2500 ") + c.heading(title) + c.muted(` ${"\u2500".repeat(dashCount)}\u256e`);
  const bottom = c.muted(`\u2570${"\u2500".repeat(interior)}\u256f`);
  const body = lines.map((line) => `${c.muted("\u2502")} ${padEndVisible(line, bodyWidth)} ${c.muted("\u2502")}`);
  return [top, ...body, bottom].join("\n");
}

const EIGHTHS = ["", "\u258f", "\u258e", "\u258d", "\u258c", "\u258b", "\u258a", "\u2589"];
const FULL_BLOCK = "\u2588";

function bar(value: number, max: number, width: number): string {
  if (max <= 0 || value <= 0) return "";
  const eighths = Math.round((value / max) * width * 8);
  const full = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  let result = FULL_BLOCK.repeat(full);
  if (remainder > 0) result += EIGHTHS[remainder];
  if (result === "") result = EIGHTHS[1] ?? FULL_BLOCK;
  return result;
}

export interface BarChartOptions {
  width?: number;
  total?: number;
  limit?: number;
  color?: boolean;
}

export function barChart(entries: Array<[string, number]>, options: BarChartOptions = {}): string {
  const width = options.width ?? 24;
  const limit = options.limit ?? entries.length;
  const sorted = [...entries].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (sorted.length === 0) return c.muted("(none)");
  const total = options.total ?? entries.reduce((sum, [, count]) => sum + count, 0);
  const max = Math.max(1, ...sorted.map(([, count]) => count));
  const labelWidth = Math.max(...sorted.map(([label]) => label.length));
  const countWidth = Math.max(...sorted.map(([, count]) => String(count).length));
  return sorted
    .map(([label, count], index) => {
      const barText = bar(count, max, width);
      const coloredBar = options.color === false ? barText : paletteColor(index)(barText);
      const percent = total > 0 ? `${Math.round((count / total) * 100)}%` : "";
      return [
        "  ",
        c.label(padEndVisible(label, labelWidth)),
        "  ",
        padEndVisible(coloredBar, width),
        "  ",
        c.value(String(count).padStart(countWidth)),
        "  ",
        c.muted(percent),
      ].join("");
    })
    .join("\n");
}

export function kvList(pairs: Array<[string, string]>): string {
  if (pairs.length === 0) return "";
  const keyWidth = Math.max(...pairs.map(([key]) => visibleWidth(key)));
  return pairs.map(([key, value]) => `${c.label(padEndVisible(key, keyWidth))}  ${value}`).join("\n");
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(visibleWidth(header), ...rows.map((row) => visibleWidth(row[index] ?? ""))),
  );
  const renderRow = (cells: string[]): string =>
    cells.map((cell, index) => padEndVisible(cell, widths[index] ?? 0)).join("  ");
  const head = c.heading(renderRow(headers));
  const body = rows.map((row) => renderRow(row));
  return [head, ...body].join("\n");
}
