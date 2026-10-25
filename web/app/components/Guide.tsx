// Primer for users new to ATC phraseology: one worked example for the current call type.
// [Bracketed] parts are what the grader checks (lib/scenarioTemplates.ts).
import type { CallType } from "@/lib/schemas";
import css from "../page.module.css";

const EXAMPLES: Record<CallType, { atc: string; you: string }> = {
  takeoff: {
    atc: "N3AB, turn right heading 300, wind 270 at 8, runway 25, cleared for takeoff.",
    you: "[Right heading 300], [runway 25], [cleared for takeoff], [3AB].",
  },
  ifr_clearance: {
    atc: "N123AB, cleared to KSLE airport as filed. Climb and maintain 3,000, expect 7,000 10 minutes after departure. Departure frequency 124.35, squawk 4521.",
    you: "Cleared to [KSLE] [as filed], [3,000], expect [7,000] in ten, departure [124.35], squawk [4521], [N123AB].",
  },
  departure: {
    atc: "N123AB, Portland departure, radar contact. Climb and maintain 4,000, turn left heading 110.",
    you: "Climb and maintain [4,000], [left heading] [110], [N123AB].",
  },
  approach_vectors: {
    atc: "N3AB, Portland altimeter 30.09. Descend and maintain 3,000, fly heading 270, vectors ILS runway 10.",
    you: "Altimeter [30.09], [3,000], heading [270], vectors [ILS] [runway 10], [3AB].",
  },
  approach_clearance: {
    atc: "N3AB, 4 miles from the final approach fix, turn right heading 120, maintain 2,500 until established on the localizer, cleared ILS runway 10 approach. Contact tower 120.5.",
    you: "Right heading [120], [2,500] [until established], [cleared ILS runway 10 approach], tower [120.5], [3AB].",
  },
};

/** "a [b] c" → a <mark>b</mark> c */
const highlight = (text: string) =>
  text.split(/\[(.*?)\]/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));

export function Guide({ type }: { type: CallType }) {
  const ex = EXAMPLES[type];
  return (
    <aside className={css.guide} aria-labelledby="guide-title">
      <h2 id="guide-title" className={css.subTitle}>New to ATC calls?</h2>
      <p className={css.muted}>Listen to the controller, then repeat back the key parts.</p>
      <div className={css.bubble} data-who="atc">
        <span>ATC says</span>
        <p>{ex.atc}</p>
      </div>
      <div className={css.bubble} data-who="you">
        <span>You say</span>
        <p>{highlight(ex.you)}</p>
      </div>
      <p className={css.muted}><mark>Highlighted</mark> parts are graded. Skip the wind and greetings, end with your callsign.</p>
    </aside>
  );
}
