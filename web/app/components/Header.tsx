import type { Gpu } from "../reducer";
import css from "../page.module.css";

const GPU_LABEL: Record<Gpu, string> = {
  checking: "GPU: checking",
  cold: "GPU: cold",
  warming: "GPU: warming up",
  ready: "GPU: ready",
  offline: "GPU: offline",
};

export function Header({ gpu }: { gpu: Gpu }) {
  return (
    <header className={css.header}>
      <h1 className={css.title}>Readback Trainer</h1>
      <p className={css.gpu} data-gpu={gpu} title="Speech runs on a GPU worker that sleeps when idle">
        <span className={css.dot} aria-hidden="true" />
        {GPU_LABEL[gpu]}
      </p>
    </header>
  );
}
