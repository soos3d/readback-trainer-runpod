import { describe, expect, test } from "vitest";
import { grade } from "@/lib/grader";
import { GradeResult, type ExpectedItem } from "@/lib/schemas";

// SPEC §12.3 example IFR clearance.
const IFR: ExpectedItem[] = [
  { key: "callsign", kind: "callsign", label: "Callsign", value: "N123AB" },
  { key: "limit", kind: "place", label: "Clearance limit", value: "KGNV", accept: ["gainesville"] },
  { key: "route", kind: "route", label: "Route", value: "as filed" },
  { key: "altitude", kind: "altitude", label: "Altitude", value: 3000 },
  { key: "expect", kind: "altitude", label: "Expect altitude", value: 7000 },
  { key: "dep_freq", kind: "frequency", label: "Departure frequency", value: "119.4" },
  { key: "squawk", kind: "squawk", label: "Squawk", value: "4521" },
];

const WORDS =
  "november one two three alpha bravo cleared to gainesville airport as filed climb and maintain three thousand " +
  "expect seven thousand one zero minutes after departure departure frequency one one niner point four squawk four five two one";
const DIGITS =
  "N123AB cleared to Gainesville as filed, climb maintain 3000, expect 7000 10 minutes after, departure 119.4, squawk 4521";

const ifr = (transcript: string) => grade({ expected: IFR }, transcript);
const one = (item: ExpectedItem, transcript: string) => grade({ expected: [item] }, transcript).items[0];
const statusOf = (r: GradeResult, key: string) => r.items.find((i) => i.key === key)?.status;

describe("grade: IFR clearance §12.3", () => {
  test("perfect readback in words", () => {
    const r = ifr(WORDS);
    expect(r.verdict).toBe("readback_correct");
    expect(r.score).toBe(1);
    expect(r.tips).toEqual([]);
    expect(GradeResult.parse(r)).toEqual(r);
  });
  test("perfect readback in digits", () => {
    const r = ifr(DIGITS);
    expect(r.verdict).toBe("readback_correct");
    expect(r.score).toBe(1);
    expect(r.items.map((i) => i.heard)).toEqual(["N123AB", "gainesville", "as filed", "3,000", "7,000", "119.4", "4521"]);
  });
  test("wrong altitude is incorrect with the §11.4 tip", () => {
    const r = ifr(WORDS.replace("climb and maintain three", "climb maintain four"));
    expect(r.verdict).toBe("readback_incorrect");
    expect(r.items.find((i) => i.key === "altitude")).toMatchObject({ expected: "3,000", heard: "4,000", status: "incorrect" });
    expect(statusOf(r, "expect")).toBe("correct");
    expect(r.tips).toEqual(["Altitude: you said 4,000; the clearance was 3,000."]);
    expect(r.score).toBe(0.86);
  });
  test("omitted squawk is incomplete", () => {
    const r = ifr(DIGITS.replace(", squawk 4521", ""));
    expect(r.verdict).toBe("readback_incomplete");
    expect(r.items.find((i) => i.key === "squawk")).toMatchObject({ heard: null, status: "missing" });
    expect(r.tips).toEqual(["Squawk: expected 4521, not heard."]);
    expect(r.score).toBe(0.86);
  });
  test("abbreviated callsign is accepted", () => {
    const r = ifr(WORDS.replace("november one two three alpha bravo", "November Three Alpha Bravo"));
    expect(r.items[0]).toMatchObject({ heard: "N3AB", status: "correct" });
  });
  test("omitted expect altitude is missing, not incorrect", () => {
    const r = ifr(DIGITS.replace("expect 7000 10 minutes after,", ""));
    expect(statusOf(r, "altitude")).toBe("correct");
    expect(statusOf(r, "expect")).toBe("missing");
  });
  test("two wrong altitudes each go to their own item", () => {
    const r = ifr(DIGITS.replace("3000", "4000").replace("7000", "8000"));
    expect(r.items.filter((i) => i.status === "incorrect").map((i) => i.heard)).toEqual(["4,000", "8,000"]);
  });
  test("TODO items are skipped and not required", () => {
    const todo: ExpectedItem = { key: "x", kind: "frequency", label: "Tower", value: "TODO" };
    const r = grade({ expected: [...IFR, todo] }, DIGITS);
    expect(r.items).toHaveLength(7);
    expect(r.score).toBe(1);
  });
  test("empty transcript: everything missing", () => {
    const r = ifr("");
    expect(r.verdict).toBe("readback_incomplete");
    expect(r.score).toBe(0);
    expect(r.items.every((i) => i.status === "missing" && i.heard === null)).toBe(true);
  });
  test("a scenario with nothing gradable throws", () => {
    expect(() => grade({ expected: [] }, DIGITS)).toThrow(/no gradable items/);
  });
});

describe("matchers §11.2", () => {
  const item = (kind: ExpectedItem["kind"], value: string | number, accept?: string[]): ExpectedItem => ({
    key: kind, kind, label: kind, value, ...(accept ? { accept } : {}),
  });

  test("callsign: full tail, last three, or missing", () => {
    expect(one(item("callsign", "N123AB"), "november 123AB").status).toBe("correct");
    expect(one(item("callsign", "N123AB"), "three alpha bravo").status).toBe("correct");
    expect(one(item("callsign", "N123AB"), "november four alpha bravo").status).toBe("missing");
  });
  test("place: accept word or spelled ICAO", () => {
    expect(one(item("place", "KGNV", ["gainesville"]), "cleared to Gainesville").status).toBe("correct");
    expect(one(item("place", "KGNV", ["gainesville"]), "cleared to kilo golf november victor").heard).toBe("KGNV");
    expect(one(item("place", "KGNV", ["gainesville"]), "cleared to ocala").status).toBe("missing");
  });
  test("route: phrase present", () => {
    expect(one(item("route", "via radar vectors, then as filed"), "via radar vectors then as filed").status).toBe("correct");
    expect(one(item("route", "as filed"), "as field").status).toBe("missing");
  });
  test("altitude: 10,000, 5,500 and wrong after descend", () => {
    expect(one(item("altitude", 10000), "maintain one zero thousand").status).toBe("correct");
    expect(one(item("altitude", 5500), "five thousand five hundred").status).toBe("correct");
    expect(one(item("altitude", 800), "maintain eight hundred").status).toBe("correct");
    expect(one(item("altitude", 3000), "descend and maintain two thousand")).toMatchObject({ status: "incorrect", heard: "2,000" });
  });
  test("heading: 040, 40 after heading, wrong value", () => {
    expect(one(item("heading", 40), "heading zero four zero").status).toBe("correct");
    expect(one(item("heading", 40), "heading 40").status).toBe("correct");
    expect(one(item("heading", 40), "turn left heading zero five zero")).toMatchObject({ status: "incorrect", heard: "050" });
  });
  test("frequency: with or without point, wrong 1xx.x", () => {
    expect(one(item("frequency", "119.4"), "departure 1194").status).toBe("correct");
    expect(one(item("frequency", "121.85"), "one two one point eight five").status).toBe("correct");
    expect(one(item("frequency", "119.4"), "departure 120.4")).toMatchObject({ status: "incorrect", heard: "120.4" });
    expect(one(item("frequency", "119.4"), "squawk 1200").status).toBe("missing");
  });
  test("squawk: bare code ok, wrong code after squawk", () => {
    expect(one(item("squawk", "4521"), "four five two one").status).toBe("correct");
    expect(one(item("squawk", "4521"), "squawk 4512")).toMatchObject({ status: "incorrect", heard: "4512" });
  });
  test("altimeter: 3002 run, wrong 29xx after altimeter", () => {
    expect(one(item("altimeter", "30.02"), "altimeter three zero zero two").status).toBe("correct");
    expect(one(item("altimeter", 30.02), "altimeter 30.02").status).toBe("correct");
    expect(one(item("altimeter", "30.02"), "altimeter two niner niner two")).toMatchObject({ status: "incorrect", heard: "29.92" });
  });
  test("runway: leading zero optional, side words, wrong runway", () => {
    expect(one(item("runway", "07"), "runway seven").status).toBe("correct");
    expect(one(item("runway", "13L"), "runway one three left").status).toBe("correct");
    expect(one(item("runway", "13L"), "runway 13L").status).toBe("correct");
    expect(one(item("runway", "13L"), "runway 13 right")).toMatchObject({ status: "incorrect", heard: "13R" });
    expect(one(item("runway", "13L"), "one three left").status).toBe("missing");
  });
  test("phrase: cleared for takeoff", () => {
    expect(one(item("phrase", "cleared for takeoff"), "runway 7, cleared for takeoff").status).toBe("correct");
    expect(one(item("phrase", "cleared for takeoff"), "runway 7, line up and wait").status).toBe("missing");
  });
});
