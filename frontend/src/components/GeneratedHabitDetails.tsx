/** Accepted generated habits retain their reviewed instructions and their originating goal. */
import { useEffect, useRef, useState } from "react";
import { errorText, getGeneratedHabitDetails, type GeneratedHabitDraft, type HabitSetting, type SourceReference } from "../lib/api";
import { SettingPicker } from "./SettingPicker";
import { suggestHabitSetting } from "../lib/habitSetting";
import { HabitIcon } from "./HabitIcon";
import { GoalWorkbench } from "./GoalRecommendations";
import { catalogVisual, DurationBadge } from "./CatalogVisual";
import { CatalogVisual } from "./CatalogVisual";
import { CatalogDialog } from "./CatalogDialog";

export function GeneratedHabitDetails({ childId, childName, habitId, goalId, onChange }: {
  childId: string; childName: string; habitId: string; goalId: string; onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ goal_id: string; source: SourceReference; draft: GeneratedHabitDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [settingOverride, setSettingOverride] = useState<HabitSetting | null>(null);
  const visual = detail ? catalogVisual(detail.source) : undefined;
  const suggestedSetting = suggestHabitSetting(detail?.draft.cue, detail?.source.category_id, visual?.contexts);
  const setting = settingOverride ?? suggestedSetting.setting;
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function toggle() {
    setOpen((value) => !value);
    if (detail || open || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getGeneratedHabitDetails(childId, habitId);
      if (result.habit_id !== habitId || result.goal_id !== goalId || catalogVisual(result.source).goalId !== goalId) throw new Error("These details do not match this habit's saved goal. Refresh the plan before continuing.");
      if (alive.current) setDetail(result);
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <div className="generated-habit-reader">
    <button className="link-button" type="button" disabled={generating} aria-haspopup="dialog" aria-expanded={open} onClick={() => void toggle()}>Read habit details</button>
    {open && <CatalogDialog title={detail?.draft.kid_title ?? "Habit details"} onClose={() => setOpen(false)}>
      {busy && <p role="status">Loading habit details…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {detail && <>
        <div className="habit-detail-intro"><HabitIcon text={`${detail.draft.kid_title} ${detail.draft.instruction}`} iconKey={detail.draft.emoji_key} /><div><span className="catalog-category">Habit for {childName}</span><p>{detail.draft.instruction}</p><div className="catalog-badges"><DurationBadge seconds={detail.draft.estimated_seconds} /><span>In your plan</span></div></div></div>
        <div className="habit-draft__details"><section className="habit-draft__child"><h3>Small steps</h3><ol className="practice-steps">{detail.draft.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        <div className="habit-finish"><b>Done when</b><p>{detail.draft.completion}</p></div><p><b>Help:</b> {detail.draft.help_text}</p>
        {detail.draft.materials.length > 0 && <p><b>You need:</b> {detail.draft.materials.join(", ")}</p>}</section>
        <section className="habit-draft__parent"><h3>Grown-up guidance</h3>
        <p><b>Grown-up preparation:</b> {detail.draft.parent_setup}</p>
        <ol className="practice-steps"><li><b>Prepare:</b> {detail.draft.parent_guidance.prepare}</li><li><b>Coach:</b> {detail.draft.parent_guidance.coach}</li>
          <li><b>If it is hard:</b> {detail.draft.parent_guidance.if_hard}</li><li><b>Notice:</b> {detail.draft.parent_guidance.observe}</li></ol></section></div>
        <div className="approved-goal-reference"><CatalogVisual source={detail.source} compact /><div><span className="catalog-category">Linked goal</span><a href={`#/quests/${childId}/goal/${encodeURIComponent(goalId)}`} onClick={() => setOpen(false)}>{visual?.title ?? "View this goal"}</a></div></div>
        <SettingPicker value={setting} onChange={setSettingOverride} rationale={suggestedSetting.rationale} automatic={settingOverride === null}
          onAutomatic={() => setSettingOverride(null)} disabled={generating} allowed={visual?.contexts} label="Where will this goal help?" />
        <button className="btn btn--ghost btn--sm" type="button" disabled={generating} aria-expanded={goalOpen} onClick={() => setGoalOpen((value) => !value)}>{goalOpen ? "Close source goal" : "Explore this goal and more habits"}</button>
        {goalOpen && <GoalWorkbench key={`${childId}:${detail.goal_id}:${setting}`} childId={childId} childName={childName} goalId={detail.goal_id} setting={setting} onChange={onChange} onBusyChange={setGenerating} />}
      </>}
    </CatalogDialog>}
  </div>;
}
