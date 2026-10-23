// Display and spoken forms for controller phraseology (SPEC §10).
// Spoken output is lower-case words only, except callsigns, which are capitalized.

export type Phrase = { display: string; spoken: string };

/** Digit → spoken word. The grader reverses this map. */
export const DIGIT_WORDS: Readonly<Record<string, string>> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
  "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "niner",
};

/** Upper-case letter → phonetic word. The grader reverses this map. */
export const PHONETIC: Readonly<Record<string, string>> = {
  A: "alpha", B: "bravo", C: "charlie", D: "delta", E: "echo", F: "foxtrot",
  G: "golf", H: "hotel", I: "india", J: "juliet", K: "kilo", L: "lima",
  M: "mike", N: "november", O: "oscar", P: "papa", Q: "quebec", R: "romeo",
  S: "sierra", T: "tango", U: "uniform", V: "victor", W: "whiskey",
  X: "x-ray", Y: "yankee", Z: "zulu",
};

const RUNWAY_SIDE: Readonly<Record<string, string>> = { L: "left", R: "right", C: "center" };

function check(ok: boolean, what: string, value: unknown): asserts ok {
  if (!ok) throw new Error(`phraseology: invalid ${what}: ${JSON.stringify(value)}`);
}

/** Spell digits and letters one at a time: "4521" → "four five two one". */
export function spell(chars: string): string {
  return [...chars]
    .map((c) => {
      const word = DIGIT_WORDS[c] ?? PHONETIC[c];
      check(word !== undefined, "character to spell", c);
      return word;
    })
    .join(" ");
}

/** 3000 → "three thousand"; 11500 → "one one thousand five hundred". */
export function altitude(feet: number): Phrase {
  check(Number.isInteger(feet) && feet > 0 && feet % 100 === 0, "altitude", feet);
  const thousands = Math.floor(feet / 1000);
  const hundreds = (feet % 1000) / 100;
  const words = [
    thousands > 0 ? `${spell(String(thousands))} thousand` : "",
    hundreds > 0 ? `${spell(String(hundreds))} hundred` : "",
  ];
  return { display: feet.toLocaleString("en-US"), spoken: words.filter(Boolean).join(" ") };
}

export function heading(degrees: number): Phrase {
  check(Number.isInteger(degrees) && degrees >= 1 && degrees <= 360, "heading", degrees);
  const ddd = String(degrees).padStart(3, "0");
  return { display: `heading ${ddd}`, spoken: `heading ${spell(ddd)}` };
}

/** Keeps every decimal given; a whole number gets ".0" (118 → "118.0"). */
export function frequency(mhz: number | string): Phrase {
  const text = typeof mhz === "number" && Number.isInteger(mhz) ? mhz.toFixed(1) : String(mhz);
  check(/^\d{3}\.\d{1,3}$/.test(text), "frequency", mhz);
  const [whole, decimals] = text.split(".");
  return { display: text, spoken: `${spell(whole)} point ${spell(decimals)}` };
}

/** A string, so leading zeros survive ("0451"). */
export function squawk(code: string): Phrase {
  check(/^[0-7]{4}$/.test(code), "squawk", code);
  return { display: `squawk ${code}`, spoken: `squawk ${spell(code)}` };
}

export function altimeter(inHg: number): Phrase {
  const text = inHg.toFixed(2);
  check(/^\d{2}\.\d{2}$/.test(text), "altimeter", inHg);
  return { display: `altimeter ${text}`, spoken: `altimeter ${spell(text.replace(".", ""))}` };
}

/** "07" → runway 7; "13L" → runway 13L / one three left. */
export function runway(id: string): Phrase {
  const m = /^(\d{1,2})([LRC]?)$/.exec(id);
  const num = m ? Number(m[1]) : NaN;
  check(m !== null && num >= 1 && num <= 36, "runway", id);
  const side = m[2];
  const spoken = [spell(String(num)), RUNWAY_SIDE[side] ?? ""].filter(Boolean).join(" ");
  return { display: `runway ${num}${side}`, spoken: `runway ${spoken}` };
}

/** Speed 0 → "wind calm". Display says "gust", spoken says "gusts" (SPEC §10 table). */
export function wind(direction: number | "VRB", knots: number, gust?: number): Phrase {
  const dirOk = direction === "VRB" || (Number.isInteger(direction) && direction >= 0 && direction <= 360);
  check(dirOk, "wind direction", direction);
  check(Number.isInteger(knots) && knots >= 0, "wind speed", knots);
  check(gust === undefined || (Number.isInteger(gust) && gust > knots), "wind gust", gust);
  if (knots === 0) return { display: "wind calm", spoken: "wind calm" };

  const ddd = direction === "VRB" ? "" : String(direction).padStart(3, "0");
  const dir = direction === "VRB" ? { display: "variable", spoken: "variable" } : { display: ddd, spoken: spell(ddd) };
  const g = gust === undefined ? { display: "", spoken: "" } : { display: ` gust ${gust}`, spoken: ` gusts ${spell(String(gust))}` };
  return {
    display: `wind ${dir.display} at ${knots}${g.display}`,
    spoken: `wind ${dir.spoken} at ${spell(String(knots))}${g.spoken}`,
  };
}

const CALLSIGN = /^N[0-9][0-9A-Z]{0,4}$/;

function spokenCallsign(cs: string): string {
  return spell(cs)
    .split(" ")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** "N123AB" → "November One Two Three Alpha Bravo". */
export function callsign(cs: string): Phrase {
  check(CALLSIGN.test(cs), "callsign", cs);
  return { display: cs, spoken: spokenCallsign(cs) };
}

/** "N" + last three characters (SPEC §9.2): N123AB → N3AB. A tail of 3 or fewer stays whole: N9 → N9. */
export function abbreviatedCallsign(cs: string): Phrase {
  check(CALLSIGN.test(cs), "callsign", cs);
  const short = `N${cs.slice(1).slice(-3)}`;
  return { display: short, spoken: spokenCallsign(short) };
}
