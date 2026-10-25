"use client";
// One page, one useReducer (SPEC §14). This file runs the effects; app/reducer.ts decides what they mean.
import { use, useEffect, useReducer, useRef } from "react";
import type { AirportSummary, GradeResult, Scenario, SpeechAudio } from "@/lib/schemas";
import { startRecording, type Recorder } from "@/lib/client/recorder";
import { type Call, WARM_RETRIES, initialState, reducer } from "./reducer";
import { RequestFailed, get, post, toFailure } from "./components/api";
import { CallCard } from "./components/CallCard";
import { Controls } from "./components/Controls";
import { DemoPanel } from "./components/DemoPanel";
import { Guide } from "./components/Guide";
import { Header } from "./components/Header";
import { ReadbackCard } from "./components/ReadbackCard";
import { ResultCard } from "./components/ResultCard";
import { StatusArea } from "./components/StatusArea";
import css from "./page.module.css";

const POLL_MS = 10_000;
const WARM_RETRY_MS = 3_000;
type Health = { workers: { idle: number; ready: number; running: number; initializing: number } };
type Attempt = { transcript: string; grade: GradeResult };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  const demo = use(searchParams).demo === "1";
  const [s, dispatch] = useReducer(reducer, initialState);
  const form = useRef<HTMLFormElement>(null);
  const recorder = useRef<Promise<Recorder> | null>(null);
  const gpuSettled = s.gpu === "ready" || s.gpu === "offline";
  const recording = s.status === "recording";

  useEffect(() => {
    get<AirportSummary[]>("/api/airports").then(
      (airports) => dispatch({ type: "airports", airports }),
      (e: unknown) => dispatch({ type: "failed", call: "scenario", err: toFailure(e) }),
    );
  }, []);

  // Flow D: each warm-up submits a ping job; poll until a worker is ready. A 502 only marks the dot offline,
  // and polling stops there too so a broken endpoint is not pinged every 10 s (DECISIONS.md, T15).
  useEffect(() => {
    if (gpuSettled) return;
    const warm = () => post<Health>("/api/warmup").then(
      (h) => dispatch({ type: "health", workers: h.workers }),
      () => dispatch({ type: "health_failed" }),
    );
    void warm();
    const id = setInterval(warm, POLL_MS);
    return () => clearInterval(id);
  }, [gpuSettled]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // §14.3: on 503 speech_warming stay in warming_gpu and retry ×2, 3 s apart; the reducer then picks text_only.
  async function withWarmRetry<T>(call: Call, scenarioId: string, request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (e) {
        const warming = e instanceof RequestFailed && e.failure.code === "speech_warming";
        if (!warming || attempt >= WARM_RETRIES) throw e;
        dispatch({ type: "failed", call, scenarioId, err: e.failure });
        await new Promise((r) => setTimeout(r, WARM_RETRY_MS));
      }
    }
  }

  async function speak(scenario: Scenario) {
    const id = scenario.scenario_id;
    try {
      const audio = await withWarmRetry("speak", id, () => post<SpeechAudio>("/api/speak", { text: scenario.controller_speech }));
      dispatch({ type: "audio", scenarioId: id, audio: audio.audio_wav_b64 });
    } catch (e) {
      dispatch({ type: "failed", call: "speak", scenarioId: id, err: toFailure(e) });
    }
  }

  // Flow A + B: show the card as soon as the scenario lands; the voice follows when the GPU answers.
  async function newCall(data: FormData) {
    dispatch({ type: "new_call" });
    const simulate = data.getAll("simulate");
    try {
      const scenario = await post<Scenario>("/api/scenario", {
        airport: data.get("airport"), type: data.get("type"), ...(simulate.length > 0 && { simulate }),
      });
      dispatch({ type: "scenario", scenario });
      void speak(scenario);
    } catch (e) {
      dispatch({ type: "failed", call: "scenario", err: toFailure(e) });
    }
  }

  function recordFailed(e: unknown) {
    if (e instanceof Error && e.name === "MicDeniedError") return dispatch({ type: "mic_denied" });
    if (e instanceof Error && e.name === "TooShortError") return dispatch({ type: "too_short" });
    dispatch({ type: "failed", call: "attempt", err: toFailure(e) });
  }

  function startTalk() {
    if (s.status !== "audio_ready" || recorder.current) return;
    dispatch({ type: "record_start" });
    const pending = startRecording({ onAutoStop: () => void stopTalk() });
    recorder.current = pending;
    pending.catch((e: unknown) => {
      recorder.current = null;
      recordFailed(e);
    });
  }

  // Flow C: release → WAV → /api/attempt → transcript + grade.
  async function stopTalk() {
    const pending = recorder.current;
    const scenario = s.scenario;
    if (!pending || !scenario) return;
    recorder.current = null;
    const rec = await pending.catch(() => null); // a failed start was already reported by startTalk's .catch
    if (!rec) return;
    let wav: string;
    try {
      wav = await rec.stop();
    } catch (e) {
      return recordFailed(e);
    }
    dispatch({ type: "record_stop" });
    try {
      const body = { scenario, audio_wav_b64: wav };
      const res = await withWarmRetry("attempt", scenario.scenario_id, () => post<Attempt>("/api/attempt", body));
      dispatch({ type: "graded", result: res.grade, transcript: res.transcript });
    } catch (e) {
      dispatch({ type: "failed", call: "attempt", err: toFailure(e) });
    }
  }

  async function gradeTyped(transcript: string) {
    if (!s.scenario) return;
    dispatch({ type: "submit_text" });
    try {
      const result = await post<GradeResult>("/api/grade", { scenario: s.scenario, transcript });
      dispatch({ type: "graded", result, transcript });
    } catch (e) {
      dispatch({ type: "failed", call: "grade", err: toFailure(e) });
    }
  }

  const nextCall = () => form.current?.requestSubmit();
  const retry = () => (s.scenario ? dispatch({ type: "recover" }) : nextCall());
  const busy = ["loading_scenario", "recording", "transcribing"].includes(s.status);

  return (
    <div className={css.page}>
      <Header gpu={s.gpu} />
      <div className={css.layout}>
      <main className={css.main}>
        <Controls airports={s.airports} busy={busy} formRef={form} onSubmit={(d) => void newCall(d)} />
        <StatusArea state={s} onRetry={retry} />
        {s.scenario && (
          <>
            <CallCard scenario={s.scenario} audio={s.audio} showText={s.showText}
              waiting={s.status === "loading_scenario" || s.status === "warming_gpu"}
              onToggleText={() => dispatch({ type: "toggle_text" })} />
            <ReadbackCard status={s.status} typing={s.typing} secondsLeft={s.secondsLeft} inline={s.inline}
              onStart={startTalk} onStop={() => void stopTalk()} onTypeInstead={() => dispatch({ type: "type_instead" })}
              onSubmitText={(t) => void gradeTyped(t)} />
          </>
        )}
        {s.status === "graded" && s.result && (
          <ResultCard result={s.result} transcript={s.transcript ?? ""}
            onTryAgain={() => dispatch({ type: "try_again" })} onNext={nextCall} />
        )}
      </main>
      <Guide type={s.scenario?.type ?? "takeoff"} />
      </div>
      <footer className={css.footer}>
        <p>Training aid only. Not for real-world navigation or ATC communication.</p>
        {demo && <DemoPanel />}
      </footer>
    </div>
  );
}
