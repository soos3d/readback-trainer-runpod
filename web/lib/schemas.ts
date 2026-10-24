// Shared zod schemas (SPEC §12.3), the airports.json schema (§8.3) and the Snapshot type.
import { z } from "zod";
import airportsJson from "./airports.json";

// --- Primitives ---------------------------------------------------------------

export const Todo = z.literal("TODO");
export const isTodo = (value: unknown): value is "TODO" => value === "TODO";
const orTodo = <T extends z.ZodType>(schema: T) => z.union([schema, Todo]);

const IcaoCode = z.string().regex(/^K[A-Z0-9]{3}$/);
const RUNWAY_END = "(0[1-9]|[12][0-9]|3[0-6])[LRC]?";
export const RunwayEnd = z.string().regex(new RegExp(`^${RUNWAY_END}$`));
const Freq = z.string().regex(/^1[1-3][0-9]\.[0-9]{1,3}$/);
const Altitude = z.number().int().positive();

// Strips control characters from untrusted strings (§12.3 input rules).
const cleanString = z.string().transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, ""));

// --- airports.json ------------------------------------------------------------

export const Runway = z.strictObject({
  id: z.string().regex(new RegExp(`^${RUNWAY_END}/${RUNWAY_END}$`)),
  alignment: z.number().min(0).max(360), // degrees true
});

const Facility = z.strictObject({ name: z.string().min(1), freq: orTodo(Freq) });

export const AirportConfig = z.strictObject({
  radio_name: z.string().min(1),
  clearance: Facility,
  tower_fallback_freq: orTodo(Freq),
  departure: Facility,
  approach: Facility,
  calm_wind_runway: orTodo(RunwayEnd),
  // Straight-in approaches by runway end; circling-only approaches (e.g. "RNAV (GPS)-A") under "circling".
  approaches: orTodo(z.record(z.union([RunwayEnd, z.literal("circling")]), z.array(z.string().min(1)).min(1))),
  nearby_destinations: orTodo(z.array(IcaoCode).min(1)),
  min_vector_altitude: orTodo(Altitude),
  max_assign_altitude: orTodo(Altitude),
  runways_fallback: z.array(Runway).min(1),
});

export const AirportsFile = z.record(IcaoCode, AirportConfig);

// Fails at import if airports.json is malformed.
export const AIRPORTS = AirportsFile.parse(airportsJson);

// --- §12.3 API types -----------------------------------------------------------

export const CallType = z.enum(["ifr_clearance", "takeoff", "departure", "approach_vectors", "approach_clearance"]);
export const Kind = z.enum([
  "callsign", "place", "route", "altitude", "heading", "frequency", "squawk", "altimeter", "runway", "phrase",
]);
export const Source = z.enum(["live", "cached", "opensky", "synthetic"]);

export const AirportSummary = z.strictObject({ icao: z.string(), radio_name: z.string(), name: z.string() });

export const ScenarioRequest = z.strictObject({
  airport: IcaoCode.refine((icao) => Object.hasOwn(AIRPORTS, icao), "Unknown airport"),
  type: CallType,
  seed: z.number().int().min(0).max(999_999).optional(),
  simulate: z.array(z.enum(["opensky_down", "awc_down"])).optional(),
});

export const ExpectedItem = z.strictObject({
  key: z.string(),
  kind: Kind,
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  accept: z.array(z.string()).optional(),
});

export const Scenario = z.strictObject({
  scenario_id: z.string(),
  seed: z.number().int(),
  type: CallType,
  airport: z.strictObject({ icao: z.string(), radio_name: z.string() }),
  facility: z.strictObject({ name: z.string(), freq: z.string() }),
  callsign: z.strictObject({ tail: z.string(), spoken: z.string(), abbrev: z.string() }),
  controller_text: z.string(),
  controller_speech: z.string(),
  expected: z.array(ExpectedItem),
  context: z.strictObject({ metar_raw: z.string().nullable(), runway: z.string(), altimeter: z.string() }),
  provenance: z.strictObject({
    weather: z.strictObject({ source: Source, age_min: z.number().optional() }),
    airport: z.strictObject({ source: Source }),
    flight: z.strictObject({ source: Source, date: z.string().optional() }),
  }),
  warnings: z.array(z.string()),
});

export const ItemStatus = z.enum(["correct", "incorrect", "missing"]);
export const GradeResult = z.strictObject({
  verdict: z.enum(["readback_correct", "readback_incorrect", "readback_incomplete"]),
  score: z.number().min(0).max(1),
  items: z.array(
    z.strictObject({
      key: z.string(),
      label: z.string(),
      expected: z.string(),
      heard: z.string().nullable(),
      status: ItemStatus,
    }),
  ),
  tips: z.array(z.string()),
});

export const SpeechAudio = z.strictObject({
  audio_wav_b64: z.string(),
  sample_rate: z.number().int().positive(),
  duration_s: z.number().nonnegative(),
});

// "internal" is our addition for unexpected server errors (DECISIONS.md, T03).
export const ErrorCode = z.enum([
  "payload_too_large", "invalid_input", "rate_limited", "speech_failed", "upstream_failed", "speech_warming", "internal",
]);
export const ErrorSource = z.enum(["web", "speech", "aviationweather", "opensky"]);
export const ApiErrorBody = z.strictObject({
  error: z.strictObject({ code: ErrorCode, message: z.string(), source: ErrorSource }),
});

// --- §12.1 request bodies -----------------------------------------------------

export const SpeakRequest = z.strictObject({ text: cleanString.pipe(z.string().regex(/^[\x20-\x7e]{1,600}$/)) });
export const GradeRequest = z.strictObject({ scenario: Scenario, transcript: cleanString.pipe(z.string().max(600)) });
export const AttemptRequest = z.strictObject({ scenario: Scenario, audio_wav_b64: z.string().min(1) });

export type CallType = z.infer<typeof CallType>;
export type Kind = z.infer<typeof Kind>;
export type Source = z.infer<typeof Source>;
export type Runway = z.infer<typeof Runway>;
export type AirportConfig = z.infer<typeof AirportConfig>;
export type AirportSummary = z.infer<typeof AirportSummary>;
export type ScenarioRequest = z.infer<typeof ScenarioRequest>;
export type ExpectedItem = z.infer<typeof ExpectedItem>;
export type Scenario = z.infer<typeof Scenario>;
export type ItemStatus = z.infer<typeof ItemStatus>;
export type GradeResult = z.infer<typeof GradeResult>;
export type SpeechAudio = z.infer<typeof SpeechAudio>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ErrorSource = z.infer<typeof ErrorSource>;
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// --- Snapshot: what sources (T08) hand to scenario builders (T09) --------------

type Provenance = Scenario["provenance"];

export type Sourced<T, P> = { data: T; provenance: P; warnings: string[] };

export type Weather = {
  wind_dir_true: number | "VRB" | null; // null when calm or missing
  wind_kt: number;
  gust_kt: number | null;
  altimeter_inhg: number;
  metar_raw: string | null;
  obs_time: number | null; // unix seconds, as AWC `obsTime`
};

export type AirportInfo = {
  name: string; // AWC name, trimmed
  magdec_east_deg: number; // west variation is negative
  runways: Runway[];
  tower_freq: string | null;
};

export type Flight = {
  tail: string; // N-number
  other_airport: string; // destination ICAO for departures, origin for arrivals
  date: string | null; // UTC YYYY-MM-DD of the real flight; null when synthetic
};

export type Snapshot = {
  weather: Sourced<Weather, Provenance["weather"]>;
  airport: Sourced<AirportInfo, Provenance["airport"]>;
  flight: Sourced<Flight, Provenance["flight"]>;
};
