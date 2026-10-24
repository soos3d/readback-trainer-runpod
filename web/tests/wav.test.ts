import { describe, expect, test } from "vitest";
import { encodeWav, toBase64 } from "@/lib/client/wavEncode";
import { checkWav } from "@/lib/wav";

const wav = (seconds: number) => encodeWav(new Float32Array(Math.round(seconds * 16000)));
const wavB64 = (seconds: number) => toBase64(wav(seconds));

// Overwrites one fmt field of a valid 1 s WAV.
function withFmt(offset: number, value: number): string {
  const bytes = wav(1);
  new DataView(bytes.buffer).setUint16(offset, value, true);
  return toBase64(bytes);
}

// A browser-style WAV: an odd-sized LIST chunk (plus its pad byte) between fmt and data.
function withListChunk(): string {
  const bytes = wav(1);
  const list = new Uint8Array([..."LIST"].map((c) => c.charCodeAt(0)).concat([5, 0, 0, 0], [..."INFOx"].map((c) => c.charCodeAt(0)), [0]));
  return toBase64(new Uint8Array([...bytes.subarray(0, 36), ...list, ...bytes.subarray(36)]));
}

describe("checkWav", () => {
  test("accepts 0.5 s and 30 s of 16 kHz mono 16-bit PCM", () => {
    expect(() => checkWav(wavB64(0.5))).not.toThrow();
    expect(() => checkWav(wavB64(30))).not.toThrow();
  });

  test("finds the data chunk after an extra chunk browsers may add", () => {
    expect(() => checkWav(withListChunk())).not.toThrow();
  });

  test.each([
    ["not base64", "not base64!", /not base64/],
    ["too short", wavB64(0.4), /0\.5–30 s/],
    ["too long", wavB64(30.1), /0\.5–30 s/],
    ["not RIFF", btoa("hello world, this is not a wav file at all"), /RIFF\/WAVE/],
    ["not PCM", withFmt(20, 3), /PCM/],
    ["stereo", withFmt(22, 2), /mono/],
    ["8-bit", withFmt(34, 8), /16-bit/],
    ["truncated header", toBase64(wav(1).subarray(0, 30)), /RIFF\/WAVE|fmt/],
  ])("rejects %s with 422", (_name, b64, message) => {
    expect(() => checkWav(b64)).toThrow(message);
  });
});
