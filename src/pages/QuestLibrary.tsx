/**
 * Quest library (parent): a child's plan. The quests in it can be retimed, paused or removed one
 * at a time; goals and their options choose what's in the plan, up to six quests. Harder tiers
 * appear as the child levels up, and options already suit the child's age.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import PlanEditor from "../components/PlanEditor";
import { errorText, getPlan, updateChildHabit, type DayName, type Plan, type PlanHabit } from "../lib/api";
import { WORLDS } from "../lib/family";
import { DAY_PRESETS, WEEK, presetFor, toggleDay } from "../lib/schedule";
import { MAX_HABITS } from "../lib/plan";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export default function QuestLibrary({ childId }: { childId?: string }) {
  const { family } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = child?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setPlan(null);
    setSaved(false);
    setError(null);
    getPlan(id).then((p) => live && setPlan(p)).catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id]);

  if (!child) return null;

  async function change(habit: PlanHabit, changes: Parameters<typeof updateChildHabit>[1]) {
    setError(null);
    setSaved(false);
    try {
      setPlan(await updateChildHabit(habit.id, changes));
    } catch (e) {
      setError(errorText(e));
    }
  }

  const progress = plan?.progress;
  return (
    <div className="page page--app">
      <ParentHeader active="quests" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Quest library</p>
            <h1>Quests for {child.name}</h1>
            <p className="lead">
              Up to {MAX_HABITS} quests, chosen from goals. Harder tiers unlock as {child.name} levels up.
              Not sure where to start? Describe the problem on the dashboard.
            </p>
          </div>
        </div>

        {fam.children.length > 1 && (
          <div className="about" role="tablist" aria-label="Child">
            {fam.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} className={`about__chip ${c.id === child.id ? "is-on" : ""}`}
                onClick={() => go(`/quests/${c.id}`)}>
                <Buddy buddy={c.buddy} accessory={c.wearing} size={24} /> {c.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {!plan && !error && <p className="empty">Loading {child.name}'s plan…</p>}

        {plan && (
          <>
            <section className="panel">
              <div className="panel__head">
                <h2>{child.name}'s quests ({plan.habits.length}/{MAX_HABITS})</h2>
                {progress && (
                  <span className="chip">
                    Level {progress.level} · {progress.level_name}
                    {progress.next_level_at !== null ? ` · ${progress.next_level_at - progress.sparks} Sparks to go` : ""}
                  </span>
                )}
              </div>
              {plan.habits.length === 0 ? (
                <p className="empty">No quests yet. Pick some below.</p>
              ) : (
                <div className="lib-row">
                  {plan.habits.map((h) => (
                    <article key={h.id} className={`lib-card is-added ${h.status === "paused" ? "is-paused" : ""}`}>
                      <HabitArt habit={h.habit_id} />
                      <div className="lib-card__body">
                        <b>{h.title}</b>
                        <span className="muted">Tier {h.tier} · {h.points} pts{h.status === "paused" ? " · Paused" : ""}</span>
                        <label className="setting">
                          <span>Time</span>
                          <input type="time" defaultValue={h.cue_time} key={h.cue_time} aria-label={`Time for ${h.title}`}
                            onBlur={(e) => { if (e.target.value && e.target.value !== h.cue_time) void change(h, { cue_time: e.target.value }); }} />
                        </label>
                        <DayPicker title={h.title} days={h.days} onChange={(days) => change(h, { days })} />
                        <div className="lib-card__actions">
                          <button className="btn btn--ghost btn--sm" onClick={() => change(h, { status: h.status === "paused" ? "active" : "paused" })}>
                            {h.status === "paused" ? "Resume" : "Pause"}
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={() => change(h, { status: "removed" })}>Remove</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel__head"><h2>Goals and quests</h2></div>
              {saved && <p className="form-ok" role="status">Plan saved.</p>}
              <PlanEditor child={child} plan={plan} showCatalog={plan.goals.length === 0}
                onSaved={(p) => { setPlan(p); setSaved(true); }} />
            </section>
          </>
        )}

        <p className="hint">Tier 2 quests open in {WORLDS[1].name} ({WORLDS[1].sparks} Sparks) and tier 3 in {WORLDS[2].name} ({WORLDS[2].sparks} Sparks). You can change this in Child details.</p>
      </main>
      <Footer />
    </div>
  );
}

/** Which days a quest runs on: a quick choice, or any days the parent taps. */
function DayPicker({ title, days, onChange }: { title: string; days: DayName[]; onChange: (days: DayName[]) => void }) {
  const preset = presetFor(days);
  return (
    <div className="day-picker">
      <select aria-label={`Days for ${title}`} value={preset ?? "custom"}
        onChange={(e) => { const next = DAY_PRESETS.find((p) => p.label === e.target.value); if (next) onChange(next.days); }}>
        {DAY_PRESETS.map((p) => <option key={p.label}>{p.label}</option>)}
        {!preset && <option value="custom">Custom days</option>}
      </select>
      <div className="day-picker__days">
        {WEEK.map((d) => (
          <button key={d.id} type="button" aria-pressed={days.includes(d.id)} aria-label={d.short}
            className={days.includes(d.id) ? "is-on" : ""} onClick={() => onChange(toggleDay(days, d.id))}>
            {d.short[0]}
          </button>
        ))}
      </div>
    </div>
  );
}
