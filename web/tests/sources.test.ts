import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import kttdMetar from "./fixtures/KTTD-metar.json";
import korlMetar from "./fixtures/KORL-metar.json";
import kttdDepartures from "./fixtures/KTTD-departures.json";
import airportsJson from "@/lib/airports.json";
import { AWC_USER_AGENT, json, NOW, stubFetch, stubUpstreamEnv } from "./support/upstream";

const MIN = 60_000;
const GA = /^N[0-9][0-9A-Z]{0,4}$/;
const NEARBY: readonly string[] = airportsJson.KTTD.nearby_destinations;

let awc: typeof import("@/lib/sources/aviationweather");
let opensky: typeof import("@/lib/sources/opensky");
beforeEach(async () => {
  vi.resetModules(); // empties the cache and the OpenSky token
  vi.useFakeTimers();
  stubUpstreamEnv();
  awc = await import("@/lib/sources/aviationweather");
  opensky = await import("@/lib/sources/opensky");
});
afterEach(() => {
  vi.doUnmock("@/lib/schemas");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("getWeather", () => {
  test("live calm METAR: wind 0, altimeter from rawOb, User-Agent sent", async () => {
    const fetch = stubFetch();
    const w = await awc.getWeather("KTTD", { now: () => NOW });
    expect(w).toEqual({
      data: {
        wind_dir_true: null, wind_kt: 0, gust_kt: null, altimeter_inhg: 30.28,
        metar_raw: kttdMetar[0].rawOb, obs_time: kttdMetar[0].obsTime,
      },
      provenance: { source: "live" },
      warnings: [],
    });
    const init = fetch.mock.calls[0][1];
    expect(new Headers(init?.headers).get("User-Agent")).toBe(AWC_USER_AGENT);
  });

  test("wind without gust; gust and VRB parsed; altim hPa fallback", async () => {
    stubFetch();
    expect((await awc.getWeather("KORL", { now: () => NOW })).data).toMatchObject({
      wind_dir_true: 20, wind_kt: 13, gust_kt: null, altimeter_inhg: 30.09,
    });
    const gusty = [{ ...korlMetar[0], wdir: "VRB", wgst: 22, altim: 1013.2, rawOb: "METAR KXXX 231553Z VRB13G22KT" }];
    stubFetch(() => json(gusty));
    const later = NOW + 10 * MIN;
    expect((await awc.getWeather("KORL", { now: () => later })).data).toMatchObject({
      wind_dir_true: "VRB", gust_kt: 22, altimeter_inhg: 29.92,
    });
  });

  test("timeout with a 40-min-old cache gives cached, age_min 40", async () => {
    stubFetch();
    await awc.getWeather("KTTD", { now: () => NOW });
    const fetch = stubFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    const w = await settle(awc.getWeather("KTTD", { now: () => NOW + 40 * MIN }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(w.provenance).toEqual({ source: "cached", age_min: 40 });
    expect(w.data.altimeter_inhg).toBe(30.28);
    expect(w.warnings).toEqual(["Live weather unavailable — using weather from 40 min ago"]);
  });

  test("AWC 204 gives standard weather 29.92", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    const w = await awc.getWeather("KTTD", { now: () => NOW });
    expect(w).toEqual({
      data: { wind_dir_true: null, wind_kt: 0, gust_kt: null, altimeter_inhg: 29.92, metar_raw: null, obs_time: null },
      provenance: { source: "synthetic" },
      warnings: ["Live weather unavailable — using standard weather"],
    });
  });

  test("simulateDown acts like a 503 without calling AWC", async () => {
    const fetch = stubFetch();
    const w = await awc.getWeather("KTTD", { now: () => NOW, simulateDown: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(w.provenance).toEqual({ source: "synthetic" });
  });
});

describe("getAirportInfo", () => {
  test("parses name, magdec E, runways, tower LCL/P", async () => {
    stubFetch();
    expect(await awc.getAirportInfo("KTTD", { now: () => NOW })).toEqual({
      data: {
        name: "PORTLAND/PORTLAND-TROUTDALE", magdec_east_deg: 16,
        runways: [{ id: "07/25", alignment: 89 }], tower_freq: "120.9",
      },
      provenance: { source: "live" },
      warnings: [],
    });
  });

  test("magdec 06W is -6", async () => {
    stubFetch();
    const a = await awc.getAirportInfo("KORL", { now: () => NOW });
    expect(a.data).toMatchObject({ magdec_east_deg: -6, tower_freq: "118.7" });
    expect(a.data.runways).toHaveLength(2);
  });

  test("outage falls back to airports.json runways, labeled made up", async () => {
    stubFetch(() => json([], 500));
    const a = await settle(awc.getAirportInfo("KORL", { now: () => NOW }));
    expect(a).toEqual({
      data: {
        name: "KORL", magdec_east_deg: 0, tower_freq: "118.7",
        runways: [{ id: "07/25", alignment: 67 }, { id: "13/31", alignment: 131 }],
      },
      provenance: { source: "synthetic" },
      warnings: ["Live airport info unavailable — using stored runways; magnetic variation set to 0 (made up)"],
    });
  });
});

describe("getFlight", () => {
  test("picks a GA departure to another K airport, same pick for the same seed", async () => {
    stubFetch();
    const f = await opensky.getFlight("KTTD", "departure", { now: () => NOW, seed: 7 });
    expect(f.data.tail).toMatch(GA);
    expect(f.data.other_airport).toMatch(/^K/);
    expect(f.data.other_airport).not.toBe("KTTD");
    expect(f.data.date).toBe("2026-10-22");
    expect(f.provenance).toEqual({ source: "opensky", date: "2026-10-22" });
    expect(f.warnings).toEqual([]);
    const tails = kttdDepartures.map((d) => d.callsign?.trim());
    expect(tails).toContain(f.data.tail);
    expect(await opensky.getFlight("KTTD", "departure", { now: () => NOW, seed: 7 })).toEqual(f);
  });

  test("token fetched once for two calls, refetched 60 s before expiry", async () => {
    const fetch = stubFetch();
    const tokenCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes("/token")).length;
    await opensky.getFlight("KTTD", "departure", { now: () => NOW });
    await opensky.getFlight("KTTD", "arrival", { now: () => NOW });
    expect(tokenCalls()).toBe(1);
    await opensky.getFlight("KORL", "departure", { now: () => NOW + (1800 - 61) * 1000 });
    expect(tokenCalls()).toBe(1);
    await opensky.getFlight("KVGT", "departure", { now: () => NOW + (1800 - 60) * 1000 });
    expect(tokenCalls()).toBe(2);
  });

  test("OpenSky 429 gives a synthetic flight and says what was made up", async () => {
    stubFetch((url) => (url.includes("/flights/") ? json({}, 429) : undefined));
    const f = await settle(opensky.getFlight("KTTD", "departure", { now: () => NOW, seed: 3 }));
    expect(f.data.tail).toMatch(GA);
    expect(f.data.date).toBeNull();
    expect(NEARBY).toContain(f.data.other_airport);
    expect(f.provenance).toEqual({ source: "synthetic" });
    expect(f.warnings).toEqual(["Flight data unavailable — using a made-up callsign"]);
    const again = await settle(opensky.getFlight("KTTD", "departure", { now: () => NOW, seed: 3 }));
    expect(again).toEqual(f);
  });

  test("opensky_down + stale cache gives cached + a warning with the flight date", async () => {
    stubFetch();
    const live = await opensky.getFlight("KTTD", "departure", { now: () => NOW, seed: 7 });
    const f = await opensky.getFlight("KTTD", "departure", { now: () => NOW + MIN, seed: 7, simulateDown: true });
    expect(f.data).toEqual(live.data);
    expect(f.provenance).toEqual({ source: "cached", date: "2026-10-22" });
    expect(f.warnings).toEqual(["Live flight data unavailable — using a cached flight from 2026-10-22"]);
  });

  test("404 (no flights) gives the no-GA warning", async () => {
    stubFetch((url) => (url.includes("/flights/") ? new Response(null, { status: 404 }) : undefined));
    const f = await opensky.getFlight("KTTD", "arrival", { now: () => NOW });
    expect(NEARBY).toContain(f.data.other_airport);
    expect(f.warnings).toEqual(["No GA flights found yesterday — made-up callsign"]);
  });

  test("nearby_destinations TODO: synthetic flight uses the airport itself and says so", async () => {
    vi.doMock("@/lib/schemas", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/schemas")>();
      const KTTD = { ...real.AIRPORTS.KTTD, nearby_destinations: "TODO" as const };
      return { ...real, AIRPORTS: { ...real.AIRPORTS, KTTD } };
    });
    vi.resetModules();
    opensky = await import("@/lib/sources/opensky");
    stubFetch((url) => (url.includes("/flights/") ? new Response(null, { status: 404 }) : undefined));
    for (const [direction, role] of [["departure", "destination"], ["arrival", "origin"]] as const) {
      const f = await opensky.getFlight("KTTD", direction, { now: () => NOW });
      expect(f.data.other_airport).toBe("KTTD");
      expect(f.warnings).toEqual([
        "No GA flights found yesterday — made-up callsign",
        `No nearby airports set for KTTD — using KTTD itself as the ${role}`,
      ]);
    }
  });

  test("token 401 falls back to synthetic", async () => {
    stubFetch((url) => (url.includes("/token") ? json({ error: "unauthorized_client" }, 401) : undefined));
    const f = await opensky.getFlight("KTTD", "departure", { now: () => NOW });
    expect(f.provenance).toEqual({ source: "synthetic" });
    expect(f.warnings[0]).toBe("Flight data unavailable — using a made-up callsign");
  });

  test("simulateDown acts like a 503 without calling OpenSky", async () => {
    const fetch = stubFetch();
    const f = await opensky.getFlight("KTTD", "departure", { now: () => NOW, simulateDown: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(f.provenance).toEqual({ source: "synthetic" });
  });

  test("missing credentials fail fast instead of falling back", async () => {
    stubFetch();
    vi.stubEnv("OPENSKY_CLIENT_SECRET", "");
    await expect(opensky.getFlight("KTTD", "departure", { now: () => NOW })).rejects.toThrow(
      "OPENSKY_CLIENT_SECRET is not set",
    );
  });
});
