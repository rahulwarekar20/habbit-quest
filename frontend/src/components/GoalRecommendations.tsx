/** Source goals retain their research and display their habit choices together. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptHabitDraft, errorText, generateHabitDrafts, getGoalSource, getHabitDrafts, getPlan, getChildToday, getGeneratedHabitDetails,
  updateChildHabit, updatePlanGoal, restorePlanHabit,
  type DayName, type GoalRecommendation, type GoalSource, type HabitDraftBatch, type Plan, type PlanGoal,
  type GeneratedHabitDraft, type HabitDraftItem, type HabitSetting, type RoutinePart,
} from "../lib/api";
import { useStore } from "../lib/store";
import { GenerationProgress, useResponseTimer } from "./AiParts";
import { CatalogVisual, catalogVisual, catalogVisualForGoal, DurationBadge, friendly, supportLabel } from "./CatalogVisual";
import { SettingPicker } from "./SettingPicker";
import { CatalogDialog } from "./CatalogDialog";
import { suggestHabitSetting } from "../lib/habitSetting";
import { HabitIcon } from "./HabitIcon";
import { applyToday } from "../lib/sync";
import { useGenerationDetails } from "../lib/generationPreferences";
import { GenerationDebit } from "./CoachingBudget";
import { refreshCoachingBudget } from "../lib/api/tokenomics";
const DAYS: DayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ROUTINES: RoutinePart[] = ["morning", "midday", "after_school", "evening", "bedtime"];
type PlanChange = (plan?: Plan) => Promise<void>;

export function GoalRecommendations({ cards, childId, childName, setting, disabled, onDismiss, onChange, prepareGoalIds = [], automaticSlots = [], habitQuote, latestGoalIds = [] }: {
  cards: GoalRecommendation[]; childId: string; childName: string; setting: HabitSetting; disabled: boolean;
  onDismiss: (card: GoalRecommendation) => void; onChange: () => Promise<void>; prepareGoalIds?: string[]; latestGoalIds?: string[];
  automaticSlots?: { goal_id: string; parent_operation_id: string }[]; habitQuote?: number;
}) {
  const { update } = useStore();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const queueParents = useRef<Record<string, string>>({});
  const requested = prepareGoalIds.join("|");
  const slotKey = automaticSlots.map(slot => `${slot.goal_id}:${slot.parent_operation_id}`).join("|");
  const shown = cards.map(card => card.goal_id).join("|");
  useEffect(() => { let live = true; getPlan(childId).then(value => { if (live) setPlan(value); }).catch(e => { if (live) setError(errorText(e)); }); return () => { live = false; }; }, [childId]);
  useEffect(() => { for (const slot of automaticSlots) queueParents.current[slot.goal_id] = slot.parent_operation_id; setQueue(previous => [...new Set([...previous, ...prepareGoalIds])]); }, [requested, slotKey]);
  useEffect(() => { setQueue(previous => previous.filter(id => cards.some(card => card.goal_id === id))); }, [shown]);
  const finished = useCallback((goalId: string) => { delete queueParents.current[goalId]; setQueue(previous => previous.filter(id => id !== goalId)); }, []);
  const refresh: PlanChange = async next => {
    setPlan(next ?? await getPlan(childId));
    const today = await getChildToday(childId);
    update(family => applyToday(family, today));
    await onChange();
  };
  async function removeHabit(id: string) {
    if (removing) return;
    setRemoving(id); setError(null);
    try { await refresh(await updateChildHabit(id, { status: "removed" })); }
    catch (e) { setError(errorText(e)); } finally { setRemoving(null); }
  }
  const capacity = plan?.capacity ?? { limit: 6, used: plan?.habits.length ?? 0, remaining: Math.max(0, 6 - (plan?.habits.length ?? 0)) };
  const uniqueCards = [...new Map(cards.filter(card => card.child_id === childId).map(card => [card.goal_id, card])).values()];
  const savedGoals = plan?.goals.filter(goal => goal.status === "active" && goal.goal_id.startsWith("hqg-")) ?? [];
  const savedIds = new Set(savedGoals.map(goal => goal.goal_id));
  // A newly recommended saved goal belongs with this response, once, in the model's order.
  // Keep all cards under the same keyed parent so moving between groups preserves draft state.
  const currentCards = uniqueCards.filter(card => latestGoalIds.includes(card.goal_id));
  const currentIds = new Set(currentCards.map(card => card.goal_id));
  const recommendations = uniqueCards.filter(card => !savedIds.has(card.goal_id) && !currentIds.has(card.goal_id));
  const otherSavedGoals = savedGoals.filter(goal => !currentIds.has(goal.goal_id));
  const renderGoal = (goalId: string, savedGoal?: PlanGoal) => {
    const card = uniqueCards.find(value => value.goal_id === goalId);
    return <GoalWorkbench key={`${childId}:${goalId}`} childId={childId} childName={childName} goalId={goalId}
      setting={card?.setting ?? (catalogVisualForGoal(goalId)?.contexts[0] ?? setting) as HabitSetting} onChange={onChange}
      recommendation={card} savedGoal={savedGoal} disabled={disabled} plan={plan} onPlanChange={refresh}
      recommendationState={card ? currentIds.has(goalId) ? "new" : "earlier" : undefined}
      parentOperationId={queueParents.current[goalId]} habitQuote={habitQuote} showAccounting={false}
      startWithGeneration={queue.slice(0, 2).includes(goalId)} queued={queue.includes(goalId) && !queue.slice(0, 2).includes(goalId)}
      onPrepared={() => finished(goalId)} onRequestPreparation={() => { delete queueParents.current[goalId]; setQueue(previous => previous.includes(goalId) ? previous : [...previous, goalId]); }}
      onDismiss={card ? () => onDismiss(card) : undefined} />;
  };
  return <section className="source-goals" aria-label={`Suggested goals for ${childName}`}>
    <div className="source-goals__grid">{[
      currentCards.length > 0 && <header key="current-heading" className="source-goals__group-heading"><h3>New recommendations</h3><p className="muted">From your latest Coach response. Goals already in the plan are marked as saved.</p></header>,
      ...currentCards.map(card => renderGoal(card.goal_id, savedGoals.find(goal => goal.goal_id === card.goal_id))),
      recommendations.length > 0 && <header key="recommendations-heading" className="source-goals__group-heading"><h3>{currentCards.length ? "Earlier recommendations" : "Coach recommendations"}</h3><p className="muted">Suggestions to explore. These goals and habit choices are not in {childName}'s plan until you add them.</p></header>,
      ...recommendations.map(card => renderGoal(card.goal_id)),
      plan && <header key="saved-heading" className="source-goals__group-heading source-goals__plan-heading"><h3>{savedGoals.length ? `Goals in ${childName}'s plan` : `${childName}'s plan`}</h3><p className="muted">Your saved goals and assigned habits.{savedGoals.some(goal => currentIds.has(goal.goal_id)) ? " Goals recommended again appear above with their saved label." : " New recommendations stay separate until you add them."}</p></header>,
      plan && <details key="plan-manager" className={`coach-plan-manager ${capacity.remaining === 0 ? "is-full" : ""}`} open={capacity.remaining === 0}>
      <summary>{childName}'s plan · {capacity.used} of {capacity.limit} habits <span>{capacity.remaining ? `${capacity.remaining} spaces available` : "Plan full — remove a habit to make room"}</span></summary>
      <p>Keep the habits that fit right now. Removing one keeps its history and makes room for another.</p>
      <ul>{plan.habits.map(habit => <li key={habit.id}><span><b>{habit.kid_title || habit.title}</b><small className="coach-plan-goal">Goal: <a href={`#/quests/${childId}/goal/${habit.goal_id}`}>{plan.goals.find(goal => goal.goal_id === habit.goal_id)?.title ?? catalogVisualForGoal(habit.goal_id)?.title ?? "Goal details unavailable"}</a></small><small>{habit.days.join(", ")} · {habit.cue_time}{habit.status === "paused" ? " · Paused" : ""}</small></span><button type="button" className="btn btn--ghost btn--sm" disabled={!!removing} onClick={() => void removeHabit(habit.id)} aria-label={`Remove ${habit.kid_title || habit.title} from plan`}>{removing === habit.id ? "Removing…" : "Remove"}</button></li>)}</ul>
      <a href={`#/quests/${childId}`}>Open the full plan</a>
    </details>,
      error && <p key="plan-error" className="form-error source-goals__plan-error" role="alert">{error}</p>,
      ...otherSavedGoals.map(goal => renderGoal(goal.goal_id, goal)),
    ]}</div>

  </section>;
}

/** Source reads and saved batches never spend; only a new user-triggered preparation does. */
export function GoalWorkbench({ childId, childName, goalId, setting, onChange, startWithGeneration = false, onBusyChange,
  recommendation, savedGoal, disabled = false, plan: sharedPlan, onPlanChange, onPrepared, onRequestPreparation, onDismiss, queued = false, recommendationState,
  parentOperationId, habitQuote, showAccounting = true,
}: {
  childId: string; childName: string; goalId: string; setting: HabitSetting; onChange: () => Promise<void>;
  startWithGeneration?: boolean; onBusyChange?: (busy: boolean) => void; recommendation?: GoalRecommendation; savedGoal?: PlanGoal; disabled?: boolean;
  plan?: Plan | null; onPlanChange?: PlanChange; onPrepared?: () => void; onRequestPreparation?: () => void; onDismiss?: () => void; queued?: boolean; recommendationState?: "new" | "earlier";
  parentOperationId?: string; habitQuote?: number; showAccounting?: boolean;
}) {
  const { update, server } = useStore();
  const [source, setSource] = useState<GoalSource | null>(null);
  const [batches, setBatches] = useState<HabitDraftBatch[]>([]);
  const [approved, setApproved] = useState<{ habitId: string; assignmentId: string; draft: GeneratedHabitDraft }[]>([]);
  const [approvedError, setApprovedError] = useState<string | null>(null);
  const [approvedReload, setApprovedReload] = useState(0);
  const [ownPlan, setOwnPlan] = useState<Plan | null>(null);
  const plan = sharedPlan === undefined ? ownPlan : sharedPlan;
  const [instruction, setInstruction] = useState("");
  const initialRequested = useRef(false);
  const prepared = useRef(onPrepared); prepared.current = onPrepared;
  const inFlight = useRef(false);
  const [showSeconds] = useGenerationDetails();
  const [settingOverride, setSettingOverride] = useState<HabitSetting | null>(null);
  const suggestedSetting = suggestHabitSetting(instruction, source?.source_ref.category_id, source?.contexts, setting);
  const generationSetting = settingOverride ?? suggestedSetting.setting;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const { timing, measure } = useResponseTimer("Habit generation");
  useEffect(() => { onBusyChange?.(busy); return () => { onBusyChange?.(false); }; }, [busy, onBusyChange]);
  useEffect(() => {
    alive.current = true; let cancelled = false; setLoading(true); setError(null);
    Promise.all([getGoalSource(childId, goalId, setting), getHabitDrafts(childId, goalId), sharedPlan === undefined ? getPlan(childId) : Promise.resolve(null)])
      .then(([card, saved, currentPlan]) => { if (!cancelled) {
        if (card.goal_id !== goalId || saved.batches.some(batch => batch.goal_id !== goalId || batch.child_id !== childId || batch.source.source_id !== card.source_ref.source_id)) throw new Error("The saved habits do not match this goal. Refresh the plan before continuing.");
        setSource(card); setBatches(saved.batches); if (currentPlan) setOwnPlan(currentPlan); } })
      .catch(e => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [childId, goalId, setting, reload, recommendation?.id]);
  const refreshPlan: PlanChange = async next => {
    if (onPlanChange) { await onPlanChange(next); return; }
    setOwnPlan(next ?? await getPlan(childId));
    const today = await getChildToday(childId);
    update(family => applyToday(family, today));
    await onChange();
  };
  async function generate(wanted = 3, automatic = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const parentId = automatic ? parentOperationId : undefined;
    const fingerprint = JSON.stringify({ setting: generationSetting, instruction, count: wanted, parentId });
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      let reported = false;
      const { value } = await measure(onProgress => generateHabitDrafts(childId, goalId, {
        request_id: request.current!.id, setting: generationSetting, parent_instruction: instruction.trim(), count: wanted,
        ...(parentId ? { parent_operation_id: parentId } : {}),
      }, event => { onProgress(event); if (!reported) { reported = true; refreshCoachingBudget(); } }));
      if (!alive.current) return;
      // A completed failed batch needs a new request; an uncertain transport failure keeps its identity.
      request.current = null;
      if (value.child_id !== childId || value.goal_id !== goalId || value.source.source_id !== source?.source_ref.source_id) throw new Error("The returned habits do not match this goal. Refresh the plan before continuing.");
      setBatches(previous => [value, ...previous.filter(batch => batch.id !== value.id)]);
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { inFlight.current = false; refreshCoachingBudget(); if (alive.current) setBusy(false); }
  }
  const ready = batches.filter(batch => batch.items.length > 0);
  const represented = ready.flatMap(batch => batch.items.flatMap(item => item.accepted_habit_id ? [item.accepted_habit_id] : []));
  const extraApproved = approved.filter(item => !represented.includes(item.habitId));
  const approvedToRead = plan?.habits.filter(habit => habit.goal_id === goalId && habit.habit_id.startsWith("my-ai-") && !represented.includes(habit.habit_id) && !approved.some(item => item.habitId === habit.habit_id)) ?? [];
  const approvedReadKey = approvedToRead.map(habit => habit.habit_id).join("|");
  useEffect(() => {
    if (loading || !approvedToRead.length) return;
    let live = true; setApprovedError(null);
    Promise.all(approvedToRead.map(async habit => {
      const details = await getGeneratedHabitDetails(childId, habit.habit_id);
      if (details.goal_id !== goalId || details.habit_id !== habit.habit_id || details.source.source_id !== source?.source_ref.source_id) throw new Error("The approved habit does not match this goal. Refresh the plan before continuing.");
      return { habitId: habit.habit_id, assignmentId: habit.id, draft: details.draft };
    }))
      .then(items => { if (live) setApproved(previous => [...previous.filter(item => !items.some(value => value.habitId === item.habitId)), ...items]); })
      .catch(e => { if (live) setApprovedError(errorText(e)); });
    return () => { live = false; };
  }, [loading, approvedReadKey, approvedReload, childId]);
  const existingCount = ready.reduce((sum, batch) => sum + batch.items.length, 0) + extraApproved.length;
  function reflectAcceptance(draftId: string, habitId: string, assignmentId: string) {
    setBatches(previous => previous.map(batch => ({ ...batch, items: batch.items.map(item => item.id === draftId ? { ...item, accepted_habit_id: habitId, child_habit_id: assignmentId } : item) })));
  }
  useEffect(() => {
    if (!startWithGeneration) { initialRequested.current = false; return; }
    if (loading || disabled || initialRequested.current) return;
    initialRequested.current = true;
    const hasUsableChoices = batches.some(batch => batch.items.length && (Date.parse(batch.expires_at) > Date.now() || batch.items.some(item => item.accepted_habit_id)));
    if (!source || hasUsableChoices) { prepared.current?.(); return; }
    void generate(3, true).finally(() => prepared.current?.());
  }, [loading, source, startWithGeneration, disabled]);
  const selected = plan?.goals.some(goal => goal.goal_id === goalId && goal.status === "active") ?? false;
  const goalHabitCount = plan?.habits.filter(habit => habit.goal_id === goalId).length ?? 0;
  async function toggleGoal() {
    if (!plan || savingGoal) return;
    setSavingGoal(true); setError(null);
    try { await refreshPlan(await updatePlanGoal(childId, goalId, selected ? "dropped" : "active", generationSetting)); }
    catch (e) { if (alive.current) setError(errorText(e)); } finally { if (alive.current) setSavingGoal(false); }
  }
  const visual = source ? catalogVisual(source.source_ref) : recommendation ? catalogVisual(recommendation.source_ref) : catalogVisualForGoal(goalId);
  const inCatalog = !!recommendation || !!savedGoal;
  const latest = batches[0];
  const earlierChoices = latest && ["stale_context", "expired"].includes(latest.outcome);
  const Wrapper = inCatalog ? "article" : "div";
  return <Wrapper className={inCatalog ? `source-goal source-goal--rich ${selected ? "is-selected" : ""}` : "goal-workbench"} data-track={visual?.track} data-goal-id={goalId} data-goal-state={selected ? "saved" : "recommended"}>
    {onDismiss && <button type="button" className="source-goal__dismiss" disabled={busy || disabled} onClick={onDismiss} aria-label="Hide this suggestion" title="Hide this suggestion">×</button>}
    {inCatalog && <><button type="button" className="source-goal__picture" onClick={() => setDetailsOpen(true)} aria-label={`Read goal details for ${source?.kid.title || visual?.title || recommendation?.title || savedGoal?.title}`}>
      {(source || recommendation) && <CatalogVisual source={source?.source_ref ?? recommendation!.source_ref} sizes="176px" />}<span className="source-goal__age">Ages {source ? `${source.age_min}–${source.age_max}` : visual?.age}</span>{selected && <span className="source-goal__saved">Saved goal · {goalHabitCount} {goalHabitCount === 1 ? "habit" : "habits"}</span>}
    </button><div className="source-goal__intro"><span className="catalog-category">{visual?.categoryTitle}</span><h4>{source?.kid.title || visual?.title || recommendation?.title || savedGoal?.title}</h4>
      <p>{source?.kid.description || visual?.description || recommendation?.description}</p>
      <div className="catalog-badges"><span>{friendly(generationSetting)}</span>{source && <DurationBadge seconds={source.practice.typical_seconds} />}</div>
      {recommendationState && <p className={`source-goal__origin ${recommendationState === "new" ? "is-new" : ""}`}>{recommendationState === "new" ? selected ? "Recommended again in this response" : "New this response" : selected ? "Also recommended by Coach" : "Earlier recommendation"}</p>}
    </div></>}
    {loading && <p className="source-goal__loading" role="status">Loading goal research and saved habits…</p>}
    {!loading && !source && <p className="form-error" role="alert">{error ?? "This goal is unavailable."} <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReload(n => n + 1)}>Retry loading goal</button></p>}
    {source && <div className={inCatalog ? "source-goal__body" : ""}>
      {!inCatalog && <div className="goal-workbench__heading"><div><span className="catalog-category">{visual?.categoryTitle}</span><h3>{source.kid.title}</h3><p>{source.kid.description}</p></div><CatalogVisual source={source.source_ref} compact /></div>}
      <section className="goal-research-summary" aria-label="Research behind this goal"><button type="button" className="link-button" onClick={() => setDetailsOpen(true)}>Research · {source.research.evidence.length} {source.research.evidence.length === 1 ? "source" : "sources"} ↗</button><p>{source.research.insight}</p></section>
      <div className="source-goal__actions">
        <button type="button" className="btn btn--ghost btn--sm" aria-label="Read goal details" aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>Details</button>
        {inCatalog && <button type="button" className="btn btn--primary btn--sm" disabled={disabled || !plan || savingGoal} onClick={() => void toggleGoal()} aria-label={selected ? goalHabitCount ? `Remove goal and ${goalHabitCount} ${goalHabitCount === 1 ? "habit" : "habits"}` : "Remove goal from plan" : "Add goal to plan"}>{savingGoal ? "Saving…" : selected ? "Remove goal" : "Add goal"}</button>}
      </div>
      {detailsOpen && <CatalogDialog title={source.kid.title} onClose={() => setDetailsOpen(false)}>
        <div className="goal-dialog-intro"><CatalogVisual source={source.source_ref} sizes="(max-width: 680px) 112px, 192px" /><div><span className="catalog-category">{visual?.categoryTitle}</span><p>{source.kid.description}</p>{(recommendation?.reason || savedGoal?.reason) && <p><b>Why this might help</b><br />{recommendation?.reason || savedGoal?.reason}</p>}</div></div>
        <GoalReader source={source} compact={false} />
      </CatalogDialog>}
      <section className="goal-generator" aria-label={`Habit choices for ${source.kid.title}`}>
        <div className="goal-generator__toolbar"><div><h4>Small habits</h4><p className="muted">{existingCount ? `${existingCount} choices for ${childName}` : queued ? "Waiting to prepare three choices…" : busy ? "Preparing three choices…" : "Three choices to try."}</p></div>
          {existingCount > 0 && <button type="button" className="chip chip--button more-choices" disabled={busy || queued || disabled} onClick={() => void generate(3)} title="Add up to three more choices; keep the existing habits">{busy || queued ? "Preparing choices…" : "More habit choices"}</button>}
        </div>
        {(timing?.state === "waiting" || showSeconds) && <GenerationProgress timing={timing} />}
        {showAccounting && habitQuote !== undefined && <p className="coaching-quote">{habitQuote} {habitQuote === 1 ? "credit" : "credits"} per useful batch of up to three choices.</p>}
        {showAccounting && <GenerationDebit value={latest?.tokenomics} familyId={server?.id} />}
        {error && <p className="form-error" role="alert">{error}</p>}
        {latest && !latest.items.length && (earlierChoices ? <p className="hint">Earlier unadded choices are no longer current. Habits already in the plan keep their approved instructions. Make fresh choices when you need them.</p>
          : <p className="form-error" role="alert">{latest.message || "No habits were returned. Try a new request."} {latest.outcome === "budget_unavailable" && <a href="#/family">Open generation settings</a>}</p>)}
        {!existingCount && !busy && !queued && <button type="button" className="btn btn--primary btn--sm" disabled={disabled} onClick={() => { if (!initialRequested.current && !batches.length && onRequestPreparation) onRequestPreparation(); else void generate(3); }}>{latest || error ? "Try generating habits" : "Make three habits"}</button>}
        <button type="button" className="link-button generation-options-trigger" aria-label="Adjust setting, add a note or make more choices" aria-haspopup="dialog" onClick={() => setOptionsOpen(true)}>Adjust generation</button>
        {optionsOpen && <CatalogDialog title={`Habit options · ${source.kid.title}`} onClose={() => setOptionsOpen(false)}>
          <div className="goal-generator generation-options">
            <label>Anything to keep in mind?<textarea value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={1500} disabled={busy} placeholder="For example: no writing, and use things we have." /></label>
            <SettingPicker value={generationSetting} onChange={setSettingOverride} rationale={suggestedSetting.rationale} automatic={settingOverride === null} onAutomatic={() => setSettingOverride(null)} disabled={busy} allowed={source.contexts} />
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || queued || disabled} onClick={() => { setOptionsOpen(false); void generate(3); }}>{busy ? "Preparing habits…" : existingCount ? "More habit choices" : "Make three habits"}</button>
            <small>Each request adds up to three habits. Existing choices stay here.</small>
          </div>
        </CatalogDialog>}
      </section>
      {approvedError && <p className="form-error" role="alert">Could not load approved habit details: {approvedError} <button type="button" className="link-button" onClick={() => setApprovedReload(value => value + 1)}>Retry reading habits</button></p>}
      <div className="habit-drafts__grid">{ready.flatMap(batch => batch.items.map(item => <DraftCard key={item.id} batch={batch} item={item} childId={childId} childName={childName} source={source} plan={plan} onPlanChange={refreshPlan} onAccepted={reflectAcceptance} />))}
        {extraApproved.map(item => <DraftCard key={`approved:${item.habitId}`} batch={{ id: "approved", child_id: childId, goal_id: goalId, status: "accepted", outcome: "accepted", source: source.source_ref, expires_at: "1970-01-01T00:00:00Z", items: [] }}
          item={{ id: `approved:${item.habitId}`, accepted_habit_id: item.habitId, child_habit_id: item.assignmentId, draft: item.draft }} childId={childId} childName={childName} source={source} plan={plan} onPlanChange={refreshPlan} />)}
      </div>
      {showSeconds && ready.map(batch => batch.timings?.total_ms !== undefined && <p className="response-time" key={batch.id}>Server generation: {(batch.timings.total_ms / 1000).toFixed(1)}s · {batch.items.length} {batch.items.length === 1 ? "habit" : "habits"}</p>)}
    </div>}
  </Wrapper>;
}

function ResearchDetails({ source }: { source: GoalSource }) {
  return <><p>{source.research.product_efficacy}</p>{source.research.evidence.map((e, i) => <div key={`${e.source_id}-${i}`} className="goal-evidence"><b>Source {i + 1}</b><p>{e.supports}</p>
    {e.does_not_establish && <p><b>Limits:</b> {e.does_not_establish}</p>}{e.age_transfer && <p>{e.age_transfer}</p>}
    {/^https?:\/\//.test(e.source_url) && <a href={e.source_url} target="_blank" rel="noreferrer">Read research source {i + 1} ↗</a>}
  </div>)}<p className="muted">Research informs the source goal. It does not prove the effectiveness of a generated habit.</p></>;
}

function Lines({ items }: { items: string[] }) {
  return items.length ? <ul>{items.map((line, index) => <li key={index}>{line}</li>)}</ul> : null;
}

/** Canonical parent reader preserves the source's support needs and evidence limitations. */
export function GoalReader({ source, compact }: { source: GoalSource; compact: boolean }) {
  return <div className="goal-reader">
    <div className="goal-reader__heading"><span className="catalog-category">The goal behind these habits</span><h4>{source.title}</h4></div>
    <div className="catalog-badges"><span>Ages {source.age_min}–{source.age_max}</span><DurationBadge seconds={source.practice.typical_seconds} /><span>{supportLabel(source.practice.support_level)}</span></div>
    {source.readiness_note && <p className="goal-support-note"><b>Readiness:</b> {source.readiness_note}</p>}
    <details className="goal-child-guide" open={!compact}><summary>Small steps for your child</summary>
      <h5>{source.kid.title}</h5><p>{source.kid.description}</p>
      <ol className="practice-steps">{source.kid.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol>
      {source.kid.help_phrase && <blockquote>{source.kid.help_phrase}</blockquote>}
      <div className="habit-finish"><b>A small finish</b><p>{source.practice.completion}</p></div>
      <p><b>An easier version:</b> {source.practice.easier_version}</p>
    </details>
    <details><summary>How to support this goal</summary>
      <p>{source.parent.selection_guidance}</p><h5>Set it up</h5><p>{source.parent.setup}</p>
      <ol className="practice-steps">{source.parent.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      {source.parent.say && <blockquote><b>Try saying:</b> {source.parent.say}</blockquote>}
      <h5>Your role</h5><p>{source.practice.adult_role}</p><p>{source.parent.review_guidance}</p>
    </details>
    <details><summary>Adaptations, support and care</summary>
      <Lines items={source.parent.adaptations} /><p><b>An optional stretch:</b> {source.practice.stretch_version}</p>
      <p><b>Where:</b> {source.contexts.map(friendly).join(", ")}</p><p><b>When:</b> {source.practice.timing_note}</p>
      <p>{source.practice.observation_rule}</p>
      {source.parent.avoid.length > 0 && <><b>Avoid</b><Lines items={source.parent.avoid} /></>}
      <Lines items={source.safety.not_for} />
      <p>Care and help stay available whether your child practises, pauses or declines.</p>
    </details>
    <details><summary>Research and limitations</summary>
      <p>{source.research.insight}</p><ResearchDetails source={source} />
      <p className="muted">{source.clinical_review_status.replaceAll("_", " ")}</p>
    </details>
  </div>;
}

function DraftCard({ batch, item, childId, childName, source, plan, onPlanChange, onAccepted }: {
  batch: HabitDraftBatch; item: HabitDraftItem; childId: string; childName: string; source: GoalSource; plan: Plan | null; onPlanChange: PlanChange;
  onAccepted?: (draftId: string, habitId: string, assignmentId: string) => void;
}) {
  const { askPinValue, server } = useStore();
  const today = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: server?.timezone ?? "UTC" }).format(new Date()).toLowerCase() as DayName;
  const [acceptedHabitId, setAcceptedHabitId] = useState(item.accepted_habit_id);
  const assignment = plan?.habits.find(habit => habit.habit_id === acceptedHabitId && habit.goal_id === source.goal_id);
  const accepted = !!assignment;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState("18:00");
  const [anchor, setAnchor] = useState<RoutinePart>("evening");
  const [days, setDays] = useState<DayName[]>(item.draft.recurrence === "daily" ? DAYS : [today]);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const expired = !acceptedHabitId && Date.parse(batch.expires_at) <= Date.now();
  const full = plan ? (plan.capacity?.remaining ?? Math.max(0, 6 - plan.habits.length)) === 0 : false;
  const draft = item.draft;
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function accept() {
    if (busy || accepted || !plan || full) return;
    setDetailsOpen(false);
    setBusy(true); setError(null);
    try {
      const pin = await askPinValue(`Add ${draft.kid_title} to ${childName}'s quests.`);
      if (pin === null || !alive.current) return;
      if (acceptedHabitId) {
        const next = await restorePlanHabit(childId, acceptedHabitId, pin, { cue_time: time, days });
        if (next.child_id !== childId || !next.habits.some(habit => habit.habit_id === acceptedHabitId && habit.goal_id === source.goal_id)) throw new Error("The habit could not be restored. Refresh the plan and try again.");
        await onPlanChange(next);
      } else {
        const result = await acceptHabitDraft(batch.id, item.id, pin, { cue_time: time, days, anchor });
        if (!alive.current) return;
        if (result.goal_id !== source.goal_id) throw new Error("The saved habit does not match this goal. Refresh the plan before continuing.");
        setAcceptedHabitId(result.habit_id);
        onAccepted?.(item.id, result.habit_id, result.child_habit_id);
        const next = await getPlan(childId);
        if (next.child_id !== childId || !next.habits.some(habit => habit.id === result.child_habit_id && habit.habit_id === result.habit_id && habit.goal_id === source.goal_id)) throw new Error("The assignment was not found in the refreshed plan. Refresh before trying again.");
        await onPlanChange(next);
      }
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove() {
    if (!assignment || busy) return;
    setBusy(true); setError(null);
    try { await onPlanChange(await updateChildHabit(assignment.id, { status: "removed" })); }
    catch (e) { if (alive.current) setError(errorText(e)); } finally { if (alive.current) setBusy(false); }
  }
  const controls = (compact: boolean) => accepted ? <div className="habit-draft__accepted">
    {!compact && <><span role="status">Added to {childName}'s quests{assignment.status === "paused" ? " · Paused" : ""}</span><a href={`#/quests/${childId}`}>View plan</a></>}
    <button type="button" className={compact ? "habit-preview__action is-added" : "btn btn--ghost btn--sm"} disabled={busy} onClick={() => void remove()} aria-label={`Remove ${draft.kid_title} from plan`} title="Remove from plan">{busy ? "…" : compact ? "−" : "Remove from plan"}</button>
  </div> : expired ? <span className="hint">Expired</span> : <button type="button" className={compact ? "habit-preview__action" : "btn btn--primary habit-add"} disabled={busy || !plan || full || !time || days.length === 0} onClick={() => void accept()} aria-label={`${acceptedHabitId ? "Add back" : "Add"} to ${childName}'s quests`} title={full ? "Plan full — remove a habit first" : "Add habit to plan"}>{busy ? "…" : compact ? "＋" : acceptedHabitId ? "Add back to plan" : "Add habit to plan"}</button>;
  return <article className={`habit-draft habit-preview ${accepted ? "is-accepted" : ""}`}>
    <div className="habit-preview__row"><button type="button" className="habit-preview__open" aria-haspopup="dialog" aria-label={`Read habit details for ${draft.kid_title}`} onClick={() => setDetailsOpen(true)}>
      <span className="habit-draft__art"><HabitIcon text={`${draft.kid_title} ${draft.instruction}`} iconKey={draft.emoji_key} /></span>
      <span className="habit-preview__copy"><span className="habit-preview__title">{draft.kid_title}</span><span className="habit-preview__meta">{Math.max(1, Math.round(draft.estimated_seconds / 60))} min · {draft.recurrence === "daily" ? "Daily" : "Weekly"}</span>{accepted && <span className="habit-preview__status" role="status">Added to {childName}'s quests{assignment.status === "paused" ? " · Paused" : ""}</span>}</span>
    </button>{controls(true)}</div>
    {error && !detailsOpen && <p className="form-error" role="alert">{error}</p>}
    {detailsOpen && <CatalogDialog title={draft.kid_title} onClose={() => setDetailsOpen(false)}>
      <div className="habit-detail-intro"><div className="habit-detail-media"><HabitIcon text={`${draft.kid_title} ${draft.instruction}`} iconKey={draft.emoji_key} /></div><div><span className="catalog-category">Small habit · For {childName}</span><p>{draft.instruction}</p><p className="habit-detail-goal"><span>Goal</span> <b>{source.kid.title}</b></p><div className="catalog-badges"><span>Ages {source.age_min}–{source.age_max}</span><DurationBadge seconds={draft.estimated_seconds} /><span>{draft.recurrence === "daily" ? "Every day" : "Weekly"}</span></div></div></div>
      <div className="habit-draft__details">      <section className="habit-draft__child"><h6>Small steps</h6><p><b>When:</b> {draft.cue}</p>
        <ol className="practice-steps">{draft.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        {draft.materials.length > 0 && <p><b>You need:</b> {draft.materials.join(", ")}</p>}
        <div className="habit-finish"><b>Done when</b><p>{draft.completion}</p></div>
        {draft.help_text && <blockquote><b>A way to ask for help</b><p>{draft.help_text}</p></blockquote>}
      </section>
      <section className="habit-draft__parent"><h6>Why this helps & grown-up guidance</h6><p>{draft.why || draft.description}</p><p>{draft.parent_setup}</p>
        <ol className="practice-steps"><li><b>Prepare:</b> {draft.parent_guidance.prepare}</li><li><b>Coach:</b> {draft.parent_guidance.coach}</li>
          <li><b>If it is hard:</b> {draft.parent_guidance.if_hard}</li><li><b>Notice:</b> {draft.parent_guidance.observe}</li></ol>
      </section>
      {!accepted && !expired && <section className="habit-schedule"><h6>Choose its place in the week</h6>
        <div className="habit-draft__schedule"><label>Time<input type="time" value={time} required onChange={e => setTime(e.target.value)} disabled={busy} /></label>
          <label>Part of the day<select value={anchor} onChange={e => setAnchor(e.target.value as RoutinePart)} disabled={busy}>
            {ROUTINES.map(part => <option key={part} value={part}>{part.replaceAll("_", " ")}</option>)}
          </select></label>
        </div>
        {draft.recurrence === "daily" ? <p className="muted">Every day</p> : <fieldset className="habit-draft__days"><legend>Practice days</legend>
          {DAYS.map(day => <label key={day}><input type="checkbox" checked={days.includes(day)} disabled={busy}
            onChange={() => setDays(previous => previous.includes(day) ? previous.filter(d => d !== day) : [...previous, day])} />{day}</label>)}
        </fieldset>}
      </section>}

      </div>
      <div className="habit-detail-actions">
        {!accepted && !expired && <><p className="habit-schedule-note">{days.includes(today) ? "On today’s plan" : `On ${days.map(day => day[0].toUpperCase() + day.slice(1)).join(", ")}`} · {time}</p>{full && <p className="habit-capacity-note">All {plan?.capacity?.limit ?? 6} spaces are in use. Remove a habit in the plan above, then add this one.</p>}</>}
        {expired && <p className="hint">This draft expired. Make fresh choices before adding a habit.</p>}
        {controls(false)}{error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </CatalogDialog>}
  </article>;
}
