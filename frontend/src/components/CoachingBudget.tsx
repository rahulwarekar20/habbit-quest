import { useEffect, useRef, useState } from "react";
import { getCoachingBudget, getGenerationAccounting, type CoachingBudget as Budget, type GenerationAccounting } from "../lib/api/tokenomics";
import { errorText } from "../lib/api/client";

export function useCoachingBudget(familyId?: string, childId?: string) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    let live = true;
    setBudget(null); setError(null);
    const refresh = () => {
      if (!familyId) return;
      const seq = ++sequence.current;
      void getCoachingBudget(familyId).then(value => { if (live && seq === sequence.current) { setBudget(value); setError(null); } })
        .catch(e => { if (live && seq === sequence.current) setError(errorText(e)); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("hq:coaching-budget", refresh);
    return () => { live = false; window.removeEventListener("focus", refresh); window.removeEventListener("hq:coaching-budget", refresh); };
  }, [familyId, childId]);
  return { budget, error };
}

export function CoachingBudgetMeter({ budget, error, compact = false }: { budget: Budget | null; error?: string | null; compact?: boolean }) {
  if (!budget) return error ? <p className="muted coaching-meter__error">Coaching allowance unavailable. {error}</p> : <p className="muted coaching-meter__error">Loading coaching allowance…</p>;
  const overage = Math.max(budget.overage, budget.used - budget.allowance, 0);
  const balance = overage > 0 ? `${overage} over allowance` : `${Math.max(0, budget.remaining)} left`;
  const usage = `${budget.used} / ${budget.allowance} credits used`;
  const mode = budget.enforced ? "Limits enforced" : "Demo mode · limits are not enforced";
  return <div className={`coaching-meter ${compact ? "coaching-meter--compact" : ""}`} aria-label="Daily coaching allowance" title={`${usage} · ${balance} · ${mode}. Resets ${new Date(budget.reset_at).toLocaleString()}`}>
    <span className="coaching-meter__label">Credits</span>
    <span className="coaching-meter__usage" aria-label={usage} aria-live="polite" aria-atomic="true">{budget.used} / {budget.allowance}</span>
    <progress aria-label="Coaching credits used" max={Math.max(1, budget.allowance)} value={Math.min(budget.allowance, budget.used)}
      aria-valuetext={`${budget.used} of ${budget.allowance} credits used; ${balance}${budget.pending ? `; ${budget.pending} pending` : ""}`} />
    <span className={`coaching-meter__mode ${budget.enforced ? "is-enforced" : ""}`} aria-label={mode} title={mode}>{budget.enforced ? "Limits on" : "Demo · limits off"}</span>
    {budget.pending > 0 && <small title="Reserved credits for generations still running">{budget.pending} pending</small>}
    {overage > 0 && <span className="coaching-meter__overage" aria-label={`${overage} ${overage === 1 ? "credit" : "credits"} over the allowance`}>+{overage} over</span>}
    {error && <small role="status" title="Couldn’t refresh usage. Showing the last balance.">Not updated</small>}
  </div>;
}

export function GenerationDebit({ value, familyId }: { value?: GenerationAccounting; familyId?: string }) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    let live = true; setCurrent(value);
    const refresh = () => { if (familyId && value) void getGenerationAccounting(familyId, value.operation_id).then(next => { if (live) setCurrent(next); }).catch(() => {}); };
    window.addEventListener("hq:coaching-budget", refresh); window.addEventListener("focus", refresh);
    return () => { live = false; window.removeEventListener("hq:coaching-budget", refresh); window.removeEventListener("focus", refresh); };
  }, [value, familyId]);
  if (!current) return null;
  const showCost = current.budget.show_costs && current.estimated_cost_usd !== undefined;
  return <p className="generation-debit" aria-label="Generation accounting">
    {current.credits} {current.credits === 1 ? "credit" : "credits"} used{current.pending_credits ? ` · ${current.pending_credits} pending` : ""}
    {showCost && <> · {current.estimated_cost_usd === null ? "Cost not available" : `Estimated cost $${Number(current.estimated_cost_usd).toFixed(8)}`} ({current.cost_status ?? "estimate"})</>}
    {!current.parent_operation_id && current.interaction && <><br />Including prepared habits: {current.interaction.credits} used · {current.interaction.pending_credits} pending
      {current.budget.show_costs && current.interaction.estimated_cost_usd !== undefined && current.interaction.estimated_cost_usd !== null && <> · ${Number(current.interaction.estimated_cost_usd).toFixed(8)} ({current.interaction.cost_status ?? "estimate"}{current.interaction.batches_pending > 0 ? "; preparing choices" : ""})</>}
    </>}
  </p>;
}
