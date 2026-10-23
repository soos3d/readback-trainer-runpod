// Browser-only mic recorder (SPEC §14.3): getUserMedia → MediaRecorder → decodeAudioData
// → OfflineAudioContext(1, n, 16000) → 16-bit PCM WAV → base64.
import { SAMPLE_RATE, encodeWav, toBase64 } from "./wavEncode";

export const MIN_SECONDS = 0.5;

/** Mic permission refused, no mic present, or no mediaDevices (insecure context). UI falls back to typing. */
export class MicDeniedError extends Error {
  constructor(cause?: unknown) {
    super("Microphone unavailable. Allow mic access or type your readback.", { cause });
    this.name = "MicDeniedError";
  }
}

/** Recording shorter than MIN_SECONDS; too little audio to transcribe. */
export class TooShortError extends Error {
  constructor(seconds: number) {
    super(`Recording was ${seconds.toFixed(1)} s. Hold to talk for at least ${MIN_SECONDS} s.`);
    this.name = "TooShortError";
  }
}

export type Recorder = {
  /** Stops and resolves to a base64 WAV. Idempotent: later calls return the same promise. */
  stop(): Promise<string>;
  /** Stops and discards the audio. */
  cancel(): void;
};

export type RecordingOptions = {
  maxMs?: number;
  /** Fires when maxMs elapses. Recording has stopped; call stop() for the result. */
  onAutoStop?: () => void;
};

const DENIED = new Set(["NotAllowedError", "SecurityError", "NotFoundError"]);

async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicDeniedError();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    if (err instanceof DOMException && DENIED.has(err.name)) throw new MicDeniedError(err);
    throw err;
  }
}

async function toWavBase64(blob: Blob): Promise<string> {
  if (blob.size === 0) throw new TooShortError(0);
  // decodeAudioData resamples to its context's rate, so decode straight into 16 kHz.
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer());
  if (decoded.duration < MIN_SECONDS) throw new TooShortError(decoded.duration);
  // Render through a 1-channel context to downmix to mono.
  const ctx = new OfflineAudioContext(1, decoded.length, SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return toBase64(encodeWav(rendered.getChannelData(0)));
}

export async function startRecording({ maxMs = 30_000, onAutoStop }: RecordingOptions = {}): Promise<Recorder> {
  const stream = await openMic();
  const media = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  media.ondataavailable = (e) => chunks.push(e.data);

  const stopped = new Promise<Blob>((resolve) => {
    media.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: media.mimeType }));
    };
  });
  const halt = () => {
    clearTimeout(timer);
    if (media.state !== "inactive") media.stop();
  };
  const timer = setTimeout(() => {
    halt();
    onAutoStop?.();
  }, maxMs);

  let result: Promise<string> | undefined;
  media.start();
  return {
    stop() {
      halt();
      result ??= stopped.then(toWavBase64);
      return result;
    },
    cancel: halt,
  };
}
