// Smoke test against the deployed speech worker: ping → tts → transcribe, run twice for cold and warm
// timings. The first pass is cold only if no worker is running. CLI only, never bundled.
// Usage: npx tsx scripts/smoke.ts
import { readFileSync } from "node:fs";
import runpodSdk from "runpod-sdk"; // RUNPOD: the one allowed import outside lib/runpod.ts (DECISIONS.md)
import { normalize } from "../lib/normalize";

// TTS of this sentence, resampled to 16 kHz mono 16-bit (no pilot recording yet; see handoff/T12.md)
const READBACK_WAV = new URL("./fixtures/readback.wav", import.meta.url);
const CALLSIGN = "n12345";
const TTS_TEXT = "November one two three four five, runway three four left, cleared for takeoff.";

function requireVar(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing; set it in web/.env.local`);
  return value;
}

// RUNPOD STEP 1 — connect with the API key and the endpoint ID from `rp flash deploy`
function speechEndpoint() {
  const endpoint = runpodSdk(requireVar("RUNPOD_API_KEY")).endpoint(requireVar("SPEECH_ENDPOINT_ID"));
  if (!endpoint) throw new Error("runpod-sdk returned no endpoint"); // RUNPOD: endpoint() is typed Endpoint | null
  return endpoint;
}

// RUNPOD STEP 2 — runSync posts /runsync, then polls /status-sync until done or timeout
// RUNPOD: no Pod proxy here, so a 5 min timeout lets the first cold start finish
async function runTask(input: Record<string, unknown>): Promise<{ seconds: string; output: Record<string, unknown> }> {
  const started = Date.now();
  // RUNPOD: typed EndpointCompletedOutput, but FAILED adds `error` and a timeout returns no output
  const res = (await speechEndpoint().runSync({ input }, 300_000)) as {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  };
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status !== "COMPLETED" || !res.output) {
    throw new Error(`${String(input.task)}: status ${res.status} after ${seconds}s ${res.error ?? ""}`);
  }
  return { seconds, output: res.output };
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

async function pass(label: string): Promise<void> {
  const ping = await runTask({ task: "ping" });
  process.stdout.write(`${label} ping: ${ping.seconds}s ${JSON.stringify(ping.output)}\n`);

  const tts = await runTask({ task: "tts", text: TTS_TEXT, radio_effect: true });
  const duration = Number(tts.output.duration_s);
  process.stdout.write(`${label} tts: ${tts.seconds}s duration_s=${duration} sample_rate=${String(tts.output.sample_rate)}\n`);
  check(duration > 1, `tts duration_s ${duration} is not > 1`);

  const audio = readFileSync(READBACK_WAV).toString("base64");
  const stt = await runTask({ task: "transcribe", audio_wav_b64: audio });
  const transcript = String(stt.output.transcript);
  process.stdout.write(`${label} transcribe: ${stt.seconds}s "${transcript}"\n`);
  check(normalize(transcript).includes(CALLSIGN), `transcript lacks callsign ${CALLSIGN}`);
}

process.loadEnvFile(".env.local");
// RUNPOD: /health `running` is the billed worker count; 0 means the first pass pays the cold start
const { workers } = await speechEndpoint().health();
await pass(workers.running === 0 ? "cold" : "warm");
await pass("warm");
