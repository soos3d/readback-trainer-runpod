import { describe, expect, it } from "vitest";
import { encodeWav, toBase64 } from "@/lib/client/wavEncode";

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit WAV with RIFF/WAVE/fmt/data headers", () => {
    const wav = encodeWav(new Float32Array(16000));
    const v = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(32044);
    expect(ascii(wav, 0)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(32036);
    expect(ascii(wav, 8)).toBe("WAVE");
    expect(ascii(wav, 12)).toBe("fmt ");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000); // byte rate
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36)).toBe("data");
    expect(v.getUint32(40, true)).toBe(32000);
  });

  it("clips samples to [-1, 1]", () => {
    const wav = encodeWav(Float32Array.from([2, -2, 1, -1, 0, 0.5]));
    const v = new DataView(wav.buffer);
    const s = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
    expect(s).toEqual([32767, -32768, 32767, -32768, 0, 16384]);
  });

  it("does not mutate its input", () => {
    const pcm = Float32Array.from([3]);
    encodeWav(pcm);
    expect(pcm[0]).toBe(3);
  });
});

describe("toBase64", () => {
  it("round-trips a WAV larger than one chunk", () => {
    const wav = encodeWav(Float32Array.from({ length: 40000 }, (_, i) => Math.sin(i / 10)));
    const back = Uint8Array.from(atob(toBase64(wav)), (c) => c.charCodeAt(0));
    expect(back).toEqual(wav);
  });

  it("matches Node's encoder", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
