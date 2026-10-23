// The page's one aria-live region (SPEC §14.3): progress text, banners and the error with Retry.
import type { State } from "../reducer";
import { AlertIcon } from "./Icons";
import css from "../page.module.css";

function progress(s: State): string {
  switch (s.status) {
    case "loading_scenario": return s.scenario ? "Loading the controller's voice…" : "Getting weather and traffic…";
    case "warming_gpu": return "Warming up the GPU (first call can take a minute)…";
    case "audio_ready": return "Play the call, then hold to talk.";
    case "recording": return "Recording. Release to send.";
    case "transcribing": return "Listening back and grading…";
    case "idle": return s.scenario ? "" : "Pick an airport and a call type, then press New call.";
    default: return "";
  }
}

export function StatusArea({ state, onRetry }: { state: State; onRetry: () => void }) {
  const { notice, error, inline } = state;
  return (
    <div aria-live="polite" className={css.status}>
      {progress(state) && <p className={css.progress}>{progress(state)}</p>}
      {inline && <p className={css.srOnly}>{inline}</p>}
      {notice && <div className={css.banner} data-tone="warn"><AlertIcon /><p>{notice}</p></div>}
      {error && (
        <div className={css.banner} data-tone="bad">
          <AlertIcon />
          <p>{error.message} <span className={css.source}>(source: {error.source})</span></p>
          {error.retry && <button type="button" className={css.secondary} onClick={onRetry}>Retry</button>}
        </div>
      )}
    </div>
  );
}
