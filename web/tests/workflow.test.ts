// The main backend workflow, through the real API route handlers:
//   1. POST /api/scenario builds an ATC call from weather (AviationWeather.gov) and a real flight (OpenSky)
//   2. POST /api/grade grades a typed readback
//   3. POST /api/attempt sends recorded audio to the GPU for a transcript, then grades it
// Both APIs answer with real responses recorded in tests/fixtures/. Only the GPU worker (lib/runpod) is mocked.
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as scenarioRoute from "@/app/api/scenario/route";
import * as gradeRoute from "@/app/api/grade/route";
import * as attemptRoute from "@/app/api/attempt/route";
import { encodeWav, toBase64 } from "@/lib/client/wavEncode";
import { transcribe } from "@/lib/runpod";
import type { Scenario } from "@/lib/schemas";
import { json, stubFetch, stubUpstreamEnv } from "./support/upstream";

vi.mock("@/lib/runpod", () => ({ synthesize: vi.fn(), transcribe: vi.fn(), warmUp: vi.fn() }));

// With the recorded data and seed 7, the controller says:
//   "N672, turn left heading 160, wind calm, runway 25, cleared for takeoff."
const CORRECT_READBACK = "turn left heading one six zero, runway two five, cleared for takeoff, November six seven two";
const ONE_SECOND_OF_AUDIO = toBase64(encodeWav(new Float32Array(16_000)));

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function newTakeoffCall(airport = "KTTD"): Promise<Scenario> {
  const res = await scenarioRoute.POST(post("/api/scenario", { airport, type: "takeoff", seed: 7 }));
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  stubUpstreamEnv();
  stubFetch();
  vi.spyOn(console, "info").mockImplementation(() => {}); // one log line per request
});

describe("main workflow", () => {
  test("a new call is built from live weather and a real flight", async () => {
    const scenario = await newTakeoffCall();
    expect(scenario.controller_text).toBe("N672, turn left heading 160, wind calm, runway 25, cleared for takeoff.");
    expect(scenario.provenance.weather.source).toBe("live");
    expect(scenario.provenance.flight.source).toBe("opensky");
    expect(scenario.expected.map((item) => item.label)).toEqual(["Callsign", "Heading", "Runway", "Cleared for takeoff"]);
  });

  test("a correct typed readback scores 100%", async () => {
    const scenario = await newTakeoffCall();
    const res = await gradeRoute.POST(post("/api/grade", { scenario, transcript: CORRECT_READBACK }));
    expect(await res.json()).toMatchObject({ verdict: "readback_correct", score: 1 });
  });

  test("a wrong heading is marked incorrect, with a tip", async () => {
    const scenario = await newTakeoffCall();
    const wrong = CORRECT_READBACK.replace("one six zero", "one five zero");
    const result = await (await gradeRoute.POST(post("/api/grade", { scenario, transcript: wrong }))).json();
    expect(result.verdict).toBe("readback_incorrect");
    expect(result.tips).toEqual(["Heading: you said 150; the clearance was 160."]);
  });

  test("a spoken readback is transcribed on the GPU, then graded", async () => {
    const scenario = await newTakeoffCall();
    vi.mocked(transcribe).mockResolvedValue({ transcript: CORRECT_READBACK, duration_s: 1, model: "whisper" });
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: ONE_SECOND_OF_AUDIO }));
    const body = await res.json();
    expect(body.transcript).toBe(CORRECT_READBACK);
    expect(body.grade.verdict).toBe("readback_correct");
  });
});

describe("API failures", () => {
  test("weather API down: the call still builds, on standard weather, and says so", async () => {
    vi.useFakeTimers(); // skip the retry backoff
    stubFetch((url) => (url.includes("/metar") ? json({}, 503) : undefined));
    // KORL, so no earlier test has cached its weather.
    const pending = scenarioRoute.POST(post("/api/scenario", { airport: "KORL", type: "takeoff", seed: 7 }));
    await vi.runAllTimersAsync();
    const scenario: Scenario = await (await pending).json();
    vi.useRealTimers();

    expect(scenario.provenance.weather.source).toBe("synthetic");
    expect(scenario.context.altimeter).toBe("29.92");
    expect(scenario.warnings).toContain("Live weather unavailable — using standard weather");
  });

  test("GPU worker unreachable: 502 speech_failed, so the page switches to typing", async () => {
    const scenario = await newTakeoffCall();
    vi.mocked(transcribe).mockRejectedValue(new TypeError("fetch failed"));
    const res = await attemptRoute.POST(post("/api/attempt", { scenario, audio_wav_b64: ONE_SECOND_OF_AUDIO }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toEqual({ code: "speech_failed", message: "speech worker unreachable", source: "speech" });
  });
});
