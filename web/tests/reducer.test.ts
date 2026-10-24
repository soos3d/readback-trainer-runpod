import { describe, expect, it } from "vitest";
import { MESSAGES, initialState, reducer, type Action, type State } from "@/app/reducer";
import type { GradeResult, Scenario } from "@/lib/schemas";

const scenario = { scenario_id: "s1", expected: [] } as unknown as Scenario;
const other = { scenario_id: "s2", expected: [] } as unknown as Scenario;
const grade = { verdict: "readback_correct", score: 1, items: [], tips: [] } as GradeResult;
const fail = (call: "scenario" | "speak" | "attempt" | "grade", status: number, code: string, message = "boom") =>
  ({ type: "failed", call, scenarioId: "s1", err: { status, code, message, source: "speech" } }) as Action;

const run = (actions: Action[], from: State = initialState) => actions.reduce(reducer, from);
const loaded = run([{ type: "new_call" }, { type: "scenario", scenario }]);
const ready = run([{ type: "audio", scenarioId: "s1", audio: "AAAA" }], loaded);

describe("scenario flow", () => {
  it("idle → loading_scenario → card shown while voice loads → audio_ready", () => {
    expect(initialState.status).toBe("idle");
    expect(run([{ type: "new_call" }]).status).toBe("loading_scenario");
    expect(loaded).toMatchObject({ status: "loading_scenario", scenario, showText: false });
    expect(ready).toMatchObject({ status: "audio_ready", audio: "AAAA" });
  });

  it("ignores audio for a stale scenario", () => {
    const next = run([{ type: "scenario", scenario: other }, { type: "audio", scenarioId: "s1", audio: "OLD" }], loaded);
    expect(next.audio).toBeNull();
  });

  it("audio arriving after Type instead keeps text_only", () => {
    const next = run([{ type: "type_instead" }, { type: "audio", scenarioId: "s1", audio: "A" }], loaded);
    expect(next).toMatchObject({ status: "text_only", audio: "A" });
  });

  it("toggles text", () => {
    expect(reducer(loaded, { type: "toggle_text" }).showText).toBe(true);
  });

  it("does not mutate the previous state", () => {
    const before = structuredClone(loaded);
    reducer(loaded, { type: "toggle_text" });
    expect(loaded).toEqual(before);
  });
});

describe("speech warming", () => {
  it("retries ×2 in warming_gpu, then text_only", () => {
    const once = reducer(loaded, fail("speak", 503, "speech_warming"));
    expect(once).toMatchObject({ status: "warming_gpu", warmRetries: 1, gpu: "warming" });
    const twice = reducer(once, fail("speak", 503, "speech_warming"));
    expect(twice).toMatchObject({ status: "warming_gpu", warmRetries: 2 });
    const third = reducer(twice, fail("speak", 503, "speech_warming"));
    expect(third).toMatchObject({ status: "text_only", notice: MESSAGES.stillWarming });
  });

  it("warming_gpu → audio_ready when the retry succeeds", () => {
    const warming = reducer(loaded, fail("speak", 503, "speech_warming"));
    expect(reducer(warming, { type: "audio", scenarioId: "s1", audio: "A" })).toMatchObject({
      status: "audio_ready", warmRetries: 0, gpu: "ready",
    });
  });

  it("a speak failure after the user moved on does not change status", () => {
    const typing = reducer(loaded, { type: "type_instead" });
    expect(reducer(typing, fail("speak", 503, "speech_warming")).status).toBe("text_only");
  });

  it("attempt 503 retries the same way", () => {
    const sent = run([{ type: "record_start" }, { type: "record_stop" }], ready);
    expect(sent.status).toBe("transcribing");
    expect(reducer(sent, fail("attempt", 503, "speech_warming")).status).toBe("warming_gpu");
  });
});

describe("recording", () => {
  const recording = reducer(ready, { type: "record_start" });

  it("audio_ready → recording with a 30 s countdown that ticks to 0", () => {
    expect(recording).toMatchObject({ status: "recording", secondsLeft: 30 });
    const ticks = Array.from({ length: 31 }, () => ({ type: "tick" }) as Action);
    expect(run(ticks, recording).secondsLeft).toBe(0);
  });

  it("recording → transcribing → graded", () => {
    const graded = run([{ type: "record_stop" }, { type: "graded", result: grade, transcript: "heard" }], recording);
    expect(graded).toMatchObject({ status: "graded", result: grade, transcript: "heard" });
  });

  it("too short → audio_ready with an inline message", () => {
    expect(reducer(recording, { type: "too_short" })).toMatchObject({ status: "audio_ready", inline: MESSAGES.badLength });
  });

  it("attempt 422 on the WAV → audio_ready with the same message", () => {
    const sent = reducer(recording, { type: "record_stop" });
    const next = reducer(sent, fail("attempt", 422, "invalid_input", "audio_wav_b64: must be 0.5–30 s long, got 0.3 s"));
    expect(next).toMatchObject({ status: "audio_ready", inline: MESSAGES.badLength });
  });

  it("mic denied → text_only", () => {
    expect(reducer(recording, { type: "mic_denied" })).toMatchObject({ status: "text_only", notice: MESSAGES.micBlocked });
  });

  it("speech_failed → text_only", () => {
    const sent = reducer(recording, { type: "record_stop" });
    expect(reducer(sent, fail("attempt", 502, "speech_failed"))).toMatchObject({
      status: "text_only", notice: MESSAGES.voiceDown, gpu: "offline",
    });
  });
});

describe("typed readback and results", () => {
  it("text_only → transcribing → graded; Try again keeps the scenario", () => {
    const graded = run(
      [{ type: "type_instead" }, { type: "submit_text" }, { type: "graded", result: grade, transcript: "typed" }],
      loaded,
    );
    expect(graded.status).toBe("graded");
    expect(reducer(graded, { type: "try_again" })).toMatchObject({ status: "text_only", scenario, result: null });
  });

  it("a typed readback stays typed through grading, errors and Try again", () => {
    const typed = run([{ type: "type_instead" }, { type: "submit_text" }], ready);
    expect(typed).toMatchObject({ status: "transcribing", typing: true });
    const broken = reducer(typed, fail("grade", 500, "internal"));
    expect(reducer(broken, { type: "recover" }).status).toBe("text_only");
    expect(reducer(typed, { type: "new_call" }).typing).toBe(false);
  });

  it("Try again with audio → audio_ready", () => {
    const graded = run([{ type: "record_start" }, { type: "record_stop" }, { type: "graded", result: grade, transcript: "" }], ready);
    expect(reducer(graded, { type: "try_again" }).status).toBe("audio_ready");
  });
});

describe("errors", () => {
  it("scenario failure → error with Retry, naming the source", () => {
    const next = reducer(run([{ type: "new_call" }]), fail("scenario", 502, "upstream_failed", "AWC down"));
    expect(next).toMatchObject({ status: "error", error: { message: "AWC down", source: "speech", retry: true } });
  });

  it("scenario 422 for missing airports.json fields → error without Retry, server message as is", () => {
    const msg = "KTTD needs min_vector_altitude in airports.json for departure";
    const next = reducer(run([{ type: "new_call" }]), fail("scenario", 422, "invalid_input", msg));
    expect(next.status).toBe("error");
    expect(next.error).toMatchObject({ message: msg, retry: false });
    expect(next.error?.message).not.toContain("Only takeoff");
  });

  it("429 → banner with the source, back to a usable state", () => {
    const next = reducer(ready, fail("attempt", 429, "rate_limited"));
    expect(next).toMatchObject({ status: "audio_ready", notice: `${MESSAGES.slowDown} (source: speech)` });
    expect(reducer(run([{ type: "new_call" }]), fail("scenario", 429, "rate_limited")).status).toBe("idle");
  });

  it("recover from error with a scenario → back to the readback", () => {
    const broken = reducer(ready, fail("grade", 500, "internal"));
    expect(broken.status).toBe("error");
    expect(reducer(broken, { type: "recover" }).status).toBe("audio_ready");
  });
});

describe("GPU status dot", () => {
  const health = (w: Partial<Record<"idle" | "ready" | "running" | "initializing", number>>) =>
    ({ type: "health", workers: { idle: 0, ready: 0, running: 0, initializing: 0, ...w } }) as Action;

  it("cold, warming, ready from worker counts", () => {
    expect(reducer(initialState, health({})).gpu).toBe("cold");
    expect(reducer(initialState, health({ initializing: 1 })).gpu).toBe("warming");
    expect(reducer(initialState, health({ idle: 1 })).gpu).toBe("ready");
    expect(reducer(initialState, health({ running: 1 })).gpu).toBe("ready");
  });

  it("warmup 502 → offline, not an error state", () => {
    const next = reducer(initialState, { type: "health_failed" });
    expect(next).toMatchObject({ gpu: "offline", status: "idle" });
  });

  it("offline sticks through stale health counts until a voice request succeeds", () => {
    const down = reducer(loaded, fail("speak", 502, "speech_failed"));
    expect(reducer(down, health({ idle: 1 })).gpu).toBe("offline");
    const back = reducer({ ...down, status: "loading_scenario" }, { type: "audio", scenarioId: "s1", audio: "A" });
    expect(back.gpu).toBe("ready");
  });
});
