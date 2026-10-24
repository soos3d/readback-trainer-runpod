// One template per call type (SPEC §9.1). Pure; all randomness comes from ctx.rand.
import { abbreviatedCallsign, altimeter, altitude, callsign, frequency, heading, PHONETIC, runway, spell, squawk, type Phrase } from "./phraseology";
import { endHeading } from "./runway";
import { isTodo, type AirportConfig, type CallType, type ExpectedItem, type Kind, type Snapshot } from "./schemas";

export type Filled<K extends keyof AirportConfig> = { [P in K]: Exclude<AirportConfig[P], "TODO"> };

/** What scenarios.ts hands every template. Helpers that fall back record a warning. */
export type Ctx = {
  rand: () => number;
  icao: string;
  config: AirportConfig;
  snapshot: Snapshot;
  /** Throws 422 naming every listed field that is still "TODO". */
  need: <K extends keyof AirportConfig>(...fields: K[]) => Filled<K>;
  /** Runway end in use, limited to `allowedEnds` when given. */
  runway: (allowedEnds?: string[]) => string;
  /** Wind for the tower, rounded to 10° magnetic. */
  wind: () => Phrase;
  /** Clearance limit and the place item for the grader. */
  dest: () => { phrase: Phrase; item: ExpectedItem };
  /** null when the frequency is "TODO" (a warning names `label`). */
  freq: (label: string, value: string) => string | null;
  /** AWC tower frequency, else tower_fallback_freq, else null. */
  towerFreq: () => string | null;
};

export type Template = (ctx: Ctx) => {
  facility: { name: string; freq: string };
  text: Phrase;
  runway: string;
  expected: ExpectedItem[];
};

/** Tagged template: interpolated Phrases use .display for text and .spoken for speech. */
function say(strings: TemplateStringsArray, ...parts: (Phrase | string)[]): Phrase {
  const join = (side: keyof Phrase) =>
    strings.reduce((out, s, i) => {
      const p = parts[i - 1];
      return out + (typeof p === "string" ? p : p[side]) + s;
    });
  return { display: join("display"), spoken: join("spoken") };
}

const NOT_SET: Phrase = { display: "frequency not set", spoken: "frequency not set" };
const ROUTES = ["as filed", "via radar vectors, then as filed"];
const REJECT_SQUAWKS = new Set(["0000", "1200", "7500", "7600", "7700", "7777"]);
const HEADINGS = Array.from({ length: 36 }, (_, i) => (i + 1) * 10);
const TURNS = [-90, -80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80, 90];

const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const int = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const norm = (deg: number) => ((deg % 360) + 360) % 360 || 360;

/** Multiples of 1,000 from `lo` (rounded up) to `hi`; just the rounded `lo` when hi is below it. */
function thousands(lo: number, hi: number): number[] {
  const first = Math.ceil(lo / 1000) * 1000;
  return Array.from({ length: Math.max(1, Math.floor((hi - first) / 1000) + 1) }, (_, i) => first + i * 1000);
}

function squawkCode(rand: () => number): string {
  const code = Array.from({ length: 4 }, () => int(rand, 0, 7)).join("");
  return REJECT_SQUAWKS.has(code) ? squawkCode(rand) : code;
}

/** Shortest turn from `from` to `to`; a 180° turn goes right. */
const turnDir = (from: number, to: number) => ((to - from + 360) % 360 <= 180 ? "right" : "left");

const item = (key: string, kind: Kind, label: string, value: string | number, accept?: string[]): ExpectedItem =>
  accept ? { key, kind, label, value, accept } : { key, kind, label, value };

const facilityName = (ctx: Ctx, name: string, suffix: string) => (isTodo(name) ? `${ctx.config.radio_name} ${suffix}` : name);

/** "RNAV (GPS)" → spoken "RNAV GPS"; grader also accepts the first word alone ("cleared RNAV").
 * A circling letter is spoken phonetically and the grader needs it: "RNAV (GPS)-A" → "RNAV GPS alpha", accepts "RNAV A". */
function approachName(name: string): { phrase: Phrase; forms: string[] } {
  const m = /^(.*)-([A-Z])$/.exec(name);
  const base = (m ? m[1] : name).replace(/[()]/g, "");
  const words = [base, base.split(" ")[0]];
  if (!m) return { phrase: { display: name, spoken: base }, forms: [...new Set(words)] };
  return { phrase: { display: name, spoken: `${base} ${PHONETIC[m[2]]}` }, forms: [...new Set(words.map((w) => `${w} ${m[2]}`))] };
}

/** A straight-in approach to the runway in use, else a circling one that circles to it (JO 7110.65 4-8-1). */
function chooseApproach(ctx: Ctx, approaches: Filled<"approaches">["approaches"]) {
  const { circling, ...straight } = approaches;
  const rwy = ctx.runway(circling ? undefined : Object.keys(straight));
  const circle = circling !== undefined && !Object.hasOwn(straight, rwy);
  return { rwy, name: pick(ctx.rand, circle ? circling : straight[rwy]), circle };
}

const abbr = (ctx: Ctx) => abbreviatedCallsign(ctx.snapshot.flight.data.tail);
const full = (ctx: Ctx) => callsign(ctx.snapshot.flight.data.tail);

const ifrClearance: Template = (ctx) => {
  const { min_vector_altitude: min, max_assign_altitude: max } = ctx.need("min_vector_altitude", "max_assign_altitude");
  const initial = pick(ctx.rand, thousands(min, Math.max(min, 5000)));
  const expect = Math.min(initial + int(ctx.rand, 2, 6) * 1000, max);
  const route = pick(ctx.rand, ROUTES);
  const code = squawkCode(ctx.rand);
  const dest = ctx.dest();
  const dep = ctx.freq("Departure frequency", ctx.config.departure.freq);
  const depSlot = dep ? say`frequency ${frequency(dep)}` : NOT_SET;
  const ten = { display: "10", spoken: spell("10") };
  const { clearance } = ctx.config;
  return {
    facility: {
      name: facilityName(ctx, clearance.name, "Clearance Delivery"),
      freq: ctx.freq("Clearance Delivery frequency", clearance.freq) ?? NOT_SET.display,
    },
    text: say`${full(ctx)}, cleared to ${dest.phrase} airport ${route}. Climb and maintain ${altitude(initial)}, expect ${altitude(expect)} ${ten} minutes after departure. Departure ${depSlot}, ${squawk(code)}.`,
    runway: ctx.runway(),
    expected: [
      dest.item,
      item("route", "route", "Route", route, route === "as filed" ? undefined : ["vectors then as filed", "vectors as filed"]),
      item("altitude", "altitude", "Altitude", initial),
      item("expect", "altitude", "Expect altitude", expect),
      ...(dep ? [item("dep_freq", "frequency", "Departure frequency", dep)] : []),
      item("squawk", "squawk", "Squawk", code),
    ],
  };
};

const takeoff: Template = (ctx) => {
  const rwy = ctx.runway();
  const turn = pick(ctx.rand, TURNS);
  const hdg = norm(endHeading(rwy) + turn);
  const twr = ctx.towerFreq();
  return {
    facility: { name: `${ctx.config.radio_name} Tower`, freq: twr ?? NOT_SET.display },
    text: say`${abbr(ctx)}, turn ${turn < 0 ? "left" : "right"} ${heading(hdg)}, ${ctx.wind()}, ${runway(rwy)}, cleared for takeoff.`,
    runway: rwy,
    expected: [
      item("heading", "heading", "Heading", hdg),
      item("runway", "runway", "Runway", rwy),
      item("takeoff", "phrase", "Cleared for takeoff", "cleared for takeoff"),
    ],
  };
};

const departure: Template = (ctx) => {
  const { min_vector_altitude: min, max_assign_altitude: max } = ctx.need("min_vector_altitude", "max_assign_altitude");
  const rwy = ctx.runway();
  const alt = pick(ctx.rand, thousands(min, max));
  const hdg = pick(ctx.rand, HEADINGS.filter((h) => h !== endHeading(rwy)));
  const dir = turnDir(endHeading(rwy), hdg);
  const name = facilityName(ctx, ctx.config.departure.name, "Departure");
  return {
    facility: { name, freq: ctx.freq("Departure frequency", ctx.config.departure.freq) ?? NOT_SET.display },
    text: say`${full(ctx)}, ${name}, radar contact. Climb and maintain ${altitude(alt)}, turn ${dir} ${heading(hdg)}.`,
    runway: rwy,
    expected: [
      item("altitude", "altitude", "Altitude", alt),
      item("heading", "heading", "Heading", hdg),
      item("direction", "phrase", "Turn direction", `turn ${dir}`, [`${dir} heading`]),
    ],
  };
};

const approachFacility = (ctx: Ctx) => ({
  name: facilityName(ctx, ctx.config.approach.name, "Approach"),
  freq: ctx.freq("Approach frequency", ctx.config.approach.freq) ?? NOT_SET.display,
});

const approachVectors: Template = (ctx) => {
  const { approaches } = ctx.need("approaches");
  const { rwy, name, circle } = chooseApproach(ctx, approaches);
  const appr = approachName(name);
  const target = circle ? say`approach, circle to ${runway(rwy)}` : runway(rwy);
  const alt = pick(ctx.rand, [2000, 3000, 4000]);
  const hdg = pick(ctx.rand, HEADINGS);
  const inHg = ctx.snapshot.weather.data.altimeter_inhg;
  return {
    facility: approachFacility(ctx),
    text: say`${abbr(ctx)}, ${ctx.config.radio_name} ${altimeter(inHg)}. Descend and maintain ${altitude(alt)}, fly ${heading(hdg)}, vectors ${appr.phrase} ${target}.`,
    runway: rwy,
    expected: [
      item("altimeter", "altimeter", "Altimeter", inHg.toFixed(2)),
      item("altitude", "altitude", "Altitude", alt),
      item("heading", "heading", "Heading", hdg),
      item("approach", "phrase", "Approach", appr.phrase.display, appr.forms),
      item("runway", "runway", "Runway", rwy),
    ],
  };
};

const approachClearance: Template = (ctx) => {
  const { approaches, min_vector_altitude: alt } = ctx.need("approaches", "min_vector_altitude");
  const { rwy, name, circle } = chooseApproach(ctx, approaches);
  const appr = approachName(name);
  const miles = String(int(ctx.rand, 3, 6));
  const turn = pick(ctx.rand, [-30, -20, 20, 30]);
  const hdg = norm(endHeading(rwy) + turn);
  const course = /^(ILS|LOC)/.test(name) ? "localizer" : "final approach course";
  const twr = ctx.towerFreq();
  const approach = circle ? say`${appr.phrase} approach, circle to ${runway(rwy)}` : say`${appr.phrase} ${runway(rwy)} approach`;
  const cleared = appr.forms.flatMap((f) => [`cleared ${f}`, `cleared for the ${f}`, `cleared for ${f}`]);
  return {
    facility: approachFacility(ctx),
    text: say`${abbr(ctx)}, ${{ display: miles, spoken: spell(miles) }} miles from the final approach fix, turn ${turn < 0 ? "left" : "right"} ${heading(hdg)}, maintain ${altitude(alt)} until established on the ${course}, cleared ${approach}. Contact ${ctx.config.radio_name} tower ${twr ? frequency(twr) : NOT_SET}.`,
    runway: rwy,
    expected: [
      item("heading", "heading", "Heading", hdg),
      item("altitude", "altitude", "Altitude", alt),
      item("established", "phrase", "Until established", "until established"),
      item("clearance", "phrase", "Approach clearance", `cleared ${circle ? name : `${name} ${runway(rwy).display}`} approach`, cleared),
      item("runway", "runway", "Runway", rwy),
      ...(twr ? [item("tower_freq", "frequency", "Tower frequency", twr)] : []),
    ],
  };
};

export const TEMPLATES: Record<CallType, Template> = {
  ifr_clearance: ifrClearance,
  takeoff,
  departure,
  approach_vectors: approachVectors,
  approach_clearance: approachClearance,
};
