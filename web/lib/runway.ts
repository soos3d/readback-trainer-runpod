// Runway in use (SPEC §9.2). Pure; headings are true degrees, compared directly with METAR wdir (§8.1).

/** Structural match for an AWC runway: id "01L/19R", alignment in degrees true for the first end. */
export type Runway = { id: string; alignment: number };

export type RunwayInUseInput = {
  windDirTrue: number | "VRB";
  windKt: number;
  runways: readonly Runway[];
  calmRunway: string;
  /** Ends with an approach for this scenario type; omit to allow every end. */
  allowedEnds?: readonly string[];
};

const CALM_MAX_KT = 3;

/** Nominal end heading from the runway number: "13L" → 130, "36C" → 360. */
export function endHeading(endId: string): number {
  const n = Number.parseInt(endId, 10);
  if (!Number.isInteger(n) || n < 1 || n > 36) throw new Error(`Not a runway end id: "${endId}"`);
  return n * 10;
}

/** Smallest angle between two headings, 0–180. */
const angleBetween = (a: number, b: number): number => {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
};

const endsOf = (runways: readonly Runway[]) =>
  runways.flatMap(({ id, alignment }) =>
    id.split("/").map((end, i) => ({ id: end, heading: (alignment + i * 180) % 360 })),
  );

/**
 * Runway end most aligned with the wind. Calm (≤ 3 kt) or VRB → calmRunway, or with
 * allowedEnds, the allowed end closest to calmRunway's heading. Ties go to the earliest
 * end in `runways` order (first end of an id before its second).
 */
export function runwayInUse({ windDirTrue, windKt, runways, calmRunway, allowedEnds }: RunwayInUseInput): string {
  const all = endsOf(runways);
  if (all.length === 0) throw new Error("runwayInUse: no runways given");
  const candidates = allowedEnds ? all.filter((e) => allowedEnds.includes(e.id)) : all;
  if (candidates.length === 0) {
    throw new Error(`runwayInUse: none of [${allowedEnds?.join(", ")}] is an end of [${runways.map((r) => r.id).join(", ")}]`);
  }

  const windDir = windDirTrue !== "VRB" && windKt > CALM_MAX_KT ? windDirTrue : null;
  if (windDir === null && !allowedEnds) return calmRunway;
  const target = windDir ?? all.find((e) => e.id === calmRunway)?.heading ?? endHeading(calmRunway);

  return candidates.reduce((best, e) => (angleBetween(e.heading, target) < angleBetween(best.heading, target) ? e : best)).id;
}
