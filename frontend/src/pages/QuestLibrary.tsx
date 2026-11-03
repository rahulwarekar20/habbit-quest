/**
 * Quest library (parent): a child's quests, up to six, each one row that can be retimed, rescheduled,
 * paused or removed; below, "Add quests" filters the whole catalog and the family's own habits by
 * goal and age. Harder tiers unlock as the child levels up.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import HabitCatalog from "../components/HabitCatalog";
import { errorText, getPlan, updateChildHabit, type DayName, type Plan, type PlanHabit } from "../lib/api";
import { WORLDS } from "../lib/family";
import { DAY_PRESETS, WEEK, presetFor, toggleDay } from "../lib/schedule";
import { MAX_HABITS } from "../lib/plan";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export default function QuestLibrary({ childId }: { childId?: string }) {
  const { family, server } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
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
                <p className="empty">No quests yet. Add some below.</p>
              ) : (
                <ul className="quest-rows">
                  {plan.habits.map((h) => (
                    <li key={h.id} className={`quest-row ${h.status === "paused" ? "is-paused" : ""}`}>
                      <HabitArt habit={h.habit_id} icon={h.icon} className="quest-row__art" />
                      <div className="quest-row__name">
                        <b>{h.title}</b>
                        <span className="muted">Tier {h.tier} · {h.points} pts{h.status === "paused" ? " · Paused" : ""}</span>
                      </div>
                      <input className="quest-row__time" type="time" defaultValue={h.cue_time} key={h.cue_time} aria-label={`Time for ${h.title}`}
                        onBlur={(e) => { if (e.target.value && e.target.value !== h.cue_time) void change(h, { cue_time: e.target.value }); }} />
                      <DayPicker title={h.title} days={h.days} onChange={(days) => change(h, { days })} />
                      <span className="quest-row__actions">
                        <button className="link-button" onClick={() => change(h, { status: h.status === "paused" ? "active" : "paused" })}>
                          {h.status === "paused" ? "Resume" : "Pause"}
                        </button>
                        <button className="link-button" onClick={() => change(h, { status: "removed" })}>Remove</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
