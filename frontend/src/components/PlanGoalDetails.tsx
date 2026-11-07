/** Read the exact saved source goal. Opening this reader makes no generation request. */
import { useState } from "react";
import { errorText, getGoalSource, type GoalSource, type HabitSetting } from "../lib/api";
import { CatalogDialog } from "./CatalogDialog";
import { CatalogVisual, catalogVisual, catalogVisualForGoal } from "./CatalogVisual";
import { GoalReader } from "./GoalRecommendations";

export function PlanGoalDetails({ childId, goalId, title }: { childId: string; goalId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<GoalSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function read() {
    setOpen(true);
    if (source || busy) return;
    setBusy(true); setError(null);
    try {
      const setting = (catalogVisualForGoal(goalId)?.contexts[0] ?? "home") as HabitSetting;
      const value = await getGoalSource(childId, goalId, setting);
      if (value.goal_id !== goalId || catalogVisual(value.source_ref).goalId !== goalId) throw new Error("The source did not match this goal. Please refresh the plan.");
      setSource(value);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="link-button" aria-haspopup="dialog" onClick={() => void read()}>Read goal details</button>
    {open && <CatalogDialog title={title} onClose={() => setOpen(false)}>
      {busy && <p role="status">Loading goal details…</p>}
      {error && <p role="alert">{error} <button className="link-button" onClick={() => void read()}>Retry loading goal</button></p>}
      {source && <><div className="goal-dialog-intro"><CatalogVisual source={source.source_ref} sizes="192px" /><div><span className="catalog-category">Goal</span><h3>{source.kid.title}</h3><p>{source.kid.description}</p></div></div><GoalReader source={source} compact={false} /></>}
    </CatalogDialog>}
  </>;
}
