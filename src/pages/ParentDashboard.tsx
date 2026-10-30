/**
 * Parent dashboard: safety alerts, quests and reward requests waiting for approval
 * (PIN-protected), each child's day, week, level, points and kid-mode time, the children's
 * check-ins, the surprise planner, adding a child, a button to hand the device over in kid
 * mode, and the AI helpers (coach, planner, reviewer) whose suggestions the parent approves.
 */
import { useState, type FormEvent } from "react";
import AiHelpers from "../components/AiHelpers";
import { KidFeedback, RewardRequests, SafetyAlerts, SurprisePlanner } from "../components/ParentPanels";
import Buddy, { BUDDIES } from "../components/Buddy";
import Clock from "../components/Clock";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import { SparkCount, SparkIcon } from "../components/Spark";
import {
  activeQuests, addChild, approveQuest, approvedCount, boostFor, declineQuest, levelOf, newChild, nextLevel, nextWorld,
  pendingApprovals, pointsFor, questWhen, questsFor, statusOf, streakOf, type BuddyId, type Child, type Family, type QuestStatus,
} from "../lib/family";
import { MAX_AGE, MIN_AGE, type HabitId, type QuestDef } from "../lib/habits";
import { appAllowance, appUsedSeconds } from "../lib/playtime";
import { pendingRedemptions } from "../lib/rewards";
import { go } from "../lib/router";
import { setKidMode } from "../lib/storage";
import { useStore } from "../lib/store";
import { dayKey, greeting, lastDays, weekdayShort } from "../lib/time";

const STATUS_LABEL: Record<QuestStatus, string> = {
  todo: "To do", submitted: "Waiting for you", approved: "Spark earned", notyet: "Trying again",
};

export default function ParentDashboard() {
  const { family, update, askPin } = useStore();
  const fam = family!;
  const today = dayKey();
  const pending = pendingApprovals(fam, today);
  const quests = activeQuests(fam);

  const requests = pendingRedemptions(fam).length;

  async function decide(child: Child, habit: QuestDef, approve: boolean) {
    const ok = await askPin(approve ? `Approve "${habit.parentTitle}" for ${child.name}.` : `Send "${habit.parentTitle}" back to ${child.name}.`);
    if (!ok) return;
    update((f) => (approve ? approveQuest : declineQuest)(f, today, child.id, habit.id));
  }

  function openKidMode(childId?: string) {
    setKidMode(true);
    go(childId ? `/kid/${childId}` : "/kid");
  }

  return (
    <div className="page page--app">
      <ParentHeader active="dashboard" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <h1>{greeting()}, {fam.parentName}</h1>
            <p className="lead">
              {pending.length + requests > 0
                ? [
                    pending.length > 0 && `${pending.length} ${pending.length === 1 ? "quest is" : "quests are"} waiting for your OK`,
                    requests > 0 && `${requests} reward ${requests === 1 ? "request" : "requests"}`,
                  ].filter(Boolean).join(" and ") + "."
                : "Nothing waiting for you right now. Hand over the device and let the quests begin."}
            </p>
          </div>
          <div className="page-head__actions">
            <a className="btn btn--soft" href="#/setup">Edit habits &amp; times</a>
            <button className="btn btn--gold" onClick={() => openKidMode()}>Open kid mode</button>
          </div>
        </div>

        <SafetyAlerts family={fam} />

        {/* ── Waiting for approval ─────────────────────────────────────── */}
        <section className="panel panel--approvals" aria-labelledby="approvals-title">
          <div className="panel__head">
            <h2 id="approvals-title">Waiting for your OK</h2>
            <span className="count-badge">{pending.length}</span>
          </div>
          {pending.length === 0 ? (
            <p className="empty">
              When your child taps &ldquo;I did it!&rdquo;, the quest shows up here for you to approve.
            </p>
          ) : (
            <ul className="approvals">
              {pending.map(({ child, habit }) => (
                <li key={`${child.id}-${habit.id}`} className="approval">
                  <HabitArt habit={habit.id} className="approval__art" />
                  <div className="approval__text">
                    <span className="approval__who"><Buddy buddy={child.buddy} size={24} /> {child.name}</span>
                    <b>{habit.parentTitle}</b>
                    <span className="muted">
                      {questWhen(fam, habit, child, today) ?? "Today"} · marked done · worth {pointsFor(fam, today, child.id, habit.id)} points
                      {boostFor(fam, today, child.id, habit.id).multiplier > 1 && ` (${boostFor(fam, today, child.id, habit.id).multiplier}x)`}
                    </span>
                  </div>
                  <div className="approval__actions">
                    <button className="btn btn--ghost btn--sm" onClick={() => decide(child, habit, false)}>Not yet</button>
                    <button className="btn btn--primary btn--sm" onClick={() => decide(child, habit, true)}>
                      Approve <SparkIcon size={14} /> +1
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <RewardRequests family={fam} />

        {/* ── Children ─────────────────────────────────────────────────── */}
        <div className="kids-grid">
          {fam.children.map((child) => (
            <ChildCard key={child.id} family={fam} child={child} today={today} onOpen={() => openKidMode(child.id)} />
          ))}
          <AddChildCard onAdd={(name, age, buddy) => update((f) => addChild(f, newChild(name, age, buddy)))} />
        </div>

        <div className="two-col">
          <KidFeedback family={fam} />
          <SurprisePlanner family={fam} />
        </div>

        {/* ── AI helpers ───────────────────────────────────────────────── */}
        <AiHelpers family={fam} />

        {/* ── Today's routine ──────────────────────────────────────────── */}
        <section className="panel" aria-labelledby="routine-title">
          <div className="panel__head">
            <h2 id="routine-title">Today's routine</h2>
            <a href="#/setup" className="link">Change</a>
          </div>
          <div className="routine">
            {quests.map((h) => (
              <div key={h.id} className="routine__item">
                {h.setting.kind === "time" && fam.habits[h.id as HabitId].value
                  ? <Clock time={fam.habits[h.id as HabitId].value!} size={40} />
                  : <HabitArt habit={h.id} className="routine__art" />}
                <div>
                  <b>{h.parentTitle}</b>
                  <span className="muted">{questWhen(fam, h) ?? "Every day"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ChildCard({ family, child, today, onOpen }: { family: Family; child: Child; today: string; onOpen: () => void }) {
  const quests = questsFor(family, child.id);
  const done = approvedCount(family, today, child.id);
  const next = nextWorld(child.sparks);
  const week = lastDays(7);
  const level = levelOf(child.sparks);
  const upcoming = nextLevel(child.sparks);
  const streak = streakOf(family, child.id, today);
  const allowance = appAllowance(family, child, today);
  const usedMin = Math.round(appUsedSeconds(child, today) / 60);

  return (
    <article className="kid-card">
      <header className="kid-card__head">
        <Buddy buddy={child.buddy} accessory={child.wearing} size={56} />
        <div>
          <h3>{child.name}</h3>
          <span className="muted">Age {child.age} · {done} of {quests.length} today</span>
        </div>
        <SparkCount count={child.sparks} />
      </header>

      <div className="kid-card__stats">
        <span title={upcoming ? `${upcoming.sparks - child.sparks} Sparks to level ${upcoming.level}` : "Top level"}>
          <b>Level {level.level}</b> {level.name}
        </span>
        <span><b>🪙 {child.points}</b> points</span>
        {streak >= 2 && <span><b>🔥 {streak}</b> days</span>}
        <span className={allowance !== null && usedMin >= allowance ? "is-over" : ""}>
          <b>⏱ {usedMin}{allowance !== null ? ` / ${allowance}` : ""}</b> min in app
        </span>
      </div>

      <div className="progress-block">
        {next ? (
          <>
            <div className="progress-block__label">
              <span>Next world: <b>{next.name}</b></span>
              <span>{child.sparks} / {next.sparks}</span>
            </div>
            <div className="bar"><span style={{ width: `${Math.min(100, (child.sparks / next.sparks) * 100)}%` }} /></div>
          </>
        ) : (
          <div className="progress-block__label"><span>Every world unlocked!</span></div>
        )}
      </div>

      <ul className="kid-card__quests">
        {quests.map((h) => {
          const status = statusOf(family, today, child.id, h.id);
          return (
            <li key={h.id}>
              <HabitArt habit={h.id} className="mini-art" />
              <span>{h.parentTitle}{!h.routine && <small className="tier-tag">Tier {h.tier}</small>}</span>
              <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ul>

      <div className="week" aria-label="Sparks earned in the last 7 days">
        {week.map((d) => {
          const n = approvedCount(family, d, child.id);
          return (
            <div key={d} className={`week__day ${d === today ? "is-today" : ""}`}>
              <span className="week__dots">
                {n > 0 ? <SparkIcon size={n > 2 ? 22 : 16} /> : <i />}
              </span>
              <span className="week__n">{n}</span>
              <span className="week__label">{weekdayShort(d)}</span>
            </div>
          );
        })}
      </div>

      <div className="kid-card__buttons">
        <a className="btn btn--ghost btn--sm" href={`#/quests/${child.id}`}>Bonus quests</a>
        <button className="btn btn--soft btn--sm" onClick={onOpen}>Open {child.name}'s quests</button>
      </div>
    </article>
  );
}

function AddChildCard({ onAdd }: { onAdd: (name: string, age: number, buddy: BuddyId) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState(6);
  const [buddy, setBuddy] = useState<BuddyId>("owl");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name, age, buddy);
    setName("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="kid-card kid-card--add" onClick={() => setOpen(true)}>
        <span className="plus">+</span>
        <b>Add a child</b>
        <span className="muted">Each child gets their own quests and Sparks</span>
      </button>
    );
  }

  return (
    <form className="kid-card kid-card--form" onSubmit={submit}>
      <h3>Add a child</h3>
      <div className="field-row">
        <label className="field">
          <span>First name</span>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Age</span>
          <select value={age} onChange={(e) => setAge(Number(e.target.value))}>
            {Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => i + MIN_AGE).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <div className="buddy-picker buddy-picker--sm" role="radiogroup" aria-label="Buddy">
        {BUDDIES.map((b) => (
          <button type="button" key={b.id} role="radio" aria-checked={buddy === b.id}
            className={`buddy-option ${buddy === b.id ? "is-on" : ""}`} onClick={() => setBuddy(b.id)}>
            <Buddy buddy={b.id} size={42} />
          </button>
        ))}
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn--primary">Add child</button>
      </div>
    </form>
  );
}
