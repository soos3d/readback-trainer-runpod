import { describe, expect, test } from "vitest";
import { AIRPORTS, AirportsFile, GradeRequest, isTodo, ScenarioRequest, SpeakRequest } from "@/lib/schemas";
import airportsJson from "@/lib/airports.json";

describe("ScenarioRequest", () => {
  const ok = { airport: "KTTD", type: "takeoff" };

  test("accepts a known airport with optional seed and simulate", () => {
    expect(ScenarioRequest.parse({ ...ok, seed: 999_999, simulate: ["awc_down"] })).toEqual({
      ...ok,
      seed: 999_999,
      simulate: ["awc_down"],
    });
  });

  test.each([
    ["an airport not in airports.json", { ...ok, airport: "KZZZ" }],
    ["an unknown key", { ...ok, extra: 1 }],
    ["a seed above 999,999", { ...ok, seed: 1_000_000 }],
    ["an unknown outage to simulate", { ...ok, simulate: ["gpu_down"] }],
  ])("rejects %s", (_label, body) => {
    expect(ScenarioRequest.safeParse(body).success).toBe(false);
  });
});

describe("request bodies", () => {
  test("SpeakRequest strips control characters and caps at 600 printable ASCII", () => {
    expect(SpeakRequest.parse({ text: "climb\u0007 and maintain" }).text).toBe("climb and maintain");
    expect(SpeakRequest.safeParse({ text: "x".repeat(601) }).success).toBe(false);
    expect(SpeakRequest.safeParse({ text: "café" }).success).toBe(false);
  });

  test("GradeRequest rejects a malformed scenario", () => {
    expect(GradeRequest.safeParse({ scenario: {}, transcript: "hi" }).success).toBe(false);
  });
});

describe("airports.json", () => {
  test("parses and holds the three pilot airports", () => {
    expect(Object.keys(AIRPORTS).sort()).toEqual(["KORL", "KTTD", "KVGT"]);
    expect(AIRPORTS.KTTD.runways_fallback).toEqual([{ id: "07/25", alignment: 89 }]);
  });

  test("shipped file: no TODO fields remain", () => {
    const todos = Object.entries(AIRPORTS).flatMap(([icao, a]) =>
      Object.entries(a).filter(([, v]) => isTodo(v) || (typeof v === "object" && Object.values(v).some(isTodo)))
        .map(([field]) => `${icao}.${field}`),
    );
    expect(todos).toEqual([]);
    expect(isTodo("118.7")).toBe(false);
  });

  test("approaches: KTTD lists its circling-only approach under the reserved key", () => {
    expect(AIRPORTS.KTTD.approaches).toEqual({ circling: ["RNAV (GPS)-A"] });
  });

  test("approaches: accepts runway ends and \"circling\", rejects other keys", () => {
    const kttd = airportsJson.KTTD;
    const parse = (approaches: unknown) => AirportsFile.safeParse({ KTTD: { ...kttd, approaches } }).success;
    expect(parse({ "25": ["ILS"], circling: ["VOR-A"] })).toBe(true);
    expect(parse({ circle: ["VOR-A"] })).toBe(false);
    expect(parse({ Circling: ["VOR-A"] })).toBe(false);
    expect(parse({ "37": ["ILS"] })).toBe(false);
    expect(parse({ circling: [] })).toBe(false);
  });

  test("rejects a guessed-looking bad frequency and a stray key", () => {
    const kttd = airportsJson.KTTD;
    expect(AirportsFile.safeParse({ KTTD: { ...kttd, tower_fallback_freq: "120" } }).success).toBe(false);
    expect(AirportsFile.safeParse({ KTTD: { ...kttd, tower: "x" } }).success).toBe(false);
  });
});
