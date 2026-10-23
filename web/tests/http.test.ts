import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";

// Fresh modules per test: the cache is a module-level Map. ApiError must come from the same
// module graph as http.ts, or instanceof fails.
let http: typeof import("@/lib/http");
let ApiError: typeof import("@/lib/errors").ApiError;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  http = await import("@/lib/http");
  ({ ApiError } = await import("@/lib/errors"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : "[]", { status, headers });

describe("fetchWithRetry", () => {
  test("retries twice on 503, then throws upstream_failed", async () => {
    const fetch = vi.fn(async () => reply(503));
    vi.stubGlobal("fetch", fetch);
    const result = http.fetchWithRetry("https://x.test", {}, "aviationweather").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await result;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: "upstream_failed", source: "aviationweather" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("caps Retry-After: 30 at 5 s", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(429, { "Retry-After": "30" })).mockResolvedValue(reply(200));
    vi.stubGlobal("fetch", fetch);
    const result = http.fetchWithRetry("https://x.test", {}, "aviationweather");
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await result).status).toBe(200);
  });

  test("retries a network error or timeout, then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValue(reply(200));
    vi.stubGlobal("fetch", fetch);
    const result = http.fetchWithRetry("https://x.test", {}, "opensky");
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("returns a non-retryable 404 at once", async () => {
    const fetch = vi.fn(async () => reply(404));
    vi.stubGlobal("fetch", fetch);
    expect((await http.fetchWithRetry("https://x.test", {}, "opensky")).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("readJson", () => {
  test("204 and 404 mean no data", async () => {
    expect(await http.readJson(reply(204), "aviationweather")).toEqual([]);
    expect(await http.readJson(reply(404), "opensky")).toEqual([]);
  });

  test("other errors throw upstream_failed", async () => {
    await expect(http.readJson(reply(401), "opensky")).rejects.toMatchObject({ code: "upstream_failed" });
  });
});

describe("withCache", () => {
  const ttl = { freshMs: 1000, staleMs: 5000 };
  const fail = () => Promise.reject(new ApiError(502, "upstream_failed", "down", "aviationweather"));

  test("serves a fresh hit, reloads once the entry expires", async () => {
    const load = vi.fn(async () => "v");
    expect(await http.withCache("k", { ...ttl, now: 0 }, load)).toEqual({ value: "v", fresh: true, age_ms: 0 });
    expect(await http.withCache("k", { ...ttl, now: 1000 }, load)).toEqual({ value: "v", fresh: true, age_ms: 1000 });
    expect(load).toHaveBeenCalledTimes(1);
    await http.withCache("k", { ...ttl, now: 1001 }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test("falls back to a stale entry on an upstream error", async () => {
    await http.withCache("k", { ...ttl, now: 0 }, async () => "v");
    expect(await http.withCache("k", { ...ttl, now: 4000 }, fail)).toEqual({ value: "v", fresh: false, age_ms: 4000 });
  });

  test("rethrows when the entry is past stale or the error is not upstream", async () => {
    await http.withCache("k", { ...ttl, now: 0 }, async () => "v");
    await expect(http.withCache("k", { ...ttl, now: 5001 }, fail)).rejects.toBeInstanceOf(ApiError);
    await http.withCache("j", { ...ttl, now: 0 }, async () => "v");
    const bug = () => Promise.reject(new Error("bug"));
    await expect(http.withCache("j", { ...ttl, now: 2000 }, bug)).rejects.toThrow("bug");
  });

  test("isUpstreamError accepts ApiError and ZodError only", () => {
    expect(http.isUpstreamError(new ApiError(502, "upstream_failed", "x", "opensky"))).toBe(true);
    expect(http.isUpstreamError(new ZodError([]))).toBe(true);
    expect(http.isUpstreamError(new Error("x"))).toBe(false);
  });
});
