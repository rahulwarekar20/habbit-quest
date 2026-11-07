import { buddyDisplayProps } from "../lib/buddyIdentity";
/**
 * Quest library (parent): a child's quests, up to six, each one row that can be retimed, rescheduled,
 * paused or removed. The default list can also be grouped by each quest's exact saved goal.
 * Below, "Add quests" filters the catalog and the family's own habits by goal and age.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import HabitCatalog from "../components/HabitCatalog";
import { GeneratedHabitDetails } from "../components/GeneratedHabitDetails";
import { PlanGoalDetails } from "../components/PlanGoalDetails";
import { catalogVisualForGoal, PlanGoalVisual } from "../components/CatalogVisual";
import { errorText, getPlan, updateChildHabit, type DayName, type Plan, type PlanHabit } from "../lib/api";
import { WORLDS } from "../lib/family";
import { DAY_PRESETS, WEEK, presetFor, toggleDay } from "../lib/schedule";
import { MAX_HABITS } from "../lib/plan";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

/** The Quest library page (#/quests[/:child]); the first child when none is given. */
export default function QuestLibrary({ childId, goalId }: { childId?: string; goalId?: string }) {
  const { family, server } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"quests" | "goals">("quests");
  const id = child?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setPlan(null);
    setError(null);
    getPlan(id).then((p) => live && setPlan(p)).catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id]);

  if (!child) return null;

  async function change(habit: PlanHabit, changes: Parameters<typeof updateChildHabit>[1]) {
    setError(null);
    try {
      setPlan(await updateChildHabit(habit.id, changes));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const progress = plan?.progress;
  const goalTitle = (id: string) => plan?.goals.find(goal => goal.goal_id === id)?.title ?? catalogVisualForGoal(id)?.title ?? "Goal details unavailable";
  const focusedGoal = goalId && plan && (plan.goals.some(goal => goal.goal_id === goalId && goal.status === "active") || plan.habits.some(habit => habit.goal_id === goalId));
  const shownHabits = plan?.habits.filter(habit => !goalId || habit.goal_id === goalId) ?? [];
  // Include independently saved empty goals and retain assignments whose goal metadata is missing.
  const goalIds = [...new Set([
    ...(plan?.goals.filter(goal => goal.status === "active").map(goal => goal.goal_id) ?? []),
    ...(plan?.habits.map(habit => habit.goal_id) ?? []),
  ])].filter(id => !goalId || id === goalId);
  const rows = (habits: PlanHabit[], grouped = false) => <QuestRows habits={habits} childId={child.id} childName={child.name}
    goalTitle={goalTitle} grouped={grouped} onChange={change} onRefresh={async () => setPlan(await getPlan(child.id))} />;
  return (
    <div className="page page--app">
      <ParentHeader active="quests" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <h1>Quests for {child.name}</h1>
            <p className="lead">
              Up to {MAX_HABITS} quests. Harder tiers unlock as {child.name} levels up.
              Not sure where to start? <a href={`#/coach/${child.id}`}>Ask the habit coach</a>.
            </p>
          </div>
        </div>

        {fam.children.length > 1 && (
          <div className="about" role="tablist" aria-label="Child">
            {fam.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} className={`about__chip ${c.id === child.id ? "is-on" : ""}`}
                onClick={() => go(`/quests/${c.id}`)}>
                <Buddy {...buddyDisplayProps(c)} accessory={c.wearing} size={24} /> {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="quest-library-views">
          <div className="quest-library-tabs" role="tablist" aria-label="Quest library view">
            {(["quests", "goals"] as const).map((tab, index) => <button key={tab} type="button" role="tab"
              id={`quest-view-${tab}`} aria-selected={view === tab} aria-controls="quest-library-plan"
              tabIndex={view === tab ? 0 : -1} onClick={() => setView(tab)} onKeyDown={event => {
                let next: number;
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") next = 1 - index;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = 1;
                else return;
                event.preventDefault();
                setView(next === 0 ? "quests" : "goals");
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
              }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                {tab === "quests" ? <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M3 6h1M3 12h1M3 18h1" strokeWidth="3" strokeLinecap="round" /></>
                  : <><rect x="3" y="3" width="18" height="6" rx="2" /><path d="M6 9v9h4M6 14h4" /><rect x="10" y="12" width="11" height="4" rx="1" /><rect x="10" y="18" width="11" height="3" rx="1" /></>}
              </svg>
              {tab === "quests" ? "Quests" : "By goal"}
            </button>)}
          </div>
          {plan && <span className="quest-library-count">{shownHabits.length} {shownHabits.length === 1 ? "quest" : "quests"} · {goalIds.length} {goalIds.length === 1 ? "goal" : "goals"}</span>}
        </div>

        {error && <p className="form-error">{error}</p>}
        {!plan && !error && <p className="empty">Loading {child.name}'s plan…</p>}

        {plan && (
          <>
            <section className={`panel${view === "goals" ? " quest-goals-panel" : ""}`} id="quest-library-plan"
              role="tabpanel" aria-labelledby={`quest-view-${view}`} tabIndex={0}>
              <div className="panel__head">
                <h2>{view === "quests" ? `${child.name}'s quests (${plan.habits.length}/${MAX_HABITS})` : `${child.name}'s goals`}</h2>
                {progress && (
                  <span className="chip">
                    Level {progress.level} · {progress.level_name}
                    {progress.next_level_at !== null ? ` · ${progress.next_level_at - progress.sparks} Sparks to go` : ""}
                  </span>
                )}
              </div>
              {goalId && <div className="plan-goal-focus" role="region" aria-label="Selected goal">
                {focusedGoal ? <><span className="catalog-category">Goal for {child.name}</span><h3>{goalTitle(goalId)}</h3><p>{shownHabits.length} {shownHabits.length === 1 ? "habit linked to this goal" : "habits linked to this goal"}.</p>
                  {goalId.startsWith("hqg-") && <PlanGoalDetails key={`${child.id}:${goalId}`} childId={child.id} goalId={goalId} title={goalTitle(goalId)} />}</>
                  : <p role="status">This goal is not in {child.name}'s saved plan.</p>}
                <a className="link-button" href={`#/quests/${child.id}`}>Show all habits</a>
              </div>}
              {view === "quests" ? (shownHabits.length === 0
                ? <p className="empty">{goalId ? "No habits assigned under this goal." : "No quests yet. Add some below."}</p>
                : rows(shownHabits)) : goalIds.length === 0 ? (
                  <p className="empty">No goals in this plan yet. Add quests below or <a href={`#/coach/${child.id}`}>ask the habit coach</a>.</p>
                ) : goalIds.map(id => {
                  const visual = catalogVisualForGoal(id);
                  const savedGoal = plan.goals.find(goal => goal.goal_id === id);
                  const habits = shownHabits.filter(habit => habit.goal_id === id);
                  const title = goalTitle(id);
                  return <article className="quest-goal-group" data-track={visual?.track ?? "development"} key={id}
                    aria-labelledby={`quest-goal-${id}`}>
                    <div className="quest-goal-head">
                      <PlanGoalVisual goalId={id} />
                      <div className="quest-goal-copy">
                        <span className="quest-goal-category">{visual?.categoryTitle ?? "Saved goal"}</span>
                        <h3 id={`quest-goal-${id}`}>{title}</h3>
                        <p>{visual?.description ?? savedGoal?.reason ?? (savedGoal ? "Small quests working toward this goal." : "Goal information is unavailable. These quests keep their saved goal link.")}</p>
                        <div className="quest-goal-meta">
                          {visual && <span>Ages {visual.age}</span>}
                          <span>{habits.length} {habits.length === 1 ? "quest" : "quests"}</span>
                          {id.startsWith("hqg-") && <PlanGoalDetails childId={child.id} goalId={id} title={title} />}
                        </div>
                      </div>
                    </div>
                    <div className="quest-goal-quests">
                      <p className="quest-goal-quests__label">Quests for this goal</p>
                      {habits.length ? rows(habits, true) : <p className="empty">No quests assigned to this goal yet.</p>}
                    </div>
                  </article>;
                })}
            </section>


            {server && (
              <section className="panel" id="catalog">
                <div className="panel__head"><h2>Add quests</h2></div>
                <HabitCatalog child={child} familyId={server.id} plan={plan} onPlan={setPlan} />
              </section>
            )}
          </>
        )}

        <p className="hint">Tier 2 quests open in {WORLDS[1].name} ({WORLDS[1].sparks} Sparks) and tier 3 in {WORLDS[2].name} ({WORLDS[2].sparks} Sparks). You can change this in Child details.</p>
      </main>
      <Footer />
    </div>
  );
}

/** The same assignment controls serve both views; grouping never creates a new assignment. */
function QuestRows({ habits, childId, childName, goalTitle, grouped, onChange, onRefresh }: {
  habits: PlanHabit[]; childId: string; childName: string; goalTitle: (id: string) => string; grouped: boolean;
  onChange: (habit: PlanHabit, changes: Parameters<typeof updateChildHabit>[1]) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <ul className="quest-rows">
      {habits.map((h) => (
        <li key={h.id} className={`quest-row ${h.status === "paused" ? "is-paused" : ""}`}>
          <HabitArt habit={h.habit_id} icon={h.icon} text={`${h.kid_title} ${h.kid_hint}`} className="quest-row__art" />
          <div className="quest-row__name">
            <b>{h.title}</b>
            {!grouped && <a className="link-button quest-row__goal" href={`#/quests/${childId}/goal/${encodeURIComponent(h.goal_id)}`}>Goal: {goalTitle(h.goal_id)}</a>}
            <span className="muted">Tier {h.tier} · {h.points} pts{h.status === "paused" ? " · Paused" : ""}</span>
            {h.habit_id.startsWith("my-ai-") && <GeneratedHabitDetails key={`${childId}:${h.habit_id}:${h.goal_id}`} childId={childId} childName={childName} habitId={h.habit_id} goalId={h.goal_id}
              onChange={onRefresh} />}
          </div>
          <input className="quest-row__time" type="time" defaultValue={h.cue_time} key={h.cue_time} aria-label={`Time for ${h.title}`}
            onBlur={(e) => { if (e.target.value && e.target.value !== h.cue_time) void onChange(h, { cue_time: e.target.value }); }} />
          <DayPicker title={h.title} days={h.days} onChange={(days) => onChange(h, { days })} />
          <span className="quest-row__actions">
            <button className="link-button" onClick={() => onChange(h, { status: h.status === "paused" ? "active" : "paused" })}>
              {h.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button className="link-button" onClick={() => onChange(h, { status: "removed" })}>Remove</button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Which days a quest runs on: a quick choice, or "Custom days" to tap any days. */
function DayPicker({ title, days, onChange }: { title: string; days: DayName[]; onChange: (days: DayName[]) => void }) {
  const preset = presetFor(days);
  const [custom, setCustom] = useState(!preset);
  return (
    <div className="day-picker">
      <select aria-label={`Days for ${title}`} value={custom ? "custom" : preset ?? "custom"}
        onChange={(e) => {
          const next = DAY_PRESETS.find((p) => p.label === e.target.value);
          setCustom(!next);
          if (next) onChange(next.days);
        }}>
        {DAY_PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}
        <option value="custom">Custom days</option>
      </select>
      {custom && (
        <div className="day-picker__days">
          {WEEK.map((d) => (
            <button key={d.id} type="button" aria-pressed={days.includes(d.id)} aria-label={d.short}
              className={days.includes(d.id) ? "is-on" : ""} onClick={() => onChange(toggleDay(days, d.id))}>
              {d.short[0]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
