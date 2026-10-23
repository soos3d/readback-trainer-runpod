import "server-only";
// AviationWeather.gov METAR and airport info, with cached and standard fallbacks (SPEC §8.1, §8.4).
import { z } from "zod";
import { requireEnv } from "../env";
import { ApiError } from "../errors";
import { fetchWithRetry, isUpstreamError, readJson, simulatedOutage, withCache } from "../http";
import { AIRPORTS, isTodo, Runway, type Snapshot, type Weather } from "../schemas";

const BASE = "https://aviationweather.gov/api/data";
const MIN = 60_000;
const METAR_TTL = { freshMs: 5 * MIN, staleMs: 180 * MIN };
const AIRPORT_TTL = { freshMs: 24 * 60 * MIN, staleMs: 24 * 60 * MIN };
const HPA_TO_INHG = 0.02953;

export type SourceOpts = { simulateDown?: boolean; now?: () => number };

const AwcMetar = z
  .array(
    z.object({
      rawOb: z.string(),
      obsTime: z.number(),
      wdir: z.union([z.number(), z.literal("VRB")]),
      wspd: z.number(),
      wgst: z.number().optional(), // absent when there is no gust
      altim: z.number(), // hPa
    }),
  )
  .min(1);

const AwcAirport = z
  .array(
    z.object({
      name: z.string(),
      magdec: z.string().regex(/^\d{1,3}[EW]?$/),
      freqs: z.string().nullish(),
      runways: z.array(z.object({ id: z.string(), alignment: z.number() })),
    }),
  )
  .min(1);

async function getAwc(path: string, icao: string): Promise<unknown> {
  const url = `${BASE}/${path}?${new URLSearchParams({ ids: icao, format: "json" })}`;
  const headers = { "User-Agent": requireEnv("AWC_USER_AGENT") };
  const res = await fetchWithRetry(url, { headers }, "aviationweather");
  return readJson(res, "aviationweather");
}

function toWeather(m: z.infer<typeof AwcMetar>[number]): Weather {
  const a = /\bA(\d{4})\b/.exec(m.rawOb);
  const altimeter = a ? Number(a[1]) / 100 : Math.round(m.altim * HPA_TO_INHG * 100) / 100;
  const calm = m.wdir === 0 && m.wspd === 0;
  return {
    wind_dir_true: calm ? null : m.wdir,
    wind_kt: m.wspd,
    gust_kt: m.wgst ?? null,
    altimeter_inhg: altimeter,
    metar_raw: m.rawOb,
    obs_time: m.obsTime,
  };
}

const STANDARD_WEATHER: Weather = {
  wind_dir_true: null, wind_kt: 0, gust_kt: null, altimeter_inhg: 29.92, metar_raw: null, obs_time: null,
};

export async function getWeather(icao: string, opts: SourceOpts = {}): Promise<Snapshot["weather"]> {
  const now = (opts.now ?? Date.now)();
  const load = opts.simulateDown
    ? () => simulatedOutage("aviationweather")
    : async () => toWeather(AwcMetar.parse(await getAwc("metar", icao))[0]);
  try {
    const r = await withCache(`awc:metar:${icao}`, { ...METAR_TTL, now }, load);
    if (r.fresh) return { data: r.value, provenance: { source: "live" }, warnings: [] };
    const age_min = Math.round(r.age_ms / MIN);
    return {
      data: r.value,
      provenance: { source: "cached", age_min },
      warnings: [`Live weather unavailable — using weather from ${age_min} min ago`],
    };
  } catch (err) {
    if (!isUpstreamError(err)) throw err;
    return {
      data: STANDARD_WEATHER,
      provenance: { source: "synthetic" },
      warnings: ["Live weather unavailable — using standard weather"],
    };
  }
}

// "16E" → 16, "06W" → -6.
const parseMagdec = (s: string) => (s.endsWith("W") ? -1 : 1) * parseInt(s, 10);

// "LCL/P,120.9;ATIS,135.625" → tower "120.9".
function towerFreq(freqs: string | null | undefined): string | null {
  const pairs = (freqs ?? "").split(";").map((p) => p.split(","));
  return pairs.find(([kind]) => kind === "LCL/P")?.[1]?.trim() || null;
}

async function loadAirport(icao: string): Promise<Snapshot["airport"]["data"]> {
  const a = AwcAirport.parse(await getAwc("airport", icao))[0];
  // Helipads and other ids that are not runway pairs are dropped.
  const runways = a.runways
    .map(({ id, alignment }) => ({ id, alignment }))
    .filter((r) => Runway.safeParse(r).success);
  if (runways.length === 0) {
    throw new ApiError(502, "upstream_failed", `aviationweather lists no runways for ${icao}`, "aviationweather");
  }
  return { name: a.name.trim(), magdec_east_deg: parseMagdec(a.magdec), runways, tower_freq: towerFreq(a.freqs) };
}

export async function getAirportInfo(icao: string, opts: SourceOpts = {}): Promise<Snapshot["airport"]> {
  const config = AIRPORTS[icao];
  if (!config) throw new Error(`${icao} is not in airports.json`);
  const now = (opts.now ?? Date.now)();
  const load = opts.simulateDown ? () => simulatedOutage("aviationweather") : () => loadAirport(icao);
  try {
    const r = await withCache(`awc:airport:${icao}`, { ...AIRPORT_TTL, now }, load);
    if (r.fresh) return { data: r.value, provenance: { source: "live" }, warnings: [] };
    return {
      data: r.value,
      provenance: { source: "cached" },
      warnings: [`Live airport info unavailable — using airport info from ${Math.round(r.age_ms / MIN)} min ago`],
    };
  } catch (err) {
    if (!isUpstreamError(err)) throw err;
    const tower = config.tower_fallback_freq;
    return {
      // magdec is not in airports.json; 0 is made up and the warning says so.
      data: { name: icao, magdec_east_deg: 0, runways: config.runways_fallback, tower_freq: isTodo(tower) ? null : tower },
      provenance: { source: "synthetic" },
      warnings: ["Live airport info unavailable — using stored runways; magnetic variation set to 0 (made up)"],
    };
  }
}
