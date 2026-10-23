// The page's one state machine (SPEC §14.2). Pure: page.tsx runs the effects and dispatches results.
import type { AirportSummary, GradeResult, Scenario } from "@/lib/schemas";

export type Status =
  | "idle" | "loading_scenario" | "warming_gpu" | "audio_ready" | "recording"
  | "transcribing" | "graded" | "text_only" | "error";
export type Gpu = "checking" | "cold" | "warming" | "ready" | "offline";
export type Call = "scenario" | "speak" | "attempt" | "grade";
/** A failed request. status 0 = no HTTP response (network or client-side error). */
export type Failure = { status: number; code: string; message: string; source: string };
type Workers = { idle: number; ready: number; running: number; initializing: number };

export type State = {
  status: Status;
  gpu: Gpu;
  airports: AirportSummary[];
  scenario: Scenario | null;
  audio: string | null; // base64 WAV of the controller call
  showText: boolean;
  typing: boolean; // the user reads back by keyboard; set by any move to text_only
  secondsLeft: number;
  warmRetries: number;
  result: GradeResult | null;
  transcript: string | null;
  notice: string | null; // banner: why we're in text_only, or a rate limit
  inline: string | null; // next to the talk button
  error: { message: string; source: string; retry: boolean } | null;
};

export type Action =
  | { type: "airports"; airports: AirportSummary[] }
  | { type: "health"; workers: Workers }
  | { type: "health_failed" }
  | { type: "new_call" }
  | { type: "scenario"; scenario: Scenario }
  | { type: "audio"; scenarioId: string; audio: string }
  | { type: "toggle_text" }
  | { type: "type_instead" }
  | { type: "record_start" }
  | { type: "tick" }
  | { type: "record_stop" }
  | { type: "too_short" }
  | { type: "mic_denied" }
  | { type: "submit_text" }
  | { type: "graded"; result: GradeResult; transcript: string }
  | { type: "try_again" }
  | { type: "recover" }
  | { type: "failed"; call: Call; scenarioId?: string; err: Failure };

export const WARM_RETRIES = 2;
export const MAX_SECONDS = 30;

export const MESSAGES = {
  badLength: "Recording too short or too long — hold the button for the whole readback",
  micBlocked: "Microphone blocked — type your readback",
  voiceDown: "Voice unavailable — type your readback",
  stillWarming: "The GPU is still warming up — type your readback for now",
  slowDown: "Slow down — too many requests this minute",
  onlyTakeoff: "Only takeoff works until airports.json is filled.",
};

export const initialState: State = {
  status: "idle", gpu: "checking", airports: [], scenario: null, audio: null, showText: false, typing: false,
  secondsLeft: MAX_SECONDS, warmRetries: 0, result: null, transcript: null, notice: null, inline: null, error: null,
};

/** Where the user lands when a request ends without a result. */
const resting = (s: State): Status => (!s.scenario ? "idle" : s.audio && !s.typing ? "audio_ready" : "text_only");
const waitingOnVoice = (s: State) => s.status === "loading_scenario" || s.status === "warming_gpu";
const cleared = { notice: null, inline: null, error: null } as const;

function gpuFrom(w: Workers): Gpu {
  // ponytail: health counts can lag a scale-down (T02), so "ready" may be stale until the next call.
  if (w.ready > 0 || w.idle > 0 || w.running > 0) return "ready";
  return w.initializing > 0 ? "warming" : "cold";
}

function failed(s: State, a: Extract<Action, { type: "failed" }>): State {
  const { call, err } = a;
  const speech = call === "speak" || call === "attempt";
  if (call === "speak" && (a.scenarioId !== s.scenario?.scenario_id || !waitingOnVoice(s))) {
    return err.code === "speech_failed" ? { ...s, gpu: "offline" } : s;
  }
  if (err.status === 429) return { ...s, status: resting(s), notice: `${MESSAGES.slowDown} (source: ${err.source})` };
  if (speech && err.code === "speech_warming") {
    if (s.warmRetries >= WARM_RETRIES) return { ...s, status: "text_only", notice: MESSAGES.stillWarming, warmRetries: 0 };
    return { ...s, status: "warming_gpu", gpu: "warming", warmRetries: s.warmRetries + 1 };
  }
  if (speech && err.code === "speech_failed") return { ...s, status: "text_only", gpu: "offline", notice: MESSAGES.voiceDown };
  if (call === "attempt" && err.message.startsWith("audio_wav_b64:")) {
    return { ...s, status: "audio_ready", inline: MESSAGES.badLength };
  }
  if (call === "scenario" && err.status === 422 && / needs .* in airports\.json/.test(err.message)) {
    return { ...s, status: "error", error: { message: `${err.message}. ${MESSAGES.onlyTakeoff}`, source: err.source, retry: false } };
  }
  return { ...s, status: "error", error: { message: err.message, source: err.source, retry: true } };
}

export function reducer(s: State, a: Action): State {
  const next = step(s, a);
  return next.status === "text_only" && !next.typing ? { ...next, typing: true } : next;
}

function step(s: State, a: Action): State {
  switch (a.type) {
    case "airports": return { ...s, airports: a.airports };
    // Offline sticks until a voice request succeeds: health counts stay up after a failed job (T15 browser check).
    case "health": return s.gpu === "offline" ? s : { ...s, gpu: gpuFrom(a.workers) };
    case "health_failed": return { ...s, gpu: "offline" };
    case "new_call":
      return { ...s, ...cleared, status: "loading_scenario", typing: false, scenario: null, audio: null, result: null, transcript: null };
    case "scenario": return { ...s, scenario: a.scenario, audio: null, showText: false, warmRetries: 0 };
    case "audio":
      if (a.scenarioId !== s.scenario?.scenario_id) return s;
      return { ...s, audio: a.audio, gpu: "ready", warmRetries: 0, status: waitingOnVoice(s) ? "audio_ready" : s.status };
    case "toggle_text": return { ...s, showText: !s.showText };
    case "type_instead": return { ...s, ...cleared, status: "text_only" };
    case "record_start": return { ...s, ...cleared, status: "recording", secondsLeft: MAX_SECONDS };
    case "tick": return { ...s, secondsLeft: Math.max(0, s.secondsLeft - 1) };
    case "record_stop": return { ...s, status: "transcribing", warmRetries: 0 };
    case "too_short": return { ...s, status: "audio_ready", inline: MESSAGES.badLength };
    case "mic_denied": return { ...s, ...cleared, status: "text_only", notice: MESSAGES.micBlocked };
    case "submit_text": return { ...s, ...cleared, status: "transcribing" };
    case "graded": return { ...s, ...cleared, status: "graded", result: a.result, transcript: a.transcript };
    case "try_again": return { ...s, ...cleared, result: null, transcript: null, status: resting(s) };
    case "recover": return { ...s, ...cleared, status: resting(s) };
    case "failed": return failed(s, a);
  }
}
