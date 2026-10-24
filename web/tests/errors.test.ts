import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, log, SpeechFailed, SpeechWarming, toResponse } from "@/lib/errors";
import { ScenarioRequest } from "@/lib/schemas";

describe("toResponse", () => {
  test("SpeechWarming maps to 503 speech_warming", async () => {
    const res = toResponse(new SpeechWarming());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({ code: "speech_warming", source: "speech" });
  });

  test("SpeechFailed maps to 502 speech_failed", async () => {
    const res = toResponse(new SpeechFailed());
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("speech_failed");
  });

  test("ApiError keeps its status, code, message and source", async () => {
    const res = toResponse(new ApiError(429, "rate_limited", "Slow down", "web"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: "Slow down", source: "web" } });
  });

  test("ZodError maps to 422 invalid_input", async () => {
    const parsed = ScenarioRequest.safeParse({ airport: "KX1", type: "takeoff" });
    const res = toResponse(parsed.error);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "invalid_input", source: "web" });
  });

  test("unknown errors map to 500 internal without leaking the message", async () => {
    const res = toResponse(new Error("db password is hunter2"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  test("writes only the allowed fields as one JSON line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const entry = { route: "/api/scenario", status: 200, latency_ms: 12, cache: "hit", fallback: false, secret: "x" };
    log(entry as Parameters<typeof log>[0]);
    expect(JSON.parse(info.mock.calls[0][0])).toEqual({
      route: "/api/scenario",
      status: 200,
      latency_ms: 12,
      cache: "hit",
      fallback: false,
    });
  });

  test("uses console.error for 5xx", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log({ route: "/api/speak", status: 502, latency_ms: 80_000 });
    expect(error).toHaveBeenCalledOnce();
  });
});
