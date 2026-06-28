import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry, retryDelayMs, shouldRetry, type FetchLike } from "../src/http.js";

test("shouldRetry is true for 429 and 5xx, false otherwise", () => {
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(500), true);
  assert.equal(shouldRetry(503), true);
  assert.equal(shouldRetry(200), false);
  assert.equal(shouldRetry(404), false);
  assert.equal(shouldRetry(400), false);
});

test("retryDelayMs grows exponentially with jitter within bounds", () => {
  const base = 1000;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const backoff = base * 2 ** attempt;
    const delay = retryDelayMs(429, null, attempt, base);
    assert.ok(delay >= backoff, `delay ${delay} should be >= backoff ${backoff}`);
    assert.ok(delay <= backoff + base, `delay ${delay} should be <= ${backoff + base}`);
  }
});

test("retryDelayMs honors a larger Retry-After header in seconds", () => {
  assert.equal(retryDelayMs(429, "30", 0, 1000), 30_000);
});

test("retryDelayMs ignores a Retry-After smaller than the computed backoff", () => {
  // attempt 3 -> backoff 8000ms; Retry-After of 1s is smaller, so backoff wins
  assert.ok(retryDelayMs(429, "1", 3, 1000) >= 8000);
});

test("retryDelayMs caps backoff at the maximum", () => {
  assert.ok(retryDelayMs(429, null, 20, 1000) <= 30_000);
});

test("fetchWithRetry retries on 429 then succeeds", async () => {
  let calls = 0;
  const fakeFetch: FetchLike = async () => {
    calls += 1;
    return calls < 3 ? new Response("rate limited", { status: 429 }) : new Response("ok", { status: 200 });
  };
  const response = await fetchWithRetry("https://example.com", undefined, {
    maxRetries: 5,
    baseDelayMs: 1,
    fetchImpl: fakeFetch,
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("fetchWithRetry gives up after maxRetries and returns the last response", async () => {
  let calls = 0;
  const fakeFetch: FetchLike = async () => {
    calls += 1;
    return new Response("rate limited", { status: 429 });
  };
  const response = await fetchWithRetry("https://example.com", undefined, {
    maxRetries: 2,
    baseDelayMs: 1,
    fetchImpl: fakeFetch,
  });
  assert.equal(response.status, 429);
  assert.equal(calls, 3); // initial attempt + 2 retries
});

test("fetchWithRetry does not retry a successful response", async () => {
  let calls = 0;
  const fakeFetch: FetchLike = async () => {
    calls += 1;
    return new Response("ok", { status: 200 });
  };
  const response = await fetchWithRetry("https://example.com", undefined, { baseDelayMs: 1, fetchImpl: fakeFetch });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
