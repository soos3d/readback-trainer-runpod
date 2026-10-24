import { afterEach, describe, expect, test, vi } from "vitest";
import { mulberry32 } from "@/lib/prng";
import { AIRPORTS, AirportsFile, GradeRequest, isTodo, ScenarioRequest, SpeakRequest } from "@/lib/schemas";
import { ApiError, log, SpeechFailed, SpeechWarming, toResponse } from "@/lib/errors";
import { requireEnv } from "@/lib/env";
import airportsJson from "@/lib/airports.json";

describe("mulberry32", () => {
  test("same seed yields the same first 5 values", () => {
    const take5 = () => {
      const next = mulberry32(42);
      return Array.from({ length: 5 }, () => next());
    };
    const first = take5();
    expect(take5()).toEqual(first);
    expect(new Set(first).size).toBe(5);
    first.forEach((v) => expect(v >= 0 && v < 1).toBe(true));
  });

  test("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("ScenarioRequest", () => {
  const ok = { airport: "KTTD", type: "takeoff" };

  test("accepts a known airport with optional seed and simulate", () => {
    expect(ScenarioRequest.parse({ ...ok, seed: 999_999, simulate: ["awc_down"] })).toEqual({
      ...ok,
      seed: 999_999,
      simulate: ["awc_down"],
    });
  });

  test.each([
    ["KX1", { ...ok, airport: "KX1" }],
    ["unknown ICAO", { ...ok, airport: "KZZZ" }],
    ["extra key", { ...ok, extra: 1 }],
    ["seed 1,000,000", { ...ok, seed: 1_000_000 }],
    ["fractional seed", { ...ok, seed: 1.5 }],
    ["bad type", { ...ok, type: "landing" }],
    ["bad simulate", { ...ok, simulate: ["gpu_down"] }],
  ])("rejects %s", (_label, body) => {
    expect(ScenarioRequest.safeParse(body).success).toBe(false);
  });
});

describe("request bodies", () => {
  test("SpeakRequest strips control characters and caps at 600 printable ASCII", () => {
    expect(SpeakRequest.parse({ text: "climb\u0007 and maintain" }).text).toBe("climb and maintain");
    expect(SpeakRequest.safeParse({ text: "x".repeat(601) }).success).toBe(false);
    expect(SpeakRequest.safeParse({ text: "café" }).success).toBe(false);
  });

  test("GradeRequest rejects a malformed scenario", () => {
    expect(GradeRequest.safeParse({ scenario: {}, transcript: "hi" }).success).toBe(false);
  });
});

describe("airports.json", () => {
  test("parses and holds the three pilot airports", () => {
    expect(Object.keys(AIRPORTS).sort()).toEqual(["KORL", "KTTD", "KVGT"]);
    expect(AIRPORTS.KTTD.runways_fallback).toEqual([{ id: "07/25", alignment: 89 }]);
  });

  test("shipped file: approaches is the only TODO left, except KORL's tower fallback", () => {
    const todos = Object.entries(AIRPORTS).flatMap(([icao, a]) =>
      Object.entries(a).filter(([, v]) => isTodo(v) || (typeof v === "object" && Object.values(v).some(isTodo)))
        .map(([field]) => `${icao}.${field}`),
    );
    expect(todos.sort()).toEqual(["KORL.approaches", "KORL.tower_fallback_freq", "KTTD.approaches", "KVGT.approaches"]);
    expect(isTodo("118.7")).toBe(false);
  });

  test("rejects a guessed-looking bad frequency and a stray key", () => {
    const kttd = airportsJson.KTTD;
    expect(AirportsFile.safeParse({ KTTD: { ...kttd, tower_fallback_freq: "120" } }).success).toBe(false);
    expect(AirportsFile.safeParse({ KTTD: { ...kttd, tower: "x" } }).success).toBe(false);
  });
});

describe("errors", () => {
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

describe("requireEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("throws naming the missing var", () => {
    expect(() => requireEnv("NOPE")).toThrow("NOPE is not set; see web/.env.example");
  });

  test("returns a set value", () => {
    vi.stubEnv("SOME_KEY", "v");
    expect(requireEnv("SOME_KEY")).toBe("v");
  });
});
