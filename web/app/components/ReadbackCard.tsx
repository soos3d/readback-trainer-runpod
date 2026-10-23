import type { FormEvent, KeyboardEvent, PointerEvent } from "react";
import type { Status } from "../reducer";
import { MicIcon } from "./Icons";
import css from "../page.module.css";

type Props = {
  status: Status;
  typing: boolean;
  secondsLeft: number;
  inline: string | null;
  onStart: () => void;
  onStop: () => void;
  onTypeInstead: () => void;
  onSubmitText: (transcript: string) => void;
};

function TypedReadback({ busy, onSubmitText }: { busy: boolean; onSubmitText: (t: string) => void }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmitText(String(new FormData(e.currentTarget).get("transcript") ?? ""));
  };
  return (
    <form className={css.typed} onSubmit={submit}>
      <label className={css.field}>
        <span>Your readback</span>
        <textarea name="transcript" rows={3} maxLength={600} required autoComplete="off" spellCheck={false} autoFocus
          placeholder="What you would say on frequency" />
      </label>
      <button type="submit" className={css.secondary} disabled={busy}>Grade readback</button>
    </form>
  );
}

export function ReadbackCard({ status, typing, secondsLeft, inline, onStart, onStop, onTypeInstead, onSubmitText }: Props) {
  const recording = status === "recording";
  const busy = status === "transcribing";
  if (typing) {
    return (
      <section className={css.card} aria-label="Read back">
        <TypedReadback busy={busy} onSubmitText={onSubmitText} />
      </section>
    );
  }
  const canTalk = status === "audio_ready" || recording;
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onStart();
  };
  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) onStart();
  };
  const keyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    onStop();
  };
  return (
    <section className={css.card} aria-label="Read back">
      <div className={css.talkRow}>
        <button type="button" className={css.talk} data-recording={recording} disabled={!canTalk}
          onPointerDown={down} onPointerUp={onStop} onPointerCancel={onStop} onKeyDown={keyDown} onKeyUp={keyUp}
          onContextMenu={(e) => e.preventDefault()}>
          <MicIcon />
          <span>{recording ? "Release to send" : "Hold to talk"}</span>
        </button>
        <p className={css.countdown} aria-hidden={!recording}>
          {recording ? `0:${String(secondsLeft).padStart(2, "0")}` : "0:30"}
        </p>
      </div>
      <p className={css.hint}>Hold the button, or focus it and hold Space.</p>
      {inline && <p className={css.inline}>{inline}</p>}
      {!recording && !busy && (
        <button type="button" className={css.link} onClick={onTypeInstead}>Type instead</button>
      )}
    </section>
  );
}
