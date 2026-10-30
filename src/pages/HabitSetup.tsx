/**
 * Habit setup: the parent switches habits on or off and sets each one's time
 * (wake-up, lunch, dinner, bedtime) or daily screen-time limit. Applies to every child.
 */
import { useState } from "react";
import Clock from "../components/Clock";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import { setHabits, type HabitSettings } from "../lib/family";
import { HABITS, type Habit } from "../lib/habits";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import { formatMinutes, formatTime } from "../lib/time";

export default function HabitSetup() {
  const { family, update } = useStore();
  const [habits, setLocal] = useState<HabitSettings>(() => structuredClone(family!.habits));
  const firstTime = !family!.habitsChosen;
  const count = HABITS.filter((h) => habits[h.id].enabled).length;

  const patch = (id: Habit["id"], change: Partial<HabitSettings[Habit["id"]]>) =>
    setLocal((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));

  function save() {
    update((f) => setHabits(f, habits));
    go("/parent");
  }

  return (
    <div className="page page--app">
      <ParentHeader active="habits" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">{firstTime ? "Step 2 of 2" : "Habits & times"}</p>
            <h1>Which good habits shall we build?</h1>
            <p className="lead">
              Switch on the habits you want and set the times. Each one becomes a daily picture quest for{" "}
              {family!.children.map((c) => c.name).join(" and ")}.
            </p>
          </div>
        </div>

        <div className="setup-grid">
          {HABITS.map((h) => {
            const s = habits[h.id];
            return (
              <article key={h.id} className={`setup-card ${s.enabled ? "is-on" : ""}`}>
                <div className="setup-card__art">
                  <HabitArt habit={h.id} />
                  {s.enabled && h.setting.kind === "time" && s.value && (
                    <span className="setup-card__clock"><Clock time={s.value} size={46} /></span>
                  )}
                </div>
                <div className="setup-card__body">
                  <div className="setup-card__title">
                    <h3>{h.parentTitle}</h3>
                    <label className="switch" aria-label={`Include ${h.parentTitle}`}>
                      <input type="checkbox" checked={s.enabled} onChange={(e) => patch(h.id, { enabled: e.target.checked })} />
                      <span />
                    </label>
                  </div>
                  <p>{h.description}</p>

                  {h.setting.kind === "time" && (
                    <label className={`setting ${s.enabled ? "" : "is-disabled"}`}>
                      <span>{h.setting.label}</span>
                      <input type="time" value={s.value ?? h.setting.default} disabled={!s.enabled}
                        onChange={(e) => patch(h.id, { value: e.target.value })} />
                      <em>{formatTime(s.value ?? h.setting.default)}</em>
                    </label>
                  )}
                  {h.setting.kind === "minutes" && (
                    <div className={`setting ${s.enabled ? "" : "is-disabled"}`}>
                      <span>{h.setting.label}</span>
                      <div className="pill-choice" role="radiogroup" aria-label={h.setting.label}>
                        {h.setting.options.map((m) => (
                          <button type="button" key={m} role="radio" disabled={!s.enabled}
                            aria-checked={s.value === String(m)}
                            className={s.value === String(m) ? "is-on" : ""}
                            onClick={() => patch(h.id, { value: String(m) })}>
                            {formatMinutes(m)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {h.setting.kind === "none" && (
                    <div className={`setting ${s.enabled ? "" : "is-disabled"}`}>
                      <span>Every day, once homework is finished</span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>

      <div className="savebar">
        <div className="wrap savebar__inner">
          <span>
            <b>{count}</b> {count === 1 ? "habit" : "habits"} selected · up to {count} Sparks a day
          </span>
          <div className="savebar__actions">
            {!firstTime && <a className="btn btn--ghost" href="#/parent">Cancel</a>}
            <button className="btn btn--primary btn--lg" disabled={count === 0} onClick={save}>
              {firstTime ? "Start the adventure" : "Save habits"}
            </button>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
