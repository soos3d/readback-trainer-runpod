import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SpeechFailed, SpeechWarming } from "@/lib/errors";
import { synthesize, transcribe, warmUp } from "@/lib/runpod";

const fake = vi.hoisted(() => ({
  endpoint: {
    runSync: vi.fn(),
    run: vi.fn(),
    health: vi.fn(),
  } as { runSync: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn>; health: ReturnType<typeof vi.fn> } | null,
}));
vi.mock("runpod-sdk", () => ({ default: () => ({ endpoint: () => fake.endpoint }) }));

const ep = fake.endpoint!;
const AUDIO = { audio_wav_b64: "UklGRg==", sample_rate: 24000, duration_s: 2.5 };
const HEALTH = {
  jobs: { completed: 3, failed: 0, inProgress: 0, inQueue: 1, retried: 0 },
  workers: { idle: 0, initializing: 1, ready: 0, running: 0, throttled: 0, unhealthy: 0 },
};
const failedError = JSON.stringify({
  error_type: "<class 'ValueError'>",
  error_message: "audio must be 16000 Hz",
  error_traceback: 'Traceback (most recent call last):\n  File "/app/main.py", line 9',
});

beforeEach(() => {
  vi.stubEnv("RUNPOD_API_KEY", "test-key");
  vi.stubEnv("SPEECH_ENDPOINT_ID", "test-endpoint");
  fake.endpoint = ep;
  vi.resetAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("synthesize / transcribe", () => {
  test("COMPLETED tts output is parsed and the tts job is sent", async () => {
    ep.runSync.mockResolvedValue({ status: "COMPLETED", output: AUDIO });
    await expect(synthesize("November one two three")).resolves.toEqual(AUDIO);
    expect(ep.runSync).toHaveBeenCalledWith(
      { input: { task: "tts", text: "November one two three", radio_effect: true } },
      expect.any(Number),
    );
  });

  test("COMPLETED transcribe output is parsed", async () => {
    const out = { transcript: "november one two three", duration_s: 1.8, model: "whisper-atc" };
    ep.runSync.mockResolvedValue({ status: "COMPLETED", output: out });
    await expect(transcribe("UklGRg==")).resolves.toEqual(out);
  });

  test("FAILED passes on error_message only, never the traceback", async () => {
    ep.runSync.mockResolvedValue({ status: "FAILED", error: failedError });
    const err = await synthesize("hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeechFailed);
    expect((err as Error).message).toBe("audio must be 16000 Hz");
  });

  test("FAILED with an unparsable error falls back to a generic message", async () => {
    ep.runSync.mockResolvedValue({ status: "FAILED", error: "Traceback: not json" });
    await expect(synthesize("hi")).rejects.toThrow(new SpeechFailed("speech worker failed"));
  });

  test("still IN_QUEUE when runSync returns → SpeechWarming", async () => {
    ep.runSync.mockResolvedValue({ status: "IN_QUEUE", id: "job-1" });
    await expect(synthesize("hi")).rejects.toBeInstanceOf(SpeechWarming);
  });

  test("runSync still pending at 80 s → SpeechWarming", async () => {
    vi.useFakeTimers();
    ep.runSync.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const result = synthesize("hi").catch((e: unknown) => e).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(79_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(SpeechWarming);
  });

  test("COMPLETED with a bad output shape → SpeechFailed", async () => {
    ep.runSync.mockResolvedValue({ status: "COMPLETED", output: { audio: "x" } });
    await expect(synthesize("hi")).rejects.toThrow(
      new SpeechFailed("speech worker returned an unexpected shape"),
    );
  });
});

describe("configuration", () => {
  test("missing env var throws naming the var", async () => {
    vi.stubEnv("SPEECH_ENDPOINT_ID", "");
    await expect(synthesize("hi")).rejects.toThrow("SPEECH_ENDPOINT_ID is not set");
  });

  test("a null endpoint fails fast", async () => {
    fake.endpoint = null;
    await expect(synthesize("hi")).rejects.toThrow(/runpod-sdk returned no endpoint/);
  });
});

describe("warmUp", () => {
  test("fires a ping job, then returns parsed health", async () => {
    ep.run.mockResolvedValue({ id: "job-2", status: "IN_QUEUE" });
    ep.health.mockResolvedValue(HEALTH);
    await expect(warmUp()).resolves.toEqual(HEALTH);
    expect(ep.run).toHaveBeenCalledWith({ input: { task: "ping" } });
    expect(ep.run.mock.invocationCallOrder[0]).toBeLessThan(ep.health.mock.invocationCallOrder[0]);
  });

  test("bad health shape → SpeechFailed", async () => {
    ep.run.mockResolvedValue({ id: "job-3", status: "IN_QUEUE" });
    ep.health.mockResolvedValue({ jobs: {} });
    await expect(warmUp()).rejects.toBeInstanceOf(SpeechFailed);
  });
});
