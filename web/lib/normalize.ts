// Transcript → tokens for the grader (SPEC §11.1). Accepts Whisper's word and digit styles.
import { DIGIT_WORDS, PHONETIC } from "./phraseology";

const invert = (map: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));

// Phonetic words map to UPPER-case letters so the merge step can tell them from a stray
// English "a"; everything is lower-cased at the end.
const WORDS: Readonly<Record<string, string>> = {
  ...invert(DIGIT_WORDS), nine: "9", tree: "3", fife: "5",
  ...invert(PHONETIC), alfa: "A", juliett: "J", xray: "X",
};

// Only between digits: "four five oh one" → 4501, but "oh" alone stays a word.
const BETWEEN_DIGITS: Readonly<Record<string, string>> = { oh: "0", point: ".", decimal: "." };

function clean(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/x-ray/g, "xray")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/,/g, " , ")
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Joins single digits/letters into runs ("1 1 9 . 4" → "119.4"); multi-character tokens stay alone.
 * A comma ends a run, and "N" after an all-digit run starts a callsign ("2 8 0 N 9" → "280", "N9"). */
function merge(tokens: string[]): string[] {
  const out: string[] = [];
  let open = false;
  for (const t of tokens) {
    const last = out.length - 1;
    if (t === ",") {
      open = false;
    } else if (open && t === "N" && /^\d+$/.test(out[last])) {
      out.push(t);
    } else if (t === "." && last >= 0) {
      out[last] += t;
      open = true;
    } else if (open && /^[0-9A-Z]$/.test(t)) {
      out[last] += t;
    } else {
      out.push(t);
      open = /^[0-9A-Z]$/.test(t);
    }
  }
  return out;
}

export function normalize(transcript: string): string[] {
  const mapped = clean(transcript).map((t) => WORDS[t] ?? t);
  const contextual = mapped.map((t, i) => {
    const between = /\d$/.test(mapped[i - 1] ?? "") && /^\d/.test(mapped[i + 1] ?? "");
    return between ? (BETWEEN_DIGITS[t] ?? t) : t;
  });
  return merge(contextual).map((t) => t.toLowerCase());
}
