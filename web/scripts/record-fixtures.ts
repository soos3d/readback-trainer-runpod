// Records real AWC and OpenSky responses into tests/fixtures/ so tests run offline.
// Usage (from web/): npx tsx scripts/record-fixtures.ts KTTD [KORL KVGT]
// Networked on purpose; never imported by app code. Reads web/.env.local.
import { mkdirSync, writeFileSync } from "node:fs";

process.loadEnvFile?.(".env.local");

const OUT = "tests/fixtures";
const AWC = "https://aviationweather.gov/api/data";
const OPENSKY = "https://opensky-network.org/api/flights";
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const GA_CALLSIGN = /^N[0-9][0-9A-Z]{0,4}$/;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; see web/.env.example`);
  return value;
}

function save(file: string, data: unknown): void {
  writeFileSync(`${OUT}/${file}`, JSON.stringify(data, null, 2) + "\n");
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers });
  const remaining = res.headers.get("x-rate-limit-remaining");
  console.log(`${res.status} ${url}${remaining ? ` (credits left ${remaining})` : ""}`);
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env("OPENSKY_CLIENT_ID"),
    client_secret: env("OPENSKY_CLIENT_SECRET"),
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  console.log(`${res.status} token`);
  if (!res.ok) throw new Error(`token request failed with ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string") throw new Error("token response has no access_token");
  // Shape sample only: token values never touch disk.
  const redacted = Object.fromEntries(
    Object.entries(json).map(([k, v]) => [k, k.endsWith("_token") ? "<redacted>" : v]),
  );
  save("opensky-token.json", redacted);
  return json.access_token;
}

type Flight = { callsign?: string | null; estArrivalAirport?: string | null };

function gaDepartures(icao: string, flights: unknown): Flight[] {
  if (!Array.isArray(flights)) return [];
  return (flights as Flight[]).filter((f) => {
    const arr = f.estArrivalAirport;
    return GA_CALLSIGN.test((f.callsign ?? "").trim()) && !!arr && arr !== icao && arr.startsWith("K");
  });
}

async function recordAwc(icao: string): Promise<void> {
  const awc = { "User-Agent": env("AWC_USER_AGENT") };
  save(`${icao}-metar.json`, await getJson(`${AWC}/metar?ids=${icao}&format=json`, awc));
  save(`${icao}-airport.json`, await getJson(`${AWC}/airport?ids=${icao}&format=json`, awc));
}

async function recordFlights(icao: string, token: string, begin: number, end: number): Promise<void> {
  const auth = { Authorization: `Bearer ${token}` };
  const window = `airport=${icao}&begin=${begin}&end=${end}`;
  const departures = await getJson(`${OPENSKY}/departure?${window}`, auth);
  const arrivals = await getJson(`${OPENSKY}/arrival?${window}`, auth);
  save(`${icao}-departures.json`, departures);
  save(`${icao}-arrivals.json`, arrivals);
  const ga = gaDepartures(icao, departures);
  const count = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  console.log(
    `${icao}: ${count(departures)} departures (${ga.length} GA to K airports), ${count(arrivals)} arrivals`,
  );
}

const icaos = process.argv.slice(2).map((s) => s.toUpperCase());
if (icaos.length === 0 || !icaos.every((s) => /^K[A-Z0-9]{3}$/.test(s))) {
  throw new Error("usage: npx tsx scripts/record-fixtures.ts KTTD [KORL ...]");
}
const end = Math.floor(Date.now() / 86_400_000) * 86_400; // today 00:00 UTC
const begin = end - 86_400; // previous UTC day
console.log(`window ${new Date(begin * 1000).toISOString()} .. ${new Date(end * 1000).toISOString()}`);
mkdirSync(OUT, { recursive: true });
for (const icao of icaos) await recordAwc(icao); // AWC first: no key needed
const token = await fetchToken();
for (const icao of icaos) await recordFlights(icao, token, begin, end);
