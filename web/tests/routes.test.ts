import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError, SpeechFailed, SpeechWarming } from "@/lib/errors";
import { encodeWav, toBase64 } from "@/lib/client/wavEncode";
import type { Scenario, Snapshot } from "@/lib/schemas";
import { getAirportInfo, getWeather } from "@/lib/sources/aviationweather";
import { getFlight } from "@/lib/sources/opensky";
import { synthesize, transcribe, warmUp } from "@/lib/runpod";
import { checkWav } from "@/lib/wav";
import { buildScenario } from "@/lib/scenarios";
import * as airportsRoute from "@/app/api/airports/route";
import * as scenarioRoute from "@/app/api/scenario/route";
import * as speakRoute from "@/app/api/speak/route";
import * as attemptRoute from "@/app/api/attempt/route";
import * as gradeRoute from "@/app/api/grade/route";
import * as warmupRoute from "@/app/api/warmup/route";

vi.mock("@/lib/runpod", () => ({ synthesize: vi.fn(), transcribe: vi.fn(), warmUp: vi.fn() }));
vi.mock("@/lib/sources/aviationweather", () => ({ getWeather: vi.fn(), getAirportInfo: vi.fn() }));
vi.mock("@/lib/sources/opensky", () => ({ getFlight: vi.fn() }));
// The real builder by default; a test can make it throw without depending on airports.json contents.
vi.mock("@/lib/scenarios", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/scenarios")>();
  return { buildScenario: vi.fn(real.buildScenario) };
});

const WEATHER: Snapshot["weather"] = {
  data: { wind_dir_true: 80, wind_kt: 9, gust_kt: null, altimeter_inhg: 30.02, metar_raw: "KTTD 231553Z 08009KT A3002", obs_time: null },
  provenance: { source: "live" },
  warnings: [],
};
const AIRPORT: Snapshot["airport"] = {
  data: { name: "TROUTDALE", magdec_east_deg: 15, runways: [{ id: "07/25", alignment: 89 }], tower_freq: "120.9" },
  provenance: { source: "live" },
  warnings: [],
};
const FLIGHT: Snapshot["flight"] = {
  data: { tail: "N123AB", other_airport: "KTTD", date: "2026-10-22" },
  provenance: { source: "opensky", date: "2026-10-22" },
  warnings: [],
};

// Each test gets its own client IP, so rate-limit counters never leak between tests.
let ipCounter = 0;
let ip = "";
function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const wavB64 = (seconds: number) => toBase64(encodeWav(new Float32Array(Math.round(seconds * 16000))));

function wav8k(): string {
  const bytes = encodeWav(new Float32Array(8000));
  const v = new DataView(bytes.buffer);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  return toBase64(bytes);
}

async function makeScenario(): Promise<Scenario> {
  const res = await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "takeoff", seed: 7 }));
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  ip = `203.0.113.${++ipCounter}`;
  vi.mocked(getWeather).mockResolvedValue(WEATHER);
  vi.mocked(getAirportInfo).mockResolvedValue(AIRPORT);
  vi.mocked(getFlight).mockResolvedValue(FLIGHT);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("route config", () => {
  test("every route runs on nodejs, force-dynamic", () => {
    for (const r of [airportsRoute, scenarioRoute, speakRoute, attemptRoute, gradeRoute, warmupRoute]) {
      expect(r.runtime).toBe("nodejs");
      expect(r.dynamic).toBe("force-dynamic");
    }
  });
});

describe("/api/airports", () => {
  test("lists the three airports", async () => {
    const res = await airportsRoute.GET(new Request("http://localhost/api/airports"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((a: { icao: string }) => a.icao)).toEqual(["KTTD", "KORL", "KVGT"]);
    expect(body[0]).toEqual({ icao: "KTTD", radio_name: "Troutdale", name: "Troutdale" });
  });
});

describe("/api/scenario", () => {
  test("200 with mocked sources; departure flight for takeoff; one log line", async () => {
    const s = await makeScenario();
    expect(s.scenario_id).toBe("KTTD-takeoff-7");
    expect(s.callsign.tail).toBe("N123AB");
    expect(getFlight).toHaveBeenCalledWith("KTTD", "departure", { simulateDown: false, seed: 7 });
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({ route: "/api/scenario", status: 200 });
  });

  test("seed defaults to a random int in 0..999,999", async () => {
    const res = await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "takeoff" }));
    const { seed } = await res.json();
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 999_999).toBe(true);
  });

  test("approach types ask for an arrival flight", async () => {
    await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "approach_vectors", seed: 1 }));
    expect(getFlight).toHaveBeenCalledWith("KTTD", "arrival", expect.anything());
  });

  test("bad ICAO → 422 invalid_input", async () => {
    const res = await scenarioRoute.POST(post("/api/scenario", { airport: "KX1", type: "takeoff" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_input");
  });

  test("malformed JSON → 422", async () => {
    const res = await scenarioRoute.POST(post("/api/scenario", "{nope"));
    expect(res.status).toBe(422);
  });

  test("TODO airport fields → the builder's 422 passes through", async () => {
    const message = "KTTD needs min_vector_altitude in airports.json for ifr_clearance";
    vi.mocked(buildScenario).mockImplementationOnce(() => {
      throw new ApiError(422, "invalid_input", message, "web");
    });
    const res = await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "ifr_clearance", seed: 1 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "invalid_input", message });
  });

  test("simulate ignored when demo mode is off", async () => {
    await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "takeoff", seed: 1, simulate: ["awc_down", "opensky_down"] }));
    expect(getWeather).toHaveBeenCalledWith("KTTD", { simulateDown: false });
    expect(getFlight).toHaveBeenCalledWith("KTTD", "departure", { simulateDown: false, seed: 1 });
  });

  test("simulate honored per source when READBACK_DEMO_MODE=1", async () => {
    vi.stubEnv("READBACK_DEMO_MODE", "1");
    await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "takeoff", seed: 1, simulate: ["opensky_down"] }));
    expect(getWeather).toHaveBeenCalledWith("KTTD", { simulateDown: false });
    expect(getAirportInfo).toHaveBeenCalledWith("KTTD", { simulateDown: false });
    expect(getFlight).toHaveBeenCalledWith("KTTD", "departure", { simulateDown: true, seed: 1 });
  });

  test("a fallback in the snapshot is logged as fallback: true", async () => {
    vi.mocked(getFlight).mockResolvedValue({ ...FLIGHT, provenance: { source: "synthetic" }, warnings: ["Flight data unavailable — using a made-up callsign"] });
    const res = await scenarioRoute.POST(post("/api/scenario", { airport: "KTTD", type: "takeoff", seed: 1 }));
    expect((await res.json()).warnings).toContain("Flight data unavailable — using a made-up callsign");
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({ fallback: true });
  });
});

describe("body size", () => {
  test("Content-Length: 2000000 → 413 without reading the body", async () => {
    const req = post("/api/scenario", { airport: "KTTD", type: "takeoff" }, { "content-length": "2000000" });
    const res = await scenarioRoute.POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
    expect(req.bodyUsed).toBe(false);
  });

  test("body over 1.6 MB without Content-Length → 413", async () => {
    const req = post("/api/grade", "x".repeat(1_700_000));
    expect(req.headers.get("content-length")).toBeNull();
    expect((await gradeRoute.POST(req)).status).toBe(413);
  });
});

describe("rate limits", () => {
  test("7th /api/speak in a minute from one IP → 429; another IP still passes", async () => {
    vi.mocked(synthesize).mockResolvedValue({ audio_wav_b64: "UklGRg==", sample_rate: 24000, duration_s: 1 });
    for (let i = 0; i < 6; i++) expect((await speakRoute.POST(post("/api/speak", { text: "hello" }))).status).toBe(200);
    const res = await speakRoute.POST(post("/api/speak", { text: "hello" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    ip = "198.51.100.1";
    expect((await speakRoute.POST(post("/api/speak", { text: "hello" }))).status).toBe(200);
  });

  test("cf-connecting-ip wins over x-forwarded-for", async () => {
    vi.mocked(synthesize).mockResolvedValue({ audio_wav_b64: "UklGRg==", sample_rate: 24000, duration_s: 1 });
    const cf = { "cf-connecting-ip": "192.0.2.77" };
    for (let i = 0; i < 6; i++) await speakRoute.POST(post("/api/speak", { text: "hi" }, cf));
    ip = "198.51.100.2"; // new x-forwarded-for, same cf-connecting-ip
    expect((await speakRoute.POST(post("/api/speak", { text: "hi" }, cf))).status).toBe(429);
  });

  test("31st request overall → 429; RATE_LIMIT_PER_MIN lowers it", async () => {
    for (let i = 0; i < 30; i++) expect((await gradeRoute.POST(post("/api/grade", {}))).status).toBe(422);
    expect((await gradeRoute.POST(post("/api/grade", {}))).status).toBe(429);
    ip = "198.51.100.3";
    vi.stubEnv("RATE_LIMIT_PER_MIN", "2");
    await gradeRoute.POST(post("/api/grade", {}));
    await gradeRoute.POST(post("/api/grade", {}));
    expect((await gradeRoute.POST(post("/api/grade", {}))).status).toBe(429);
  });
});

describe("/api/speak", () => {
  test("returns SpeechAudio; control characters are stripped", async () => {
    const audio = { audio_wav_b64: "UklGRg==", sample_rate: 24000, duration_s: 2.5 };
    vi.mocked(synthesize).mockResolvedValue(audio);
    const res = await speakRoute.POST(post("/api/speak", { text: "climb\u0007 and maintain" }));
    expect(await res.json()).toEqual(audio);
    expect(synthesize).toHaveBeenCalledWith("climb and maintain");
  });

  test("text over 600 chars → 422", async () => {
    expect((await speakRoute.POST(post("/api/speak", { text: "a".repeat(601) }))).status).toBe(422);
  });

  test("rejected SDK call (network) → 502 speech_failed, worker unreachable", async () => {
    vi.mocked(synthesize).mockRejectedValue(new TypeError("fetch failed"));
    const res = await speakRoute.POST(post("/api/speak", { text: "hello" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "speech_failed", message: "speech worker unreachable", source: "speech" });
  });
});

describe("/api/attempt", () => {
  test("transcribes, grades and returns both", async () => {
    const scenario = await makeScenario();
    vi.mocked(transcribe).mockResolvedValue({ transcript: "hello", duration_s: 1, model: "w" });
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: wavB64(1) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcript).toBe("hello");
    expect(body.grade.verdict).toBe("readback_incomplete");
  });

  test("SpeechWarming → 503 speech_warming", async () => {
    const scenario = await makeScenario();
    vi.mocked(transcribe).mockRejectedValue(new SpeechWarming());
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: wavB64(1) }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("speech_warming");
  });

  test("SpeechFailed → 502 speech_failed", async () => {
    const scenario = await makeScenario();
    vi.mocked(transcribe).mockRejectedValue(new SpeechFailed("audio must be 16000 Hz"));
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: wavB64(1) }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "speech_failed", message: "audio must be 16000 Hz" });
  });

  test("8 kHz WAV → 422 before transcribe is called", async () => {
    const scenario = await makeScenario();
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: wav8k() }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/16000 Hz/);
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe("checkWav", () => {
  test("accepts 0.5 s and 30 s of 16 kHz mono 16-bit PCM", () => {
    expect(() => checkWav(wavB64(0.5))).not.toThrow();
    expect(() => checkWav(wavB64(30))).not.toThrow();
  });

  test.each([
    ["too short", wavB64(0.4), /0\.5–30 s/],
    ["too long", wavB64(30.1), /0\.5–30 s/],
    ["not RIFF", btoa("hello world, this is not a wav file at all"), /RIFF\/WAVE/],
    ["stereo", stereo(), /mono/],
    ["truncated header", toBase64(encodeWav(new Float32Array(16000)).subarray(0, 30)), /RIFF\/WAVE|fmt/],
  ])("%s → 422", (_name, b64, message) => {
    expect(() => checkWav(b64)).toThrow(message);
  });
});

function stereo(): string {
  const bytes = encodeWav(new Float32Array(16000));
  new DataView(bytes.buffer).setUint16(22, 2, true);
  return toBase64(bytes);
}

describe("/api/grade", () => {
  test("grades a typed transcript", async () => {
    const scenario = await makeScenario();
    const res = await gradeRoute.POST(post("/api/grade", { scenario, transcript: "hello" }));
    expect(res.status).toBe(200);
    expect((await res.json()).verdict).toBe("readback_incomplete");
  });

  test("transcript over 600 chars → 422", async () => {
    const scenario = await makeScenario();
    expect((await gradeRoute.POST(post("/api/grade", { scenario, transcript: "a".repeat(601) }))).status).toBe(422);
  });
});

describe("/api/warmup", () => {
  test("returns the health counts", async () => {
    const health = {
      jobs: { completed: 0, failed: 0, inProgress: 0, inQueue: 1, retried: 0 },
      workers: { idle: 0, initializing: 1, ready: 0, running: 0, throttled: 0, unhealthy: 0 },
    };
    vi.mocked(warmUp).mockResolvedValue(health);
    const res = await warmupRoute.POST(post("/api/warmup", ""));
    expect(await res.json()).toEqual(health);
  });

  test("worker unreachable → 502 speech_failed", async () => {
    vi.mocked(warmUp).mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect((await warmupRoute.POST(post("/api/warmup", ""))).status).toBe(502);
  });
});
