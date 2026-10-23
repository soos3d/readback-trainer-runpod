import "server-only";
// OpenSky: yesterday's real GA flight for an airport, else a seeded made-up one (SPEC §8.2, §8.4).
import { z } from "zod";
import { requireEnv } from "../env";
import { fetchWithRetry, isUpstreamError, readJson, simulatedOutage, withCache } from "../http";
import { mulberry32 } from "../prng";
import { AIRPORTS, isTodo, type Flight, type Snapshot } from "../schemas";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const FLIGHTS_URL = "https://opensky-network.org/api/flights";
const DAY_MS = 86_400_000;
const FLIGHT_TTL = { freshMs: 6 * 3_600_000, staleMs: 6 * 3_600_000 };
const TOKEN_MARGIN_MS = 60_000;
const GA_CALLSIGN = /^N[0-9][0-9A-Z]{0,4}$/;
const TAIL_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // N-numbers never use I or O

export type Direction = "departure" | "arrival";
export type FlightOpts = { simulateDown?: boolean; now?: () => number; seed?: number };
type Candidate = { tail: string; other_airport: string };

const TokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
const OpenSkyFlights = z.array(
  z.object({
    callsign: z.string().nullish(),
    estDepartureAirport: z.string().nullish(),
    estArrivalAirport: z.string().nullish(),
  }),
);

let token: { value: string; expires_at: number } | null = null;

async function getToken(now: number): Promise<string> {
  if (token && now < token.expires_at - TOKEN_MARGIN_MS) return token.value;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: requireEnv("OPENSKY_CLIENT_ID"),
    client_secret: requireEnv("OPENSKY_CLIENT_SECRET"),
  });
  const res = await fetchWithRetry(TOKEN_URL, { method: "POST", body }, "opensky");
  const t = TokenResponse.parse(await readJson(res, "opensky"));
  token = { value: t.access_token, expires_at: now + t.expires_in * 1000 };
  return token.value;
}

// GA callsign, and the other end is a different K airport.
function gaCandidates(icao: string, direction: Direction, raw: unknown): Candidate[] {
  return OpenSkyFlights.parse(raw).flatMap((f) => {
    const tail = (f.callsign ?? "").trim();
    const other = (direction === "departure" ? f.estArrivalAirport : f.estDepartureAirport) ?? "";
    const ok = GA_CALLSIGN.test(tail) && other.startsWith("K") && other !== icao;
    return ok ? [{ tail, other_airport: other }] : [];
  });
}

async function loadCandidates(icao: string, direction: Direction, now: number, begin: number): Promise<Candidate[]> {
  const params = new URLSearchParams({ airport: icao, begin: String(begin), end: String(begin + DAY_MS / 1000) });
  const headers = { Authorization: `Bearer ${await getToken(now)}` };
  const res = await fetchWithRetry(`${FLIGHTS_URL}/${direction}?${params}`, { headers }, "opensky");
  return gaCandidates(icao, direction, await readJson(res, "opensky"));
}

const pick = <T>(items: readonly T[], rand: () => number): T => items[Math.floor(rand() * items.length)];

function syntheticTail(rand: () => number): string {
  const digit = () => String(Math.floor(rand() * 10));
  const letter = () => pick([...TAIL_LETTERS], rand);
  return `N${1 + Math.floor(rand() * 9)}${digit()}${digit()}${letter()}${letter()}`;
}

function synthetic(icao: string, direction: Direction, seed: number, reason: string): Snapshot["flight"] {
  const rand = mulberry32(seed);
  const tail = syntheticTail(rand);
  const nearby = AIRPORTS[icao]?.nearby_destinations ?? "TODO";
  const role = direction === "departure" ? "destination" : "origin";
  // No configured neighbours: use the airport itself (a local IFR round trip) instead of inventing one.
  const other = isTodo(nearby) ? icao : pick(nearby, rand);
  const todoNote = `No nearby airports set for ${icao} — using ${icao} itself as the ${role}`;
  const warnings = isTodo(nearby) ? [reason, todoNote] : [reason];
  const data: Flight = { tail, other_airport: other, date: null };
  return { data, provenance: { source: "synthetic" }, warnings };
}

export async function getFlight(icao: string, direction: Direction, opts: FlightOpts = {}): Promise<Snapshot["flight"]> {
  const now = (opts.now ?? Date.now)();
  const seed = opts.seed ?? 0;
  const begin = (Math.floor(now / DAY_MS) - 1) * (DAY_MS / 1000); // previous UTC day, unix s
  const date = new Date(begin * 1000).toISOString().slice(0, 10);
  const load = opts.simulateDown
    ? () => simulatedOutage("opensky")
    : () => loadCandidates(icao, direction, now, begin);
  try {
    const r = await withCache(`opensky:${icao}:${direction}:${date}`, { ...FLIGHT_TTL, now }, load);
    if (r.value.length === 0) {
      return synthetic(icao, direction, seed, "No GA flights found yesterday — made-up callsign");
    }
    const f = pick(r.value, mulberry32(seed));
    return {
      data: { ...f, date },
      provenance: { source: r.fresh ? "opensky" : "cached", date },
      warnings: [],
    };
  } catch (err) {
    if (!isUpstreamError(err)) throw err;
    return synthetic(icao, direction, seed, "Flight data unavailable — using a made-up callsign");
  }
}
