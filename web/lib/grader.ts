// Transcript + scenario → GradeResult (SPEC §11). Deterministic; no LLM.
import { ApiError } from "./errors";
import { normalize } from "./normalize";
import { abbreviatedCallsign, altitude } from "./phraseology";
import { isTodo, type ExpectedItem, type GradeResult, type Kind, type Scenario } from "./schemas";

type Value = ExpectedItem["value"];
type Matcher = {
  /** Display form of the expected value; also the form `heard` uses. */
  display: (v: Value) => string;
  /** Display form found in the transcript that counts as correct, or null. */
  hit: (tokens: string[], item: ExpectedItem, expected: string) => string | null;
  /** Display forms in a position that makes the readback incorrect (e.g. right after "squawk"). */
  wrong: (tokens: string[]) => string[];
};

const after = (tokens: string[], keyword: string): string[] =>
  tokens.flatMap((t, i) => (t === keyword && i + 1 < tokens.length ? [tokens[i + 1]] : []));

function hasPhrase(tokens: string[], phrase: string): boolean {
  const words = normalize(phrase);
  return words.length > 0 && ` ${tokens.join(" ")} `.includes(` ${words.join(" ")} `);
}

const phraseHit: Matcher["hit"] = (tokens, item) =>
  [String(item.value), ...(item.accept ?? [])].find((p) => hasPhrase(tokens, p)) ?? null;

/** Every altitude in the transcript with its token index: "3 thousand 5 hundred", "3000", "8 hundred". */
function altitudes(tokens: string[]): { feet: number; index: number }[] {
  const found: { feet: number; index: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i])) continue;
    const n = Number(tokens[i]);
    if (tokens[i + 1] === "thousand") {
      const hundreds = /^\d$/.test(tokens[i + 2] ?? "") && tokens[i + 3] === "hundred" ? Number(tokens[i + 2]) : 0;
      found.push({ feet: n * 1000 + hundreds * 100, index: i });
      i += hundreds ? 3 : 1;
    } else if (tokens[i + 1] === "hundred") {
      found.push({ feet: n * 100, index: i });
      i += 1;
    } else if (n >= 100 && n % 100 === 0) {
      found.push({ feet: n, index: i });
    }
  }
  return found.filter((a) => a.feet > 0);
}

const ALTITUDE_KEYWORDS = new Set(["climb", "descend", "maintain", "expect"]);
const ALTITUDE_WINDOW = 4; // "climb and maintain 3000": the value may sit a few tokens after the keyword.

function runways(tokens: string[]): string[] {
  const SIDE: Record<string, string> = { left: "L", right: "R", center: "C", l: "L", r: "R", c: "C" };
  return tokens.flatMap((t, i) => {
    const m = tokens[i - 1] === "runway" ? /^(\d{1,2})([lrc]?)$/.exec(t) : null;
    if (!m) return [];
    return [`${Number(m[1])}${m[2].toUpperCase() || (SIDE[tokens[i + 1]] ?? "")}`];
  });
}

const MATCHERS: Record<Kind, Matcher> = {
  callsign: {
    display: String,
    hit: (tokens, item) => {
      const tail = String(item.value);
      const abbrev = abbreviatedCallsign(tail).display;
      if (tokens.join("").includes(tail.toLowerCase())) return tail;
      return tokens.some((t) => t === abbrev.toLowerCase() || t === abbrev.slice(1).toLowerCase()) ? abbrev : null;
    },
    wrong: () => [],
  },
  place: {
    display: String,
    hit: (tokens, item) => {
      const icao = String(item.value);
      if (tokens.includes(icao.toLowerCase())) return icao;
      return (item.accept ?? []).find((p) => hasPhrase(tokens, p)) ?? null;
    },
    wrong: () => [],
  },
  route: { display: String, hit: phraseHit, wrong: () => [] },
  phrase: { display: String, hit: phraseHit, wrong: () => [] },
  altitude: {
    display: (v) => altitude(Number(v)).display,
    hit: (tokens, item, expected) => (altitudes(tokens).some((a) => a.feet === Number(item.value)) ? expected : null),
    wrong: (tokens) =>
      altitudes(tokens)
        .filter((a) => tokens.slice(Math.max(0, a.index - ALTITUDE_WINDOW), a.index).some((t) => ALTITUDE_KEYWORDS.has(t)))
        .map((a) => altitude(a.feet).display),
  },
  heading: {
    display: (v) => String(Number(v)).padStart(3, "0"),
    hit: (tokens, _item, expected) =>
      tokens.includes(expected) || after(tokens, "heading").some((t) => /^\d{1,3}$/.test(t) && t.padStart(3, "0") === expected)
        ? expected
        : null,
    wrong: (tokens) => after(tokens, "heading").filter((t) => /^\d{1,3}$/.test(t)).map((t) => t.padStart(3, "0")),
  },
  frequency: {
    display: String,
    hit: (tokens, _item, expected) =>
      tokens.includes(expected) || tokens.includes(expected.replace(".", "")) ? expected : null,
    wrong: (tokens) => tokens.filter((t) => /^1\d\d\.\d{1,3}$/.test(t)),
  },
  squawk: {
    display: (v) => String(v).padStart(4, "0"),
    hit: (tokens, _item, expected) => (tokens.includes(expected) ? expected : null),
    wrong: (tokens) => after(tokens, "squawk").filter((t) => /^\d{4}$/.test(t)),
  },
  altimeter: {
    display: (v) => (typeof v === "number" ? v.toFixed(2) : v),
    hit: (tokens, _item, expected) =>
      tokens.includes(expected) || tokens.includes(expected.replace(".", "")) ? expected : null,
    wrong: (tokens) =>
      after(tokens, "altimeter")
        .filter((t) => /^(29|30|31)\.?\d\d$/.test(t))
        .map((t) => `${t.slice(0, 2)}.${t.slice(-2)}`),
  },
  runway: {
    display: (v) => {
      const m = /^0?(\d{1,2}[LRC]?)$/.exec(String(v).toUpperCase());
      if (!m) throw new Error(`grader: invalid runway: ${JSON.stringify(v)}`);
      return m[1];
    },
    hit: (tokens, _item, expected) => (runways(tokens).includes(expected) ? expected : null),
    wrong: runways,
  },
};

type Item = GradeResult["items"][number];

/**
 * Grades items in order. A wrong value goes to the first same-kind item that has not matched,
 * and never to a value another item expects, so "maintain 3000" leaves "expect 7000" missing, not incorrect.
 */
function gradeItems(tokens: string[], items: ExpectedItem[]): Item[] {
  const claimed = new Set<string>();
  return items.map((item) => {
    const m = MATCHERS[item.kind];
    const expected = m.display(item.value);
    const base = { key: item.key, label: item.label, expected };
    const heard = m.hit(tokens, item, expected);
    if (heard !== null) return { ...base, heard, status: "correct" };
    const others = new Set(items.filter((o) => o.kind === item.kind).map((o) => m.display(o.value)));
    const wrong = m.wrong(tokens).find((w) => !others.has(w) && !claimed.has(`${item.kind}:${w}`));
    if (wrong === undefined) return { ...base, heard: null, status: "missing" };
    claimed.add(`${item.kind}:${wrong}`);
    return { ...base, heard: wrong, status: "incorrect" };
  });
}

const tip = (i: Item): string =>
  i.status === "incorrect"
    ? `${i.label}: you said ${i.heard}; the clearance was ${i.expected}.`
    : `${i.label}: expected ${i.expected}, not heard.`;

export function grade(scenario: Pick<Scenario, "expected">, transcript: string): GradeResult {
  const required = scenario.expected.filter((i) => !isTodo(i.value));
  if (required.length === 0) throw new ApiError(422, "invalid_input", "scenario has no gradable items", "web");
  const items = gradeItems(normalize(transcript), required);
  const correct = items.filter((i) => i.status === "correct").length;
  const verdict = items.some((i) => i.status === "incorrect")
    ? "readback_incorrect"
    : correct === items.length
      ? "readback_correct"
      : "readback_incomplete";
  return {
    verdict,
    score: Math.round((correct / items.length) * 100) / 100,
    items,
    tips: items.filter((i) => i.status !== "correct").map(tip),
  };
}
