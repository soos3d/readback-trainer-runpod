import type { FormEvent, RefObject } from "react";
import type { AirportSummary, CallType } from "@/lib/schemas";
import css from "../page.module.css";

const CALL_TYPES: { value: CallType; label: string }[] = [
  { value: "takeoff", label: "Takeoff clearance" },
  { value: "ifr_clearance", label: "IFR clearance" },
  { value: "departure", label: "Departure" },
  { value: "approach_vectors", label: "Approach vectors" },
  { value: "approach_clearance", label: "Approach clearance" },
];

type Props = {
  airports: AirportSummary[];
  busy: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  onSubmit: (data: FormData) => void;
};

export function Controls({ airports, busy, formRef, onSubmit }: Props) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  };
  return (
    <form id="controls" ref={formRef} className={css.controls} onSubmit={submit}>
      <label className={css.field}>
        <span>Airport</span>
        <select name="airport" required disabled={airports.length === 0}>
          {airports.map((a) => (
            <option key={a.icao} value={a.icao}>{a.icao} · {a.name}</option>
          ))}
        </select>
      </label>
      <label className={css.field}>
        <span>Call type</span>
        <select name="type" defaultValue="takeoff">
          {CALL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <button type="submit" className={css.primary} disabled={busy || airports.length === 0}>New call</button>
    </form>
  );
}
