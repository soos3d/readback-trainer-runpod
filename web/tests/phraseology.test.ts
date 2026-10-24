import { describe, expect, test } from "vitest";
import {
  abbreviatedCallsign,
  altimeter,
  altitude,
  callsign,
  DIGIT_WORDS,
  frequency,
  heading,
  PHONETIC,
  type Phrase,
  runway,
  spell,
  squawk,
  wind,
} from "@/lib/phraseology";

// SPEC §10: one row per spoken-form rule. Every spoken form must be digit-free, because the TTS reads it aloud.
const rows: [string, () => Phrase, string, string][] = [
  ["altitude: thousands digit by digit, then hundreds", () => altitude(11500), "11,500", "one one thousand five hundred"],
  ["altitude: hundreds only", () => altitude(800), "800", "eight hundred"],
  ["heading: always three digits", () => heading(40), "heading 040", "heading zero four zero"],
  ["frequency: 9 is niner, dot is point", () => frequency(119.4), "119.4", "one one niner point four"],
  ["frequency: a whole number gets .0", () => frequency(118), "118.0", "one one eight point zero"],
  ["frequency: a string keeps every decimal", () => frequency("121.850"), "121.850", "one two one point eight five zero"],
  ["squawk: leading zero survives", () => squawk("0451"), "squawk 0451", "squawk zero four five one"],
  ["altimeter: always two decimals", () => altimeter(29.9), "altimeter 29.90", "altimeter two niner niner zero"],
  ["runway: leading zero dropped", () => runway("07"), "runway 7", "runway seven"],
  ["runway: side spoken as a word", () => runway("13L"), "runway 13L", "runway one three left"],
  ["wind: gust displayed, gusts spoken", () => wind(80, 9, 18), "wind 080 at 9 gust 18", "wind zero eight zero at niner gusts one eight"],
  ["wind: variable", () => wind("VRB", 3), "wind variable at 3", "wind variable at three"],
  ["wind: 0 kt is calm", () => wind(0, 0), "wind calm", "wind calm"],
  ["callsign: full tail, capitalized words", () => callsign("N123AB"), "N123AB", "November One Two Three Alpha Bravo"],
  ["callsign: abbreviated to N + last three", () => abbreviatedCallsign("N123AB"), "N3AB", "November Three Alpha Bravo"],
  ["callsign: a short tail stays whole", () => abbreviatedCallsign("N9"), "N9", "November Niner"],
];

describe("phraseology §10", () => {
  test.each(rows)("%s", (_name, make, display, spoken) => {
    const p = make();
    expect(p.display).toBe(display);
    expect(p.spoken).toBe(spoken);
    expect(p.spoken).not.toMatch(/\d/);
  });
});

describe("invalid input fails fast", () => {
  test.each([
    ["altitude not a multiple of 100", () => altitude(3050)],
    ["heading 361", () => heading(361)],
    ["squawk with an 8", () => squawk("4581")],
    ["frequency garbage", () => frequency("12a.5")],
    ["runway 37", () => runway("37")],
    ["callsign without N", () => callsign("D123AB")],
    ["wind direction 400", () => wind(400, 5)],
    ["spell punctuation", () => spell("1-2")],
  ])("%s", (_name, run) => {
    expect(run).toThrow();
  });
});

describe("maps for the grader", () => {
  test("cover every digit and letter", () => {
    expect(Object.keys(DIGIT_WORDS)).toHaveLength(10);
    expect(Object.keys(PHONETIC)).toHaveLength(26);
    expect(DIGIT_WORDS["9"]).toBe("niner");
    expect(PHONETIC.A).toBe("alpha");
  });
});
