import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { buildScenario } from "@/lib/scenarios";
import { grade } from "@/lib/grader";
import { endHeading } from "@/lib/runway";
import { ApiError } from "@/lib/errors";
import { AIRPORTS, CallType, Scenario, type AirportConfig, type Snapshot } from "@/lib/schemas";
import { getAirportInfo, getWeather } from "@/lib/sources/aviationweather";
import { getFlight } from "@/lib/sources/opensky";
import { NOW, stubFetch, stubUpstreamEnv } from "./support/upstream";

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

let dep: Snapshot; // departure flight: ifr_clearance, takeoff, departure
let arr: Snapshot; // arrival flight: approach_vectors, approach_clearance
let windy: Snapshot["weather"];
beforeAll(async () => {
  stubUpstreamEnv();
  stubFetch();
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

describe("golden output (fixtures, seed 48213)", () => {
  test("the exact controller call for each call type", () => {
    expect(Object.fromEntries(TYPES.map((type) => [type, build(type).controller_text]))).toMatchInlineSnapshot(`
      {
        "approach_clearance": "N01H, 6 miles from the final approach fix, turn right heading 270, maintain 2,000 until established on the localizer, cleared ILS runway 25 approach. Contact Troutdale tower 120.9.",
        "approach_vectors": "N01H, Troutdale altimeter 30.28. Descend and maintain 4,000, fly heading 220, vectors ILS runway 25.",
        "departure": "N91055, Test Departure, radar contact. Climb and maintain 4,000, turn right heading 280.",
        "ifr_clearance": "N91055, cleared to KSLE airport via radar vectors, then as filed. Climb and maintain 3,000, expect 8,000 10 minutes after departure. Departure frequency 119.4, squawk 0770.",
        "takeoff": "N055, turn left heading 220, wind calm, runway 25, cleared for takeoff.",
      }
    `);
  });

  test("every call type builds a schema-valid scenario, and the same seed gives the same scenario", () => {
    for (const type of TYPES) {
      const s = build(type);
      expect(Scenario.parse(s)).toEqual(s);
      expect(build(type)).toEqual(s);
    }
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

describe("invariants over seeds 0–999", () => {
  const REJECT = ["0000", "1200", "7500", "7600", "7700", "7777"];
  test("legal squawks, headings on the 10° grid, takeoff turns ≤ 90°, digit-free speech", () => {
    for (const type of TYPES) {
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
    }
  });
});

describe("airport config rules (TODO fields, fallbacks, warnings)", () => {
  const todo: AirportConfig = {
    ...TEST_KTTD,
    tower_fallback_freq: "TODO",
    calm_wind_runway: "TODO",
    approaches: "TODO",
    nearby_destinations: "TODO",
    min_vector_altitude: "TODO",
    max_assign_altitude: "TODO",
  };

  test("takeoff needs no optional field: AWC tower freq, generic tower name, calm-wind warning", () => {
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

describe("shipped airports.json", () => {
  test("KTTD builds every call type", () => {
    for (const type of TYPES) expect(Scenario.parse(build(type, SEED, AIRPORTS.KTTD))).toBeTruthy();
  });
});

describe("circling approaches (KTTD RNAV (GPS)-A, seed 48213)", () => {
  const kttd = (type: CallType, seed = SEED) => build(type, seed, AIRPORTS.KTTD);
  const item = (type: CallType, key: string) => kttd(type).expected.find((i) => i.key === key);

  test("approach_vectors: name with letter, circle to the runway in use, no runway after the name", () => {
    const s = kttd("approach_vectors");
    expect(s.controller_text).toContain("vectors RNAV (GPS)-A approach, circle to runway 25.");
    expect(s.controller_speech).toContain("vectors RNAV GPS alpha approach, circle to runway two five.");
    expect(item("approach_vectors", "approach")?.accept).toEqual(["RNAV GPS A", "RNAV A"]);
    expect(item("approach_vectors", "runway")?.value).toBe("25");
  });

  test("approach_clearance: cleared by name, circle to runway, final approach course, tower 120.9", () => {
    const s = kttd("approach_clearance");
    expect(s.controller_text).toContain("until established on the final approach course, cleared RNAV (GPS)-A approach, circle to runway 25.");
    expect(s.controller_speech).toContain("cleared RNAV GPS alpha approach, circle to runway two five.");
    expect(s.controller_text).toMatch(/Contact Troutdale tower 120\.9\.$/);
    expect(item("approach_clearance", "clearance")).toMatchObject({ value: "cleared RNAV (GPS)-A approach" });
    expect(item("approach_clearance", "runway")?.value).toBe("25");
  });

  test.each([
    ["approach_vectors", "altimeter 30.28, descend 4000, heading 220, vectors RNAV Alpha approach, circle runway 25, zero one hotel"],
    ["approach_clearance", "right heading 270, maintain 2000 until established, cleared for the RNAV A, circle to runway two five, tower 120.9, zero one hotel"],
  ] as const)("%s: correct readback scores full (%s)", (type, readback) => {
    expect(grade(kttd(type), readback)).toMatchObject({ verdict: "readback_correct", score: 1 });
  });

  test("a readback without the approach name misses that item", () => {
    const r = grade(kttd("approach_clearance"), "right heading 270, maintain 2000 until established, cleared approach, circle runway 25, tower 120.9, zero one hotel");
    expect(r.items.find((i) => i.key === "clearance")?.status).toBe("missing");
    expect(r.verdict).toBe("readback_incomplete");
    const rnavOnly = grade(kttd("approach_clearance"), "cleared RNAV approach");
    expect(rnavOnly.items.find((i) => i.key === "clearance")?.status).toBe("missing");
  });

  test("seeds 0–199: always circling, runway from wind or calm-wind runway", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const type of ["approach_vectors", "approach_clearance"] as const) {
        const s = kttd(type, seed);
        expect(s.controller_text).toContain("RNAV (GPS)-A approach, circle to runway 25");
        expect(s.controller_speech).not.toMatch(/\d/);
      }
    }
  });

  test("a straight-in approach for the runway in use wins over circling", () => {
    const mixed = { ...TEST_KTTD, approaches: { "25": ["ILS"], circling: ["VOR-A"] } };
    expect(build("approach_clearance", SEED, mixed).controller_text).toContain("cleared ILS runway 25 approach.");
  });

  test("circling is used when no straight-in approach serves the runway in use", () => {
    const mixed = { ...TEST_KTTD, approaches: { "07": ["ILS"], circling: ["VOR-A"] } };
    const s = build("approach_vectors", SEED, mixed);
    expect(s.controller_text).toContain("vectors VOR-A approach, circle to runway 25.");
    expect(s.controller_speech).toContain("vectors VOR alpha approach, circle to runway two five.");
  });
});
