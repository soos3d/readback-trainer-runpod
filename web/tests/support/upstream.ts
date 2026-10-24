// Offline stand-ins for AviationWeather.gov and OpenSky: real responses recorded by
// scripts/record-fixtures.ts, served by URL. Any other URL throws, so no test reaches the network.
import { vi } from "vitest";
import kttdMetar from "../fixtures/KTTD-metar.json";
import korlMetar from "../fixtures/KORL-metar.json";
import kttdAirport from "../fixtures/KTTD-airport.json";
import korlAirport from "../fixtures/KORL-airport.json";
import kttdDepartures from "../fixtures/KTTD-departures.json";
import kttdArrivals from "../fixtures/KTTD-arrivals.json";
import korlDepartures from "../fixtures/KORL-departures.json";
import kvgtDepartures from "../fixtures/KVGT-departures.json";
import token from "../fixtures/opensky-token.json";

export const NOW = Date.UTC(2026, 9, 23, 16, 0); // fixtures recorded 2026-10-23 ~16:00Z
export const AWC_USER_AGENT = "readback-trainer-test";

const FIXTURES: Record<string, unknown> = {
  "metar?ids=KTTD": kttdMetar, "metar?ids=KORL": korlMetar,
  "airport?ids=KTTD": kttdAirport, "airport?ids=KORL": korlAirport,
  "departure?airport=KTTD": kttdDepartures, "arrival?airport=KTTD": kttdArrivals,
  "departure?airport=KORL": korlDepartures, "departure?airport=KVGT": kvgtDepartures,
};

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export function stubUpstreamEnv(): void {
  vi.stubEnv("AWC_USER_AGENT", AWC_USER_AGENT);
  vi.stubEnv("OPENSKY_CLIENT_ID", "id");
  vi.stubEnv("OPENSKY_CLIENT_SECRET", "secret");
}

/** Stubs global fetch with the fixtures; `override` answers first when it returns a Response. */
export function stubFetch(override: (url: string) => Response | Promise<Response> | undefined = () => undefined) {
  const fetch = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    const custom = await override(url);
    if (custom) return custom;
    if (url.includes("/token")) return json({ ...token, access_token: "tok" });
    const hit = Object.entries(FIXTURES).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return json(hit[1]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
