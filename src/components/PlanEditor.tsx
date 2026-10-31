/**
 * Picks a child's habits: each goal with its reason and options, recommended ones ticked, at most
 * six in all, and other goals can be added from the catalog. Saving replaces the plan.
 */
import { useEffect, useMemo, useState } from "react";
import { errorText, listGoalHabits, listGoals, type Goal, type Plan, type PlanGoal } from "../lib/api";
import { MAX_HABITS, initialPicks, planInput, savePlan } from "../lib/plan";
import HabitArt from "./HabitArt";

export default function PlanEditor({ child, plan, onSaved, confirm, showCatalog = false }: {
  child: { id: string; name: string; age: number };
  plan: Plan;
  onSaved: (plan: Plan) => void;
  confirm?: () => Promise<boolean>; // e.g. the parent PIN
  showCatalog?: boolean; // open the goal list straight away
}) {
  const [picks, setPicks] = useState<string[]>(() => initialPicks(plan));
  const [extra, setExtra] = useState<PlanGoal[]>([]);
  const [catalog, setCatalog] = useState<Goal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPicks(initialPicks(plan));
    setExtra([]);
  }, [plan]);

  useEffect(() => {
    if (showCatalog) listGoals().then(setCatalog).catch((e) => setError(errorText(e)));
  }, [showCatalog]);

  const goals = useMemo(() => [...plan.goals, ...extra.filter((g) => !plan.goals.some((p) => p.goal_id === g.goal_id))], [plan.goals, extra]);
  const left = catalog?.filter((g) => !goals.some((p) => p.goal_id === g.id)) ?? [];
  const full = picks.length >= MAX_HABITS;

  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function openCatalog() {
    try {
      setCatalog(await listGoals());
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function addGoal(goal: Goal) {
    setError(null);
    try {
      const options = await listGoalHabits(goal.id, child.age, plan.progress.unlocked_tier);
      setExtra((list) => [...list, { goal_id: goal.id, title: goal.title, status: "suggested", reason: goal.description, recommended_habit_ids: [], options }]);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function save() {
    if (confirm && !(await confirm())) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await savePlan(child.id, plan, planInput(plan, goals, picks)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plan-editor">
      {goals.length === 0 && <p className="empty">No goals yet for {child.name}. Pick one below.</p>}
      {goals.map((goal) => (
        <div key={goal.goal_id} className="recs">
          <div className="recs__head">
            <b>{goal.title}</b>
            {goal.status === "active" && <span className="chip">In the plan</span>}
          </div>
          {goal.reason && <p className="muted">{goal.reason}</p>}
          {goal.options.length === 0 ? (
            <p className="empty">Nothing here suits {child.name} yet.</p>
          ) : (
            <ul className="recs__list">
              {goal.options.map((o) => {
                const on = picks.includes(o.id);
                return (
                  <li key={o.id} className={`rec ${on ? "is-on" : ""}`}>
                    <label>
                      <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(o.id)} />
                      <HabitArt habit={o.id} className="rec__art" />
                      <span className="rec__text">
                        <b>{o.title}</b>
                        <small className="tier-tag">Tier {o.tier} · {o.points} pts</small>
                        {o.recommended && <small className="tier-tag">Recommended</small>}
                        <span className="muted">{o.description}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      <div className="plan-editor__goals">
        {catalog === null ? (
          <button type="button" className="chip chip--button" onClick={openCatalog}>Add another goal</button>
        ) : left.length > 0 ? (
          <>
            <span className="muted">Add a goal:</span>
            {left.map((g) => <button type="button" key={g.id} className="chip chip--button" title={g.description} onClick={() => addGoal(g)}>{g.title}</button>)}
          </>
        ) : null}
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="recs__actions">
        <span className="muted">{picks.length} of {MAX_HABITS} quests chosen</span>
        <button type="button" className="btn btn--primary" disabled={busy || (picks.length === 0 && plan.habits.length === 0)} onClick={save}>
          {busy ? "Saving…" : `Save ${child.name}'s plan`}
        </button>
      </div>
    </div>
  );
}
