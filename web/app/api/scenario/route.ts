import { randomInt } from "node:crypto";
import { readJson, route } from "@/lib/route";
import { buildScenario } from "@/lib/scenarios";
import { AIRPORTS, ScenarioRequest } from "@/lib/schemas";
import { getAirportInfo, getWeather } from "@/lib/sources/aviationweather";
import { getFlight } from "@/lib/sources/opensky";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route("/api/scenario", async (req) => {
  const { airport: icao, type, seed = randomInt(1_000_000), simulate = [] } = ScenarioRequest.parse(await readJson(req));
  const demo = process.env.READBACK_DEMO_MODE === "1";
  const awcDown = demo && simulate.includes("awc_down");
  const direction = type.startsWith("approach") ? "arrival" : "departure";

  const [weather, airport, flight] = await Promise.all([
    getWeather(icao, { simulateDown: awcDown }),
    getAirportInfo(icao, { simulateDown: awcDown }),
    getFlight(icao, direction, { simulateDown: demo && simulate.includes("opensky_down"), seed }),
  ]);
  const snapshot = { weather, airport, flight };
  const scenario = buildScenario({ icao, type, seed, config: AIRPORTS[icao], snapshot });

  const parts = Object.values(snapshot);
  return {
    body: scenario,
    // An OpenSky 401 (config error) lands here as a synthetic flight; log() has no message field.
    fallback: parts.some((p) => p.warnings.length > 0),
    cache: parts.some((p) => p.provenance.source === "cached") ? "stale" : undefined,
  };
});
