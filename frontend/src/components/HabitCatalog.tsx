/**
 * "Add quests" in the Quest library: every catalog habit and the family's own, filtered by two
 * dropdowns (goal, and who it suits: this child by default, or an age group). Each habit says
 * whether it can join this child's plan now (age, unlocked tier, six-quest limit), and adding one
 * keeps the rest of the plan as it is. Habits the coach recommended are tagged. Custom habits suit
 * every age, open at tier 1, and are never sent to the AI provider.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  createCustomHabit, deleteCustomHabit, editCustomHabit, errorText, listCatalog, listCustomHabits, listGoals,
  type CatalogHabit, type CustomHabitInput, type Goal, type Plan, type RoutinePart,
} from "../lib/api";
import { MAX_HABITS, savePlan, withHabit } from "../lib/plan";
import HabitArt from "./HabitArt";

const AGES = [
  { id: "all", label: "All ages", min: 3, max: 13 },
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
const MINE = "mine";

type Child = { id: string; name: string; age: number };

/** Whether a habit passes the "Show" dropdown: ready for the child now ("ready": their age and unlocked
 * tier), any habit for their age ("child"), or an age group. */
export function suits(h: CatalogHabit, show: string, age: number, unlockedTier = 3): boolean {
  if (show === "ready") return h.min_age <= age && age <= h.max_age && h.tier <= unlockedTier;
  if (show === "child") return h.min_age <= age && age <= h.max_age;
  const range = AGES.find((a) => a.id === show) ?? AGES[0];
  return h.min_age <= range.max && h.max_age >= range.min;
}

export default function HabitCatalog({ child, familyId, plan, onPlan }: {
  child: Child;
  familyId: string;
  plan: Plan;
  onPlan: (plan: Plan) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogHabit[] | null>(null);
  const [custom, setCustom] = useState<CatalogHabit[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [show, setShow] = useState("ready");
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

  const recommended = useMemo(() => new Set(plan.goals.flatMap((g) => g.recommended_habit_ids)), [plan.goals]);
  const groups = useMemo(() => {
    const list: [string, CatalogHabit[]][] = [];
    if ((goal === "all" || goal === MINE) && custom.length) list.push(["Your family's habits", custom]);
    if (goal !== MINE) {
      const kept = (catalog ?? []).filter((h) => (goal === "all" || h.goal_id === goal) && suits(h, show, child.age, plan.progress.unlocked_tier));
      list.push(...groupBy(kept, (h) => h.goal_title).entries());
    }
    return list;
  }, [catalog, custom, goal, show, child.age, plan.progress.unlocked_tier]);
  const count = groups.reduce((n, [, habits]) => n + habits.length, 0);

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

  return (
    <div className="catalog">
      <div className="catalog__toolbar">
        <label className="catalog__filter">
          <span>Goal</span>
          <select id="catalog-goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="all">All goals</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            {custom.length > 0 && <option value={MINE}>Your family's habits</option>}
          </select>
        </label>
        <label className="catalog__filter">
          <span>Show</span>
          <select id="catalog-show" value={show} onChange={(e) => setShow(e.target.value)} disabled={goal === MINE}>
            <option value="ready">Ready for {child.name} now</option>
            <option value="child">Everything for age {child.age}</option>
            {AGES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <span className="catalog__count muted">{catalog ? `${count} ${count === 1 ? "habit" : "habits"}` : "Loading…"}</span>
        {editing === null && (
          <button type="button" className="btn btn--soft btn--sm catalog__create" onClick={() => { setEditing("new"); setNotice(null); }}>
            + Create your own
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-ok" role="status">{notice}</p>}
      {editing !== null && (
        <CustomHabitForm familyId={familyId} child={child} goals={goals} habit={editing === "new" ? null : editing}
          canAdd={plan.habits.length < MAX_HABITS} onCancel={() => setEditing(null)} onSaved={saved} />
      )}

      {catalog && count === 0 && <p className="empty">Nothing matches. Try another goal or age.</p>}
      {groups.map(([title, habits]) => (
        <section key={title} className="catalog__goal" aria-label={title}>
          <h4>{title}</h4>
          <div className="cat-grid">
            {habits.map((h) => (
              <HabitCard key={h.id} habit={h} status={standing(h, child, plan)} busy={busy === h.id} childName={child.name}
                recommended={recommended.has(h.id)} onAdd={() => add(h)}>
                {h.id.startsWith("my-") && (
                  <span className="cat-habit__more">
                    <button type="button" className="link-button" onClick={() => { setEditing(h); setNotice(null); }}>Edit</button>
                    <ConfirmButton label="Delete" confirmLabel="Delete for good" disabled={busy === h.id} onConfirm={() => remove(h)} />
                  </span>
                )}
              </HabitCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type Standing = { kind: "in" | "add" | "age" | "tier" | "full"; text: string };

/** Whether this habit can join the child's plan now, and if not, why (short, for the row's right edge). */
export function standing(h: CatalogHabit, child: Child, plan: Plan): Standing {
  if (plan.habits.some((p) => p.habit_id === h.id)) return { kind: "in", text: "Added" };
  if (child.age < h.min_age || child.age > h.max_age) return { kind: "age", text: `Ages ${h.min_age}–${h.max_age}` };
  if (h.tier > plan.progress.unlocked_tier) return { kind: "tier", text: `Unlocks at tier ${h.tier}` };
  if (plan.habits.length >= MAX_HABITS) return { kind: "full", text: "Plan full" };
  return { kind: "add", text: "" };
}

function HabitCard({ habit, status, busy, childName, recommended = false, onAdd, children }: {
  habit: CatalogHabit;
  status: Standing;
  busy: boolean;
  childName: string;
  recommended?: boolean;
  onAdd: () => void;
  children?: ReactNode;
}) {
  return (
    <article className={`cat-habit ${status.kind === "in" ? "is-added" : ""}`}>
      <HabitArt habit={habit.id} icon={habit.icon} className="cat-habit__art" />
      <div className="cat-habit__body">
        <b>{habit.title}</b>
        <span className="muted">
          {[`${habit.points} pts`, status.kind === "tier" && `Tier ${habit.tier}`, (habit.min_age > 3 || habit.max_age < 13) && `Ages ${habit.min_age}–${habit.max_age}`]
            .filter(Boolean).join(" · ")}
          {recommended && <span className="cat-habit__tag">Recommended</span>}
        </span>
        {children}
      </div>
      <div className="cat-habit__action">
        {status.kind === "add" ? (
          <button type="button" className="cat-habit__add" disabled={busy} onClick={onAdd} aria-label={`Add ${habit.title} to ${childName}`}>
            {busy ? "Adding…" : "+ Add"}
          </button>
        ) : (
          <span className={`catalog__status catalog__status--${status.kind}`}>{status.text}</span>
        )}
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
  if (!asking) return <button type="button" className="link-button" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <>
      <button type="button" className="link-button link-button--danger" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" className="link-button" onClick={() => setAsking(false)}>Keep it</button>
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
      <h4>{habit ? `Edit “${habit.title}”` : "Create your own habit"}</h4>
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
      <p className="muted">Kids read this, so keep it kind and free of phone numbers, addresses or links. It suits every age and earns the points of a tier 1 quest. It stays private to your family and is never sent to the AI coach.</p>
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
