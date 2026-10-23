// Scenario builder (SPEC §9): airport config + Snapshot + seed → Scenario. Pure; imports neither Next nor Runpod.
// Rules for "TODO" fields in airports.json are listed in DECISIONS.md (T09); each fallback adds a warning.
import { ApiError } from "./errors";
import { abbreviatedCallsign, callsign, spell, wind } from "./phraseology";
import { mulberry32 } from "./prng";
import { runwayInUse } from "./runway";
import { TEMPLATES, type Ctx, type Filled } from "./scenarioTemplates";
import { isTodo, type AirportConfig, type CallType, type Scenario, type Snapshot } from "./schemas";

export type BuildInput = { icao: string; type: CallType; seed: number; config: AirportConfig; snapshot: Snapshot };

const CALM_MAX_KT = 3; // same threshold as lib/runway.ts

function makeCtx({ icao, type, seed, config, snapshot }: BuildInput, warn: (line: string) => void): Ctx {
  const { weather, airport, flight } = snapshot;
  const w = weather.data;

  const need = <K extends keyof AirportConfig>(...fields: K[]): Filled<K> => {
    const missing = fields.filter((f) => isTodo(config[f]));
    if (missing.length > 0) {
      throw new ApiError(422, "invalid_input", `${icao} needs ${missing.join(", ")} in airports.json for ${type}`, "web");
    }
    return config as unknown as Filled<K>; // every listed field was just checked not to be "TODO"
  };

  const runway: Ctx["runway"] = (allowedEnds) => {
    const runways = airport.data.runways;
    const ends = runways.flatMap((r) => r.id.split("/"));
    if (allowedEnds && !allowedEnds.some((e) => ends.includes(e))) {
      throw new ApiError(422, "invalid_input", `${icao} approaches in airports.json list no runway end that aviationweather reports`, "web");
    }
    const calmTodo = isTodo(config.calm_wind_runway);
    const end = runwayInUse({
      windDirTrue: w.wind_dir_true ?? "VRB",
      windKt: w.wind_kt,
      runways,
      calmRunway: calmTodo ? ends[0] : config.calm_wind_runway,
      allowedEnds,
    });
    const calm = w.wind_dir_true === null || w.wind_dir_true === "VRB" || w.wind_kt <= CALM_MAX_KT;
    if (calm && calmTodo) warn(`Calm-wind runway not set — using runway ${end}`);
    return end;
  };

  const magneticWind: Ctx["wind"] = () => {
    const d = w.wind_dir_true;
    const dir = d === null || d === "VRB" ? "VRB" : ((Math.round((d - airport.data.magdec_east_deg) / 10) * 10 + 360) % 360) || 360;
    return wind(dir, w.wind_kt, w.gust_kt !== null && w.gust_kt > w.wind_kt ? w.gust_kt : undefined);
  };

  // ponytail: other airports are spelled phonetically (§9.2 fallback); their AWC name needs a second airport call.
  const dest: Ctx["dest"] = () => {
    const other = flight.data.other_airport;
    const base = { key: "limit", kind: "place", label: "Clearance limit", value: other } as const;
    if (other !== icao) return { phrase: { display: other, spoken: spell(other) }, item: base };
    const name = config.radio_name;
    return { phrase: { display: name, spoken: name }, item: { ...base, accept: [name.toLowerCase()] } };
  };

  const freq: Ctx["freq"] = (label, value) => {
    if (!isTodo(value)) return value;
    warn(`${label} not set in airports.json`);
    return null;
  };

  const towerFreq: Ctx["towerFreq"] = () => airport.data.tower_freq ?? freq("Tower frequency", config.tower_fallback_freq);

  return { rand: mulberry32(seed), icao, config, snapshot, need, runway, wind: magneticWind, dest, freq, towerFreq };
}

export function buildScenario(input: BuildInput): Scenario {
  const { icao, type, seed, config, snapshot } = input;
  const extra: string[] = [];
  const t = TEMPLATES[type](makeCtx(input, (line) => extra.push(line)));
  const tail = snapshot.flight.data.tail;
  const w = snapshot.weather.data;
  return {
    scenario_id: `${icao}-${type}-${seed}`,
    seed,
    type,
    airport: { icao, radio_name: config.radio_name },
    facility: t.facility,
    callsign: { tail, spoken: callsign(tail).spoken, abbrev: abbreviatedCallsign(tail).display },
    controller_text: t.text.display,
    controller_speech: t.text.spoken,
    expected: [{ key: "callsign", kind: "callsign", label: "Callsign", value: tail }, ...t.expected],
    context: { metar_raw: w.metar_raw, runway: t.runway, altimeter: w.altimeter_inhg.toFixed(2) },
    provenance: {
      weather: snapshot.weather.provenance,
      airport: snapshot.airport.provenance,
      flight: snapshot.flight.provenance,
    },
    warnings: [...snapshot.weather.warnings, ...snapshot.airport.warnings, ...snapshot.flight.warnings, ...[...new Set(extra)]],
  };
}
