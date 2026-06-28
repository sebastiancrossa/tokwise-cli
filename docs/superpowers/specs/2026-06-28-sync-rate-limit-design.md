# Rate-limit-resilient `tokwise sync`

Date: 2026-06-28

## Problem

Syncing several bookmark collections fails with:

```
Error: Source collection fetch failed: Source returned HTTP 429 Too Many Requests
```

The fetch loop in `runInteractiveSync` is already sequential, so the failure is
not caused by parallelism. The real causes are:

1. No pacing between requests -- pages within a collection and successive
   collections fire back-to-back, tripping TikTok's rate limiter.
2. No backoff -- a single 429 is turned into `{ status: "error" }` by
   `fetchCollectionWithCookie`, then `assertSuccessfulResponse` throws.
3. The throw aborts the whole run via the `safe()` wrapper. Because `discovered`
   is only merged after the full loop, every collection fetched before the 429
   is discarded too.

## Fix

Throttle requests, retry 429/5xx with backoff that honors `Retry-After`, and
isolate each collection so one persistent failure is skipped-and-reported
instead of fatal.

## Components

- **`src/http.ts` (new)** -- a small, testable HTTP layer:
  - `sleep(ms)` -- promise-based delay.
  - `shouldRetry(status)` -- true for 429 and 5xx (pure).
  - `retryDelayMs(status, retryAfterHeader, attempt, baseDelayMs)` -- uses
    `Retry-After` when present and larger, else exponential backoff
    (`base * 2^attempt`) with jitter, capped at a max (pure).
  - `fetchWithRetry(url, init, { maxRetries, baseDelayMs, fetchImpl? })` --
    wraps global `fetch`, retrying while `shouldRetry` and attempts remain.
    `fetchImpl` is injectable for tests.
- **`src/tiktok.ts`**:
  - `fetchCollectionWithCookie` and `fetchCollectionList` call `fetchWithRetry`
    instead of raw `fetch` (this is where the 429 status and `Retry-After`
    header are visible).
  - `fetchPaged` sleeps `requestDelayMs` before each page after the first.
  - `TikTokFetchOptions` gains `requestDelayMs?` and `maxRetries?`, threaded into
    per-call options.
- **`src/cli.ts`**:
  - The `runInteractiveSync` collection loop wraps each `fetchCollection` in
    `try/catch`, sleeps `requestDelayMs` between collections, records failures,
    and after the loop prints a skip/report warning -- then still runs
    `runSyncPipeline` on everything that succeeded.
  - Add `--request-delay <ms>` (default 500) and `--max-retries <n>` (default 3)
    options to `sync`, passed into `fetchOptions` and the loop.
  - The fetch-layer backoff also benefits the explicit `--collection`
    multi-source path with no loop changes there.

## Flow

```
for each selected collection (sequential):
  sleep(requestDelayMs)
  fetchCollection -> fetchPaged -> fetchWithRetry(page)
    429/5xx -> wait(Retry-After | backoff + jitter) -> retry up to maxRetries
    exhausted -> throw -> caught per-collection -> record + continue
runSyncPipeline(succeeded) ; report skipped collections
```

## Defaults

- `--max-retries` = 3 (up to 4 attempts). Backoff 1s / 2s / 4s with jitter,
  capped; `Retry-After` wins if larger.
- `--request-delay` = 500ms between pages and between collections.
- Persistent failure: skip + continue + report, e.g.
  `2 collections were rate-limited and skipped: "babe", "marriage". Re-run or try --request-delay 1500`.
- `fetchBookmarkFolders` still throws if it cannot list folders at all (you
  cannot pick from an empty list), but it retries first.

## Testing

- `tests/http.test.ts`:
  - `shouldRetry`: true for 429 and 5xx, false for 200 / 404.
  - `retryDelayMs`: honors a larger `Retry-After`, grows exponentially, jitter
    stays within bounds, respects the cap.
  - `fetchWithRetry`: with an injected fake fetch, retries the configured number
    of times then returns the last response; succeeds early on a 200.

## Out of scope

- Changing item-fetch contracts or response normalization.
- Parallelism (the loop is already sequential).
- The download / transcribe / classify pipeline.
