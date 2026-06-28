export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchWithRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: FetchLike;
}

const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(retryAfter: string | null | undefined): number | undefined {
  if (!retryAfter) return undefined;
  const trimmed = retryAfter.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function retryDelayMs(
  status: number,
  retryAfter: string | null | undefined,
  attempt: number,
  baseDelayMs = 1000,
): number {
  const backoff = Math.min(baseDelayMs * 2 ** Math.max(0, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * baseDelayMs;
  const computed = Math.min(backoff + jitter, MAX_BACKOFF_MS);
  const headerMs = parseRetryAfterMs(retryAfter);
  if (headerMs != null) return Math.min(Math.max(headerMs, computed), MAX_RETRY_AFTER_MS);
  return computed;
}

export async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const doFetch: FetchLike = options.fetchImpl ?? fetch;

  let attempt = 0;
  for (;;) {
    const response = await doFetch(input, init);
    if (!shouldRetry(response.status) || attempt >= maxRetries) return response;
    await sleep(retryDelayMs(response.status, response.headers.get("retry-after"), attempt, baseDelayMs));
    attempt += 1;
  }
}
