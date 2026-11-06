import { generationOwner, recordGeneration, useGenerationDetails } from "../lib/generationPreferences";
/**
 * Small pieces the AI helper cards and the habit coach share: running one helper call with
 * loading and error state, and the animated "thinking" line.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../lib/api";
import type { GenerationStage, ProgressListener } from "../lib/api/generationProgress";

/** Runs one helper call with loading and error state. */
export function useHelperCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export interface ResponseTiming {
  state: "waiting" | "complete" | "failed";
  elapsedMs: number;
  stages?: GenerationStage[];
}

export type MeasureResponse = <T>(request: (onProgress: ProgressListener) => Promise<T>) => Promise<{ value: T; elapsedMs: number; stages: GenerationStage[] }>;

/** Times the supplied response operation; Coach includes its initial reset wait in that operation. */
export function useResponseTimer(kind = "Generation") {
  const [timing, setTiming] = useState<ResponseTiming | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    if (interval.current !== null) clearInterval(interval.current);
    interval.current = null;
  }, []);

  const clear = useCallback(() => {
    generation.current += 1;
    stop();
    setTiming(null);
  }, [stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      stop();
    };
  }, [stop]);

  const measure: MeasureResponse = useCallback(async <T,>(request: (onProgress: ProgressListener) => Promise<T>) => {
    const current = ++generation.current;
    const account = generationOwner();
    const start = performance.now();
    const elapsed = () => Math.max(0, performance.now() - start);
    const stages: GenerationStage[] = [];
    stop();
    if (mounted.current) {
      setTiming({ state: "waiting", elapsedMs: 0 });
      interval.current = setInterval(() => {
        if (current === generation.current) setTiming({ state: "waiting", elapsedMs: elapsed(), stages: [...stages] });
      }, 250);
    }
    try {
      const value = await request((stage) => {
        stages.push(stage);
        if (!mounted.current || current !== generation.current) return;
        setTiming({ state: "waiting", elapsedMs: elapsed(), stages: [...stages] });
      });
      const elapsedMs = elapsed();
      recordGeneration(kind, { state: "complete", elapsedMs, stages: [...stages] }, account);
      if (mounted.current && current === generation.current) setTiming({ state: "complete", elapsedMs, stages: [...stages] });
      return { value, elapsedMs, stages };
    } catch (error) {
      recordGeneration(kind, { state: "failed", elapsedMs: elapsed(), stages: [...stages] }, account);
      if (mounted.current && current === generation.current) setTiming({ state: "failed", elapsedMs: elapsed(), stages: [...stages] });
      throw error;
    } finally {
      if (current === generation.current) stop();
    }
  }, [stop, kind]);

  return { timing, measure, clear };
}

/** Browser round-trip seconds. Live ticks stay quiet even inside the coach's live conversation region. */
export function ResponseTime({ timing }: { timing: ResponseTiming | null }) {
  const [showSeconds] = useGenerationDetails();
  if (!showSeconds || !timing) return null;
  const seconds = (timing.elapsedMs / 1000).toFixed(1);
  const label = timing.state === "waiting" ? `Waiting ${seconds}s`
    : timing.state === "failed" ? `Request failed after ${seconds}s` : `Response in ${seconds}s`;
  return <small className="response-time" role={timing.state === "waiting" ? "timer" : undefined}
    aria-live="off" title="Browser round-trip time, including network and backend work.">{label}</small>;
}

/** The animated "…" line shown while a helper waits on the AI. */
export function Thinking({ label }: { label: string }) {
  return <span className="thinking"><span className="thinking__dots" aria-hidden="true"><i /><i /><i /></span>{label}…</span>;
}

const STAGES: Record<string, string> = {
  context: "Loading child context and saved plan",
  masking: "Masking names for retrieval",
  retrieval: "Retrieving matching catalog goals",
  embedding: "Creating the search embedding",
  pinecone: "Searching Pinecone for matching goals",
  hydration: "Loading matched catalog cards",
  preparation: "Preparing the Coach input",
  generation: "Writing guidance and selecting goals",
  safety: "Reviewing the generated text",
  revision: "Revising the text after review",
  habit_generation: "Writing your habit steps",
  correction: "Correcting a habit after local checks",
  validation: "Checking habit and plan rules locally",
  planning: "Generating your routine plan",
  review: "Generating your weekly review",
  saving: "Saving the result",
  complete: "Request finished",
};

/** Stages only advance on backend events. A timer never invents backend progress. */
export function GenerationProgress({ timing }: { timing: ResponseTiming | null }) {
  const [showSeconds] = useGenerationDetails();
  if (!timing) return null;
  const stages = timing.stages ?? [];
  const current = stages.at(-1);
  const running = timing.state === "waiting";
  return <div className={`generation-progress ${running ? "is-running" : ""}`}>
    {running && <div role="status"><Thinking label={current ? STAGES[current.stage] ?? "Processing your request" : "Waiting for the server"} /></div>}
    <ResponseTime timing={timing} />
    {showSeconds && stages.length > 0 && <details className="generation-progress__details" open={running}>
      <summary>{running ? "Live generation stages" : "Generation timing breakdown"}</summary>
      <ol>{stages.map((stage, i) => {
        const next = stages[i + 1];
        const duration = next ? `${(Math.max(0, next.elapsed_ms - stage.elapsed_ms) / 1000).toFixed(1)}s` : running ? "In progress" : timing.state === "failed" ? "Interrupted" : "Finished";
        return <li key={`${i}:${stage.stage}`} className={!next && running ? "is-current" : ""}>
          <span>{STAGES[stage.stage] ?? "Processing your request"}</span><span>{duration}</span>
        </li>;
      })}</ol>
      <small>Stage durations come from the server. Total time includes the browser round trip.</small>
    </details>}
  </div>;
}
