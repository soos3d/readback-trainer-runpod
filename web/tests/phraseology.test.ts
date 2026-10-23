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

// SPEC §10, one row per case, plus the edges from the T04 card.
const rows: [string, () => Phrase, string, string][] = [
  ["digit 9", () => ({ display: "9", spoken: spell("9") }), "9", "niner"],
  ["altitude 3000", () => altitude(3000), "3,000", "three thousand"],
  ["altitude 5500", () => altitude(5500), "5,500", "five thousand five hundred"],
  ["altitude 10000", () => altitude(10000), "10,000", "one zero thousand"],
  ["altitude 11500", () => altitude(11500), "11,500", "one one thousand five hundred"],
  ["altitude 800", () => altitude(800), "800", "eight hundred"],
  ["heading 40", () => heading(40), "heading 040", "heading zero four zero"],
  ["heading 360", () => heading(360), "heading 360", "heading three six zero"],
  ["frequency 119.4", () => frequency(119.4), "119.4", "one one niner point four"],
  ["frequency 121.85", () => frequency(121.85), "121.85", "one two one point eight five"],
  ["frequency string 121.850", () => frequency("121.850"), "121.850", "one two one point eight five zero"],
  ["frequency 118", () => frequency(118), "118.0", "one one eight point zero"],
  ["squawk 4521", () => squawk("4521"), "squawk 4521", "squawk four five two one"],
  ["squawk 0451", () => squawk("0451"), "squawk 0451", "squawk zero four five one"],
  ["altimeter 30.02", () => altimeter(30.02), "altimeter 30.02", "altimeter three zero zero two"],
  ["altimeter 29.9", () => altimeter(29.9), "altimeter 29.90", "altimeter two niner niner zero"],
  ["runway 07", () => runway("07"), "runway 7", "runway seven"],
  ["runway 13L", () => runway("13L"), "runway 13L", "runway one three left"],
  ["runway 36C", () => runway("36C"), "runway 36C", "runway three six center"],
  ["runway 9R", () => runway("9R"), "runway 9R", "runway niner right"],
  ["wind 080 at 9 G18", () => wind(80, 9, 18), "wind 080 at 9 gust 18", "wind zero eight zero at niner gusts one eight"],
  ["wind 260 at 12", () => wind(260, 12), "wind 260 at 12", "wind two six zero at one two"],
  ["wind VRB at 3", () => wind("VRB", 3), "wind variable at 3", "wind variable at three"],
  ["wind calm", () => wind(0, 0), "wind calm", "wind calm"],
  ["callsign N123AB", () => callsign("N123AB"), "N123AB", "November One Two Three Alpha Bravo"],
  ["abbreviated N123AB", () => abbreviatedCallsign("N123AB"), "N3AB", "November Three Alpha Bravo"],
  ["abbreviated N9 (short tail)", () => abbreviatedCallsign("N9"), "N9", "November Niner"],
  ["abbreviated N12X", () => abbreviatedCallsign("N12X"), "N12X", "November One Two X-ray"],
  ["callsign N9", () => callsign("N9"), "N9", "November Niner"],
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
    ["altitude zero", () => altitude(0)],
    ["heading 000", () => heading(0)],
    ["heading 361", () => heading(361)],
    ["squawk with an 8", () => squawk("4581")],
    ["squawk too short", () => squawk("451")],
    ["frequency garbage", () => frequency("12a.5")],
    ["runway 37", () => runway("37")],
    ["runway bad suffix", () => runway("13X")],
    ["callsign without N", () => callsign("D123AB")],
    ["callsign too long", () => callsign("N123ABC")],
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
