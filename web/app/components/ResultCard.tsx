import { useEffect, useRef } from "react";
import type { GradeResult, ItemStatus } from "@/lib/schemas";
import { AlertIcon, CheckIcon, XIcon } from "./Icons";
import css from "../page.module.css";

const VERDICT = {
  readback_correct: { label: "Readback correct", Icon: CheckIcon, tone: "ok" },
  readback_incorrect: { label: "Readback incorrect", Icon: XIcon, tone: "bad" },
  readback_incomplete: { label: "Readback incomplete", Icon: AlertIcon, tone: "warn" },
} as const;

const ITEM: Record<ItemStatus, { label: string; Icon: () => React.JSX.Element; tone: string }> = {
  correct: { label: "Correct", Icon: CheckIcon, tone: "ok" },
  incorrect: { label: "Wrong", Icon: XIcon, tone: "bad" },
  missing: { label: "Missing", Icon: AlertIcon, tone: "warn" },
};

type Props = { result: GradeResult; transcript: string; onTryAgain: () => void; onNext: () => void };

export function ResultCard({ result, transcript, onTryAgain, onNext }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []); // keyboard users land on the result
  const v = VERDICT[result.verdict];
  return (
    <section className={css.card} aria-labelledby="result-heading">
      <h2 id="result-heading" ref={heading} tabIndex={-1} className={css.verdict} data-tone={v.tone}>
        <v.Icon /> {v.label} <span className={css.mono}>{Math.round(result.score * 100)}%</span>
      </h2>
      <table className={css.table}>
        <thead>
          <tr><th scope="col">Item</th><th scope="col">Expected</th><th scope="col">Heard</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {result.items.map((item) => {
            const s = ITEM[item.status];
            return (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td className={css.mono}>{item.expected}</td>
                <td className={css.mono}>{item.heard ?? "—"}</td>
                <td data-tone={s.tone}><span className={css.itemStatus}><s.Icon /> {s.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3 className={css.subTitle}>What we heard</h3>
      <p className={css.heard}>{transcript || "Nothing"}</p>
      {result.tips.length > 0 && (
        <ul className={css.tips}>{result.tips.map((t) => <li key={t}>{t}</li>)}</ul>
      )}
      <div className={css.row}>
        <button type="button" className={css.secondary} onClick={onTryAgain}>Try again</button>
        <button type="button" className={css.secondary} onClick={onNext}>Next call</button>
      </div>
    </section>
  );
}
