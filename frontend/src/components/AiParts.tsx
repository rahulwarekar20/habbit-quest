/**
 * Small pieces the AI helper cards and the habit coach share: running one helper call with
 * loading and error state, and the animated "thinking" line.
 */
import { useState } from "react";
import { errorText } from "../lib/api";

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

export function Thinking({ label }: { label: string }) {
  return <span className="thinking"><span className="thinking__dots" aria-hidden="true"><i /><i /><i /></span>{label}…</span>;
}
