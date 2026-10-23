// Checks a recorded readback before it reaches the GPU (SPEC §12.3): RIFF/WAVE, PCM 16-bit,
// mono, 16,000 Hz, 0.5–30 s, at most 1.2 MB decoded. The worker checks again.
import { ApiError } from "./errors";

const MAX_BYTES = 1_200_000;
const RATE = 16_000;
const BYTES_PER_SECOND = RATE * 2;

const invalid = (message: string) => new ApiError(422, "invalid_input", `audio_wav_b64: ${message}`, "web");

const tag = (buf: Buffer, at: number) => buf.toString("latin1", at, at + 4);

type Chunks = { fmt?: { at: number; size: number }; dataBytes?: number };

// Walks the RIFF chunk list for "fmt " and "data"; browsers may add others (LIST, fact).
function findChunks(buf: Buffer): Chunks {
  const found: Chunks = {};
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = tag(buf, at);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") found.fmt = { at: at + 8, size };
    if (id === "data") return { ...found, dataBytes: Math.min(size, buf.length - at - 8) };
    at += 8 + size + (size % 2); // chunks are word-aligned
  }
  return found;
}

/** Throws 422 invalid_input naming the first rule the WAV breaks. */
export function checkWav(b64: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw invalid("not base64");
  const buf = Buffer.from(b64, "base64");
  if (buf.length > MAX_BYTES) throw invalid("WAV is over 1.2 MB");
  if (buf.length < 12 || tag(buf, 0) !== "RIFF" || tag(buf, 8) !== "WAVE") throw invalid("not a RIFF/WAVE file");

  const { fmt, dataBytes } = findChunks(buf);
  if (!fmt || fmt.size < 16 || fmt.at + 16 > buf.length) throw invalid("no fmt chunk");
  if (buf.readUInt16LE(fmt.at) !== 1) throw invalid("must be PCM");
  if (buf.readUInt16LE(fmt.at + 2) !== 1) throw invalid("must be mono");
  if (buf.readUInt32LE(fmt.at + 4) !== RATE) throw invalid("must be 16000 Hz");
  if (buf.readUInt16LE(fmt.at + 14) !== 16) throw invalid("must be 16-bit");
  if (dataBytes === undefined) throw invalid("no data chunk");

  const seconds = dataBytes / BYTES_PER_SECOND;
  if (seconds < 0.5 || seconds > 30) throw invalid(`must be 0.5–30 s long, got ${seconds.toFixed(1)} s`);
}
