// The whole web-side Runpod integration: one Serverless queue endpoint ("speech", speech/main.py)
// called with runpod-sdk. Read it top to bottom as RUNPOD STEP 1-5. Every Runpod line is tagged.
import "server-only"; // RUNPOD: a client import of this file fails the build, so the key can't leak
import runpodSdk from "runpod-sdk"; // RUNPOD: official JS client for Serverless endpoints
import { z } from "zod";
import { SpeechFailed, SpeechWarming } from "./errors";
import { requireEnv } from "./env";
import { SpeechAudio } from "./schemas";

// RUNPOD STEP 1 — wait at most 80 s per job
// RUNPOD: the Pod proxy (Cloudflare) closes requests at 100 s. runSync's own timeout restarts its
// clock after the first /runsync call returns, so its worst case is about twice the value we pass.
// We race it against our own 80 s timer instead; the SDK keeps polling in the background and its
// late result is dropped, while the queued job keeps warming the worker for the UI's retry.
const DEADLINE_MS = 80_000;

// RUNPOD STEP 2 — connect to the speech endpoint with two server-only env vars
function speechEndpoint() {
  // RUNPOD: read lazily so `next build` works without them; requireEnv names the missing var
  const endpoint = runpodSdk(requireEnv("RUNPOD_API_KEY")).endpoint(requireEnv("SPEECH_ENDPOINT_ID"));
  if (!endpoint) throw new Error("runpod-sdk returned no endpoint for SPEECH_ENDPOINT_ID"); // RUNPOD: typed Endpoint | null
  return endpoint;
}

// RUNPOD: a FAILED job's `error` is a JSON string holding error_type, error_message and
// error_traceback. Only error_message goes on; the traceback has worker file paths.
const WorkerError = z.object({ error_message: z.string().min(1) });
function workerMessage(error: unknown): string {
  try {
    const parsed = WorkerError.safeParse(JSON.parse(String(error)));
    if (parsed.success) return parsed.data.error_message;
  } catch {
    // not JSON: fall through to the generic message below
  }
  return "speech worker failed";
}

function parseOutput<T>(schema: z.ZodType<T>, output: unknown): T {
  const parsed = schema.safeParse(output);
  if (!parsed.success) throw new SpeechFailed("speech worker returned an unexpected shape");
  return parsed.data;
}

// RUNPOD STEP 3 — send a job and wait for it: runSync on a queue endpoint
// RUNPOD: typed EndpointCompletedOutput, but the body is raw: FAILED adds `error`, a timeout has no `output`
type RunSyncResult = { status?: unknown; output?: unknown; error?: unknown };

async function runJob<T>(input: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), DEADLINE_MS);
  });
  try {
    // RUNPOD: runSync posts /runsync, then polls /status-sync; it waits through a cold start
    const res = await Promise.race([speechEndpoint().runSync({ input }, DEADLINE_MS) as Promise<RunSyncResult>, deadline]);
    if (res === "deadline") throw new SpeechWarming(); // RUNPOD: no answer within 80 s, worker still cold
    if (res.status === "COMPLETED") return parseOutput(schema, res.output);
    if (res.status === "IN_QUEUE" || res.status === "IN_PROGRESS") throw new SpeechWarming(); // RUNPOD: SDK gave up first
    throw new SpeechFailed(workerMessage(res.error)); // RUNPOD: FAILED (worker raised), CANCELLED or TIMED_OUT
  } finally {
    clearTimeout(timer);
  }
}

// RUNPOD STEP 4 — the two jobs this app sends (worker contract: SPEC §12.2)
const Transcript = z.strictObject({ transcript: z.string(), duration_s: z.number().nonnegative(), model: z.string() });
export type Transcript = z.infer<typeof Transcript>;

export const synthesize = (text: string): Promise<SpeechAudio> =>
  runJob({ task: "tts", text, radio_effect: true }, SpeechAudio);
export const transcribe = (audioWavB64: string): Promise<Transcript> =>
  runJob({ task: "transcribe", audio_wav_b64: audioWavB64 }, Transcript);

// RUNPOD STEP 5 — warm-up: a fire-and-forget job wakes a worker, health feeds the status dot
// RUNPOD: /health also returns workers.unhealthy, which the SDK's HealthCheck type lacks
const count = z.number().int().nonnegative();
const Health = z.object({
  jobs: z.object({ completed: count, failed: count, inProgress: count, inQueue: count, retried: count }),
  workers: z.object({
    idle: count, initializing: count, ready: count, running: count, throttled: count, unhealthy: count,
  }),
});
export type Health = z.infer<typeof Health>;

export async function warmUp(): Promise<Health> {
  const endpoint = speechEndpoint();
  await endpoint.run({ input: { task: "ping" } }); // RUNPOD: returns at once with a job id; the job wakes a worker
  return parseOutput(Health, await endpoint.health()); // RUNPOD: worker and job counts; `running` means a billed worker
}
