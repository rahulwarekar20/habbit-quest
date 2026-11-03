/**
 * Browse every habit by age group, and the family's own custom habits, from the Quest library.
 * Each habit says whether it can join this child's plan now (age, unlocked tier, six-quest limit),
 * and adding one keeps the rest of the plan as it is. Custom habits suit every age, open at tier 1,
 * and are never sent to the AI provider.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  createCustomHabit, deleteCustomHabit, editCustomHabit, errorText, listCatalog, listCustomHabits, listGoals,
  type CatalogHabit, type CustomHabitInput, type Goal, type Plan, type RoutinePart,
} from "../lib/api";
import { MAX_HABITS, savePlan, withHabit } from "../lib/plan";
import HabitArt from "./HabitArt";

const BANDS = [
  { id: "3-5", label: "Ages 3–5", min: 3, max: 5 },
  { id: "6-8", label: "Ages 6–8", min: 6, max: 8 },
  { id: "9-13", label: "Ages 9–13", min: 9, max: 13 },
];
const PARTS: { id: RoutinePart; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "midday", label: "Midday" },
  { id: "after_school", label: "After school" },
  { id: "evening", label: "Evening" },
  { id: "bedtime", label: "Bedtime" },
];
const EMOJI = ["⭐", "🎹", "🐶", "🐱", "🪴", "🎨", "⚽", "🧩", "🧺", "🙏", "💧", "🚲"];

type Child = { id: string; name: string; age: number };

export default function HabitCatalog({ child, familyId, plan, onPlan }: {
  child: Child;
  familyId: string;
  plan: Plan;
  onPlan: (plan: Plan) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogHabit[] | null>(null);
  const [custom, setCustom] = useState<CatalogHabit[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [band, setBand] = useState(() => BANDS.find((b) => child.age <= b.max)!.id);
  const [goal, setGoal] = useState<string>("all");
  const [editing, setEditing] = useState<CatalogHabit | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([listCatalog(), listCustomHabits(familyId), listGoals()])
      .then(([all, mine, goalList]) => {
        if (!live) return;
        setCatalog(all);
        setCustom(mine);
        setGoals(goalList);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [familyId]);

  useEffect(() => setBand(BANDS.find((b) => child.age <= b.max)!.id), [child.age]);

  const range = BANDS.find((b) => b.id === band)!;
  const inBand = useMemo(
    () => (catalog ?? []).filter((h) => h.min_age <= range.max && h.max_age >= range.min),
    [catalog, range],
  );
  const shown = inBand.filter((h) => goal === "all" || h.goal_id === goal);
  const byGoal = groupBy(shown, (h) => h.goal_title);
  const goalChoices = [...new Map(inBand.map((h) => [h.goal_id, h.goal_title])).entries()];

  async function add(habit: CatalogHabit) {
    setBusy(habit.id);
    setError(null);
    setNotice(null);
    try {
      onPlan(await savePlan(child.id, plan, withHabit(plan, habit)));
      setNotice(`${habit.title} added to ${child.name}'s quests.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(habit: CatalogHabit) {
    setBusy(habit.id);
    setError(null);
    try {
      await deleteCustomHabit(habit.id);
      setCustom((list) => list.filter((h) => h.id !== habit.id));
      if (plan.habits.some((h) => h.habit_id === habit.id)) onPlan({ ...plan, habits: plan.habits.filter((h) => h.habit_id !== habit.id) });
      setNotice(`${habit.title} deleted.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function saved(habit: CatalogHabit, addNow: boolean) {
    const wasNew = editing === "new";
    setCustom((list) => (wasNew ? [habit, ...list] : list.map((h) => (h.id === habit.id ? habit : h))));
    setEditing(null);
    if (!wasNew && plan.habits.some((h) => h.habit_id === habit.id)) {
      onPlan({ ...plan, habits: plan.habits.map((h) => (h.habit_id === habit.id ? { ...h, ...habit, id: h.id } : h)) });
    }
    if (addNow) await add(habit);
    else setNotice(wasNew ? `${habit.title} created.` : `${habit.title} saved.`);
  }

  const status = (h: CatalogHabit) => standing(h, child, plan);

  return (
    <div className="catalog">
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-ok" role="status">{notice}</p>}

      <section className="catalog__block" aria-labelledby="family-habits">
        <div className="catalog__head">
          <div>
            <h3 id="family-habits">Your family's habits</h3>
            <p className="muted">Habits you make yourself, for any of your children. They stay private to your family and are never sent to the AI coach.</p>
          </div>
          {editing === null && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => { setEditing("new"); setNotice(null); }}>
              Create a habit
            </button>
          )}
        </div>
        {editing !== null && (
          <CustomHabitForm familyId={familyId} child={child} goals={goals} habit={editing === "new" ? null : editing}
            canAdd={plan.habits.length < MAX_HABITS} onCancel={() => setEditing(null)} onSaved={saved} />
        )}
        {custom.length === 0 && editing === null ? (
          <p className="empty">No custom habits yet. Create one for something the catalog doesn't cover, like practising an instrument or feeding a pet.</p>
        ) : (
          <div className="lib-grid">
            {custom.map((h) => (
              <HabitCard key={h.id} habit={h} status={status(h)} busy={busy === h.id} childName={child.name} onAdd={() => add(h)}>
                <div className="lib-card__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditing(h); setNotice(null); }}>Edit</button>
                  <ConfirmButton label="Delete" confirmLabel="Delete for good" disabled={busy === h.id} onConfirm={() => remove(h)} />
                </div>
              </HabitCard>
            ))}
          </div>
        )}
      </section>

      <section className="catalog__block" aria-labelledby="all-habits">
        <div className="catalog__head">
          <div>
            <h3 id="all-habits">All habits by age</h3>
            <p className="muted">The pre-approved catalog. {child.name} is {child.age}, so {BANDS.find((b) => child.age <= b.max)!.label.toLowerCase()} opens first.</p>
          </div>
        </div>
        <div className="about" role="tablist" aria-label="Age group">
          {BANDS.map((b) => {
            const count = (catalog ?? []).filter((h) => h.min_age <= b.max && h.max_age >= b.min).length;
            return (
              <button key={b.id} type="button" role="tab" aria-selected={b.id === band} className={`about__chip catalog__tab ${b.id === band ? "is-on" : ""}`}
                onClick={() => { setBand(b.id); setGoal("all"); }}>
                {b.label} <small>{catalog ? count : "…"}</small>
              </button>
            );
          })}
        </div>
        <div className="catalog__filters" aria-label="Goal">
          <button type="button" className={`chip chip--button ${goal === "all" ? "is-on" : ""}`} aria-pressed={goal === "all"} onClick={() => setGoal("all")}>All goals</button>
          {goalChoices.map(([id, title]) => (
            <button type="button" key={id} className={`chip chip--button ${goal === id ? "is-on" : ""}`} aria-pressed={goal === id} onClick={() => setGoal(id)}>{title}</button>
          ))}
        </div>
        {!catalog && !error && <p className="empty">Loading the catalog…</p>}
        {[...byGoal.entries()].map(([title, habits]) => (
          <div key={title} className="catalog__goal">
            <h4>{title} <span className="muted">{habits.length}</span></h4>
            <div className="lib-grid">
              {habits.map((h) => (
                <HabitCard key={h.id} habit={h} status={status(h)} busy={busy === h.id} childName={child.name} onAdd={() => add(h)} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

type Standing = { kind: "in" | "add" | "age" | "tier" | "full"; text: string };

/** Whether this habit can join the child's plan now, and if not, why. */
export function standing(h: CatalogHabit, child: Child, plan: Plan): Standing {
  if (plan.habits.some((p) => p.habit_id === h.id)) return { kind: "in", text: `In ${child.name}'s quests` };
  if (child.age < h.min_age || child.age > h.max_age) return { kind: "age", text: `For ages ${h.min_age}–${h.max_age}` };
  if (h.tier > plan.progress.unlocked_tier) return { kind: "tier", text: `Unlocks at tier ${h.tier}` };
  if (plan.habits.length >= MAX_HABITS) return { kind: "full", text: `${child.name} has ${MAX_HABITS} quests` };
  return { kind: "add", text: "" };
}

function HabitCard({ habit, status, busy, childName, onAdd, children }: {
  habit: CatalogHabit;
  status: Standing;
  busy: boolean;
  childName: string;
  onAdd: () => void;
  children?: ReactNode;
}) {
  return (
    <article className={`lib-card ${status.kind === "in" ? "is-added" : ""}`}>
      <HabitArt habit={habit.id} icon={habit.icon} />
      <div className="lib-card__body">
        <b>{habit.title}</b>
        <span className="muted">{habit.goal_title} · Tier {habit.tier} · {habit.points} pts · Ages {habit.min_age}–{habit.max_age}</span>
        {habit.kid_title !== habit.title && <p>Kids see: “{habit.kid_title}”</p>}
        {status.kind === "add" ? (
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onAdd}>
            {busy ? "Adding…" : `Add to ${childName}`}
          </button>
        ) : (
          <span className={`catalog__status catalog__status--${status.kind}`}>{status.text}</span>
        )}
        {children}
      </div>
    </article>
  );
}

function ConfirmButton({ label, confirmLabel, disabled, onConfirm }: {
  label: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <>
      <button type="button" className="btn btn--danger btn--sm" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAsking(false)}>Keep it</button>
    </>
  );
}

function CustomHabitForm({ familyId, child, goals, habit, canAdd, onCancel, onSaved }: {
  familyId: string;
  child: Child;
  goals: Goal[];
  habit: CatalogHabit | null;
  canAdd: boolean;
  onCancel: () => void;
  onSaved: (habit: CatalogHabit, addNow: boolean) => void;
}) {
  const [form, setForm] = useState<CustomHabitInput>(() => ({
    goal_id: habit?.goal_id ?? goals[0]?.id ?? "",
    title: habit?.title ?? "",
    kid_title: habit && habit.kid_title !== habit.title ? habit.kid_title : "",
    kid_hint: habit?.kid_hint ?? "",
    icon: habit?.icon ?? "⭐",
    anchor: habit?.anchor ?? "evening",
  }));
  const [addNow, setAddNow] = useState(!habit && canAdd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CustomHabitInput>(key: K, value: CustomHabitInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = habit ? await editCustomHabit(habit.id, form) : await createCustomHabit(familyId, form);
      onSaved(saved, addNow);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="form catalog__form" onSubmit={submit}>
      <h4>{habit ? `Edit “${habit.title}”` : "Create a habit"}</h4>
      <div className="field-row">
        <label className="field">
          <span>Habit</span>
          <input id="custom-title" required maxLength={60} value={form.title} placeholder="Practise piano for 10 minutes"
            onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="field">
          <span>What your child sees (optional)</span>
          <input id="custom-kid-title" maxLength={40} value={form.kid_title} placeholder="Piano time!"
            onChange={(e) => set("kid_title", e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span className="field__label">Picture</span>
        <div className="emoji-picker" role="radiogroup" aria-label="Picture">
          {EMOJI.map((emoji) => (
            <button type="button" key={emoji} role="radio" aria-checked={form.icon === emoji} className={form.icon === emoji ? "is-on" : ""}
              onClick={() => set("icon", emoji)}>{emoji}</button>
          ))}
          <input id="custom-icon" aria-label="Or type any emoji" maxLength={8} value={EMOJI.includes(form.icon) ? "" : form.icon}
            placeholder="Other" onChange={(e) => set("icon", e.target.value || "⭐")} />
        </div>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Goal it helps with</span>
          <select id="custom-goal" value={form.goal_id} onChange={(e) => set("goal_id", e.target.value)}>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Part of the day</span>
          <select id="custom-anchor" value={form.anchor} onChange={(e) => set("anchor", e.target.value as RoutinePart)}>
            {PARTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>A short nudge for your child (optional)</span>
        <input id="custom-hint" maxLength={80} value={form.kid_hint} placeholder="Play your favourite song first"
          onChange={(e) => set("kid_hint", e.target.value)} />
      </label>
      {!habit && (
        <label className="check">
          <input id="custom-add-now" type="checkbox" checked={addNow} disabled={!canAdd} onChange={(e) => setAddNow(e.target.checked)} />
          <span>{canAdd ? `Add it to ${child.name}'s quests now` : `${child.name} already has ${MAX_HABITS} quests; remove one to add this`}</span>
        </label>
      )}
      <p className="muted">Kids read this, so keep it kind and free of phone numbers, addresses or links. It suits every age and earns the points of a tier 1 quest.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="lib-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !form.title.trim() || !form.goal_id}>
          {busy ? "Saving…" : habit ? "Save changes" : "Create habit"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}
