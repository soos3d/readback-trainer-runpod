import type { Scenario } from "@/lib/schemas";
import { AlertIcon, CheckIcon, PlayIcon } from "./Icons";
import css from "../page.module.css";

type Chip = { label: string; ok: boolean };

function chips({ provenance: p, callsign }: Scenario): Chip[] {
  const age = p.weather.age_min === undefined ? "" : `, ${Math.round(p.weather.age_min)} min old`;
  const weather: Chip = p.weather.source === "synthetic"
    ? { label: "Weather: standard", ok: false }
    : { label: `Weather: ${p.weather.source}${age}`, ok: p.weather.source === "live" };
  const flight: Chip = p.flight.source === "opensky"
    ? { label: `Flight: real, ${callsign.tail}${p.flight.date ? ` on ${p.flight.date}` : ""}`, ok: true }
    : { label: "Flight: made up", ok: false };
  return [weather, flight];
}

type Props = { scenario: Scenario; audio: string | null; waiting: boolean; showText: boolean; onToggleText: () => void };

export function CallCard({ scenario, audio, waiting, showText, onToggleText }: Props) {
  // Started by a click, so autoplay rules allow it; a rejection (broken WAV) surfaces as an unhandled error.
  const play = () => void new Audio(`data:audio/wav;base64,${audio}`).play();
  return (
    <section className={css.card} aria-labelledby="call-heading">
      <h2 id="call-heading" className={css.cardTitle}>
        {scenario.facility.name} <span className={css.mono}>{scenario.facility.freq}</span>
      </h2>
      <p className={css.muted}>You are <span className={css.mono}>{scenario.callsign.abbrev}</span></p>
      <div className={css.row}>
        <button type="button" className={css.secondary} onClick={play} disabled={!audio}>
          <PlayIcon /> {audio ? "Play" : waiting ? "Voice loading" : "No voice"}
        </button>
        <button type="button" className={css.secondary} onClick={onToggleText} aria-expanded={showText} aria-controls="call-text">
          {showText ? "Hide text" : "Show text"}
        </button>
      </div>
      {showText && <p id="call-text" className={css.callText}>{scenario.controller_text}</p>}
      <ul className={css.chips} aria-label="Data sources">
        {chips(scenario).map((c) => (
          <li key={c.label} className={css.chip} data-ok={c.ok}>
            {c.ok ? <CheckIcon /> : <AlertIcon />} {c.label}
          </li>
        ))}
      </ul>
      {scenario.context.metar_raw && <p className={css.metar}>{scenario.context.metar_raw}</p>}
      {scenario.warnings.map((w) => (
        <p key={w} className={css.warning}><AlertIcon /> {w}</p>
      ))}
    </section>
  );
}
