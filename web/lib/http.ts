import "server-only";
// Upstream fetch with timeout and retry, plus the module-level TTL cache (SPEC §13.1, §13.2).
import { ZodError } from "zod";
import { ApiError } from "./errors";
import { mulberry32 } from "./prng";
import type { ErrorSource } from "./schemas";

const TIMEOUT_MS = 6000;
const BACKOFF_MS = [500, 1000];
const JITTER_MS = 250;
const MAX_RETRY_AFTER_MS = 5000;
const jitter = mulberry32(Date.now()); // jitter only spreads retries; it needs no fixed seed

const retryable = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(attempt: number, res: Response | null): number {
  const after = Number(res?.headers.get("Retry-After") ?? NaN);
  if (Number.isFinite(after) && after >= 0) return Math.min(after * 1000, MAX_RETRY_AFTER_MS);
  return BACKOFF_MS[attempt] + jitter() * JITTER_MS;
}

// Retries network errors, timeouts, 429 and 5xx twice; returns any other response as is.
export async function fetchWithRetry(url: string, init: RequestInit, source: ErrorSource): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let failure: string;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!retryable(res.status)) return res;
      failure = `status ${res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.name : "network error";
    }
    if (attempt >= BACKOFF_MS.length) {
      throw new ApiError(502, "upstream_failed", `${source} failed after retries (${failure})`, source);
    }
    await sleep(retryDelay(attempt, res));
  }
}

// 204 and 404 mean "no data" for both AWC and OpenSky.
export async function readJson(res: Response, source: ErrorSource): Promise<unknown> {
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) throw new ApiError(502, "upstream_failed", `${source} returned ${res.status}`, source);
  return res.json();
}

// Upstream failures fall back; anything else (missing env, our bugs) propagates.
export const isUpstreamError = (err: unknown): boolean => err instanceof ApiError || err instanceof ZodError;

type Entry = { value: unknown; at: number };
const cache = new Map<string, Entry>();

export type CacheResult<T> = { value: T; fresh: boolean; age_ms: number };

// Fresh hit → no load. Otherwise load; on an upstream error serve the entry if it is within staleMs.
// The caller owns the key namespace, so each key always holds the same T.
export async function withCache<T>(
  key: string,
  { freshMs, staleMs, now }: { freshMs: number; staleMs: number; now: number },
  load: () => Promise<T>,
): Promise<CacheResult<T>> {
  const hit = cache.get(key);
  const age = hit ? now - hit.at : Infinity;
  if (hit && age <= freshMs) return { value: hit.value as T, fresh: true, age_ms: age };
  try {
    const value = await load();
    cache.set(key, { value, at: now });
    return { value, fresh: true, age_ms: 0 };
  } catch (err) {
    if (hit && age <= staleMs && isUpstreamError(err)) return { value: hit.value as T, fresh: false, age_ms: age };
    throw err;
  }
}

// What a source does under READBACK_DEMO_MODE simulate (SPEC §13.3).
export function simulatedOutage(source: ErrorSource): Promise<never> {
  return Promise.reject(new ApiError(502, "upstream_failed", `${source} returned 503 (simulated)`, source));
}
