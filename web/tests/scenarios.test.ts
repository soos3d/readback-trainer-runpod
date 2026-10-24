import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import kttdMetar from "./fixtures/KTTD-metar.json";
import korlMetar from "./fixtures/KORL-metar.json";
import kttdAirport from "./fixtures/KTTD-airport.json";
import kttdDepartures from "./fixtures/KTTD-departures.json";
import kttdArrivals from "./fixtures/KTTD-arrivals.json";
import token from "./fixtures/opensky-token.json";
import { buildScenario } from "@/lib/scenarios";
import { grade } from "@/lib/grader";
import { endHeading } from "@/lib/runway";
import { ApiError } from "@/lib/errors";
import { AIRPORTS, CallType, Scenario, type AirportConfig, type Snapshot } from "@/lib/schemas";
import { getAirportInfo, getWeather } from "@/lib/sources/aviationweather";
import { getFlight } from "@/lib/sources/opensky";

const NOW = Date.UTC(2026, 9, 23, 16, 0); // fixtures recorded 2026-10-23 ~16:00Z
const SEED = 48213;
const TYPES = CallType.options;

// TEST-ONLY airport config. Frequencies, approaches and altitudes are made up for the tests;
// they are not real KTTD data and must never be copied into airports.json.
const TEST_KTTD: AirportConfig = {
  radio_name: "Troutdale",
  clearance: { name: "TODO", freq: "121.85" },
  tower_fallback_freq: "118.3",
  departure: { name: "Test Departure", freq: "119.4" },
  approach: { name: "TODO", freq: "124.35" },
  calm_wind_runway: "25",
  approaches: { "07": ["RNAV (GPS)"], "25": ["ILS", "RNAV (GPS)"] },
  nearby_destinations: ["KPDX"],
  min_vector_altitude: 2000,
  max_assign_altitude: 9000,
  runways_fallback: [{ id: "07/25", alignment: 89 }],
};

const FIXTURES: Record<string, unknown> = {
  "metar?ids=KTTD": kttdMetar, "metar?ids=KORL": korlMetar, "airport?ids=KTTD": kttdAirport,
  "departure?airport=KTTD": kttdDepartures, "arrival?airport=KTTD": kttdArrivals,
};

let dep: Snapshot; // departure flight: ifr_clearance, takeoff, departure
let arr: Snapshot; // arrival flight: approach_vectors, approach_clearance
let windy: Snapshot["weather"];
beforeAll(async () => {
  vi.stubEnv("AWC_USER_AGENT", "test");
  vi.stubEnv("OPENSKY_CLIENT_ID", "id");
  vi.stubEnv("OPENSKY_CLIENT_SECRET", "secret");
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/token")) return Response.json({ ...token, access_token: "tok" });
    const hit = Object.entries(FIXTURES).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return Response.json(hit[1]);
  });
  const opts = { now: () => NOW, seed: SEED };
  const [weather, airport] = await Promise.all([getWeather("KTTD", opts), getAirportInfo("KTTD", opts)]);
  dep = { weather, airport, flight: await getFlight("KTTD", "departure", opts) };
  arr = { weather, airport, flight: await getFlight("KTTD", "arrival", opts) };
  windy = await getWeather("KORL", opts); // 020 at 13
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const snapFor = (type: CallType) => (type.startsWith("approach") ? arr : dep);
const build = (type: CallType, seed = SEED, config = TEST_KTTD, snapshot = snapFor(type)) =>
  buildScenario({ icao: "KTTD", type, seed, config, snapshot });

describe("fixtures + seed 48213", () => {
  test.each(TYPES)("%s: exact text, speech and expected", (type) => {
    const s = build(type);
    expect(Scenario.parse(s)).toEqual(s);
    expect({ text: s.controller_text, speech: s.controller_speech, expected: s.expected }).toMatchSnapshot();
  });
  test.each(TYPES)("%s: same seed twice is deep-equal", (type) => {
    expect(build(type)).toEqual(build(type));
  });
});

describe("grader accepts a correct readback (seed 48213)", () => {
  const READBACKS: Record<CallType, string> = {
    ifr_clearance: "cleared to KSLE radar vectors then as filed, climb maintain 3000, expect 8000, departure 119.4, squawk 0770, N91055",
    takeoff: "left heading 220, runway 25, cleared for takeoff, November zero five five",
    // Callsign first: T07's normalize() would fuse "two eight zero, November…" into one token (see handoff T09).
    departure: "November niner one zero five five, climb and maintain four thousand, right heading two eight zero",
    approach_vectors: "altimeter 30.28, down to 4000, heading 220, vectors ILS runway 25, zero one hotel",
    approach_clearance:
      "right heading 270, maintain 2000 until established, cleared for the ILS runway 25, tower 120.9, November zero one hotel",
  };
  test.each(TYPES)("%s", (type) => {
    expect(grade(build(type), READBACKS[type])).toMatchObject({ verdict: "readback_correct", score: 1 });
  });
});

describe("seeds 0–999", () => {
  const REJECT = ["0000", "1200", "7500", "7600", "7700", "7777"];
  test.each(TYPES)("%s: squawks, headings, speech", (type) => {
    for (let seed = 0; seed < 1000; seed++) {
      const s = build(type, seed);
      expect(s.controller_speech).not.toMatch(/\d/);
      for (const item of s.expected) {
        if (item.kind === "squawk") {
          expect(item.value).toMatch(/^[0-7]{4}$/);
          expect(REJECT).not.toContain(item.value);
        }
        if (item.kind !== "heading") continue;
        const h = Number(item.value);
        expect(h % 10 === 0 && h >= 10 && h <= 360).toBe(true);
        if (type !== "takeoff") continue;
        const d = Math.abs(h - endHeading(s.context.runway)) % 360;
        expect(Math.min(d, 360 - d)).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe("airports.json TODO rules", () => {
  const todo: AirportConfig = {
    ...TEST_KTTD,
    tower_fallback_freq: "TODO",
    calm_wind_runway: "TODO",
    approaches: "TODO",
    nearby_destinations: "TODO",
    min_vector_altitude: "TODO",
    max_assign_altitude: "TODO",
  };

  test("takeoff works today: AWC tower freq, generic tower name, calm-wind warning", () => {
    const s = build("takeoff", SEED, todo);
    expect(s.facility).toEqual({ name: "Troutdale Tower", freq: "120.9" });
    expect(s.context.runway).toBe("07");
    expect(s.warnings).toContain("Calm-wind runway not set — using runway 07");
  });

  test("tower freq: AWC first, then tower_fallback_freq, then frequency not set", () => {
    const noAwc = { ...dep, airport: { ...dep.airport, data: { ...dep.airport.data, tower_freq: null } } };
    expect(build("takeoff", SEED, TEST_KTTD, noAwc).facility.freq).toBe("118.3");
    const s = build("takeoff", SEED, todo, noAwc);
    expect(s.facility.freq).toBe("frequency not set");
    expect(s.warnings).toContain("Tower frequency not set in airports.json");
  });

  test("TODO departure freq: said as not set, warned, not graded", () => {
    const s = build("ifr_clearance", SEED, { ...TEST_KTTD, departure: { name: "TODO", freq: "TODO" } });
    expect(s.controller_text).toContain("Departure frequency not set, squawk");
    expect(s.controller_speech).toContain("Departure frequency not set, squawk");
    expect(s.expected.map((i) => i.key)).not.toContain("dep_freq");
    expect(s.warnings).toContain("Departure frequency not set in airports.json");
  });

  test("wind picks the runway; no calm warning when the wind decides", () => {
    const s = build("takeoff", SEED, todo, { ...dep, weather: windy });
    expect(s.context.runway).toBe("07");
    expect(s.controller_text).toContain("wind 360 at 13"); // 020 true minus 16E variation = 004, rounds to 360 magnetic
    expect(s.warnings.some((w) => w.startsWith("Calm-wind"))).toBe(false);
  });

  test.each([
    ["ifr_clearance", "min_vector_altitude, max_assign_altitude"],
    ["departure", "min_vector_altitude, max_assign_altitude"],
    ["approach_vectors", "approaches"],
    ["approach_clearance", "approaches, min_vector_altitude"],
  ] as const)("%s with TODO fields → 422 naming them", (type, fields) => {
    const err = (() => {
      try {
        build(type, SEED, todo);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422, code: "invalid_input", source: "web",
      message: `KTTD needs ${fields} in airports.json for ${type}`,
    });
  });

  test("approaches that match no runway end → 422", () => {
    expect(() => build("approach_vectors", SEED, { ...TEST_KTTD, approaches: { "18": ["ILS"] } })).toThrow(
      "KTTD approaches in airports.json list no runway end that aviationweather reports",
    );
  });

  test("destination is the airport itself (nearby_destinations TODO): radio name, accepted by the grader", () => {
    const flight = { ...dep.flight, data: { ...dep.flight.data, other_airport: "KTTD" } };
    const s = build("ifr_clearance", SEED, TEST_KTTD, { ...dep, flight });
    expect(s.controller_speech).toContain("cleared to Troutdale airport");
    expect(s.expected).toContainEqual({ key: "limit", kind: "place", label: "Clearance limit", value: "KTTD", accept: ["troutdale"] });
  });

  test("snapshot warnings come first; provenance is copied", () => {
    const flight = { ...dep.flight, warnings: ["Flight data unavailable — using a made-up callsign"] };
    const s = build("takeoff", SEED, TEST_KTTD, { ...dep, flight });
    expect(s.warnings[0]).toBe("Flight data unavailable — using a made-up callsign");
    expect(s.provenance).toEqual({ weather: dep.weather.provenance, airport: dep.airport.provenance, flight: flight.provenance });
  });
});

describe("shipped airports.json (approaches still TODO)", () => {
  test.each(["ifr_clearance", "takeoff", "departure"] as const)("KTTD %s builds", (type) => {
    expect(Scenario.parse(build(type, SEED, AIRPORTS.KTTD))).toBeTruthy();
  });

  test.each(["approach_vectors", "approach_clearance"] as const)("KTTD %s → 422 naming approaches", (type) => {
    expect(() => build(type, SEED, AIRPORTS.KTTD)).toThrow(`KTTD needs approaches in airports.json for ${type}`);
  });
});
