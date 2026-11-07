import { buddyDisplayProps } from "../lib/buddyIdentity";
/**
 * Parent dashboard: safety alerts, quests waiting for approval (from the backend, PIN-protected),
 * reward requests, each child's day, level, Sparks and points, check-ins, the surprise planner,
 * adding a child, and the AI helpers. Family settings (devices, grown-ups, PIN, data) have their own page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AiHelpers from "../components/AiHelpers";
import { catalogVisualForGoal } from "../components/CatalogVisual";
import { KidFeedback, RewardRequests, SafetyAlerts, SurprisePlanner, recentCheckins, useCheckins } from "../components/ParentPanels";
import Buddy from "../components/Buddy";
import Celebration from "../components/Celebration";
import { ChildForm } from "../components/ChildForm";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import { SparkCount, SparkIcon } from "../components/Spark";
import {
  addChild, approveCompletion, errorText, getChildExtras, getChildToday, getPlan, listApprovals, rejectCompletion,
  type Approval, type ChildInput, type Plan, type PlanHabit, type Today,
} from "../lib/api";
import { nextWorld, type Child, type Family, type QuestStatus } from "../lib/family";
import { appAllowance, appUsedSeconds } from "../lib/playtime";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import { applyExtras, applyProgress, applyToday, localStatus } from "../lib/sync";
import { presetFor, WEEK, weekdayName } from "../lib/schedule";
import { dayKey, greeting, weekdayShort } from "../lib/time";

const POLL_MS = 30_000;
const STATUS_LABEL: Record<QuestStatus, string> = {
  todo: "To do", submitted: "Waiting for you", approved: "Spark earned", notyet: "Trying again",
};

interface LevelUp { habit: { id: string; kidTitle: string }; name: string; buddy: Child["buddy"]; catalogMode?: boolean; sparks: number; points: number; message: string }

/** The parent dashboard (#/parent). */
export default function ParentDashboard() {
  const { family, server, update, askPin, reload, enterKidMode } = useStore();
  const fam = family!;
  const familyId = server!.id;
  const childIds = fam.children.map((c) => c.id).join();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [days, setDays] = useState<Record<string, Today>>({});
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  const [requests, setRequests] = useState(0);
  const checkins = useCheckins(familyId);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    const ids = childIds ? childIds.split(",") : [];
    const waitingRequest = Promise.allSettled([listApprovals(familyId)]);
    const children = await Promise.all(ids.map(async (id) => {
      const [today, plan, extras] = await Promise.allSettled([getChildToday(id), getPlan(id), getChildExtras(id)]);
      return { id, today, plan, extras };
    }));
    const [waiting] = await waitingRequest;
    if (version !== loadVersion.current) return;
    // A failed request for one child or optional extras must not blank every child's dashboard.
    if (waiting.status === "fulfilled") setApprovals(waiting.value);
    setDays((previous) => Object.fromEntries(children.flatMap(({ id, today }) => {
      const value = today.status === "fulfilled" ? today.value : previous[id];
      return value ? [[id, value]] : [];
    })));
    setPlans((previous) => Object.fromEntries(children.flatMap(({ id, plan }) => {
      const value = plan.status === "fulfilled" ? plan.value : previous[id];
      return value ? [[id, value]] : [];
    })));
    update((f) => children.reduce((next, { id, today, extras }) => {
      if (today.status === "fulfilled") next = applyToday(next, today.value);
      return extras.status === "fulfilled" ? applyExtras(next, id, extras.value) : next;
    }, f));
    const failure = [waiting, ...children.flatMap(({ today, plan, extras }) => [today, plan, extras])]
      .find((result) => result.status === "rejected");
    setError(failure?.status === "rejected" ? `Some dashboard details could not be refreshed. ${errorText(failure.reason)}` : null);
    setLoading(false);
  }, [childIds, familyId, update]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ++loadVersion.current;
      window.clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function decide(item: Approval, approve: boolean) {
    const ok = await askPin(approve ? `Approve "${item.title}" for ${item.child_name}.` : `Send "${item.title}" back to ${item.child_name}.`);
    if (!ok) return;
    setDeciding(item.completion_id);
    setError(null);
    const before = days[item.child_id]?.progress;
    let failed: string | null = null;
    try {
      const result = await (approve ? approveCompletion : rejectCompletion)(item.completion_id);
      update((f) => applyProgress(f, result.child_id, result.progress, result.points));
      if (approve && before !== undefined && result.progress.level > before.level) {
        setLevelUp({
          habit: { id: item.habit_id, kidTitle: item.kid_title }, name: item.child_name, points: item.points,
          buddy: fam.children.find((c) => c.id === item.child_id)?.buddy ?? "fox",
          catalogMode: fam.children.find((c) => c.id === item.child_id)?.buddySelectionMode === "catalog",
          sparks: result.progress.sparks - before.sparks,
          message: `Level up! ${item.child_name} is a ${result.progress.level_name} now.`,
        });
      }
    } catch (e) {
      failed = errorText(e); // e.g. another caregiver decided first
    }
    setDeciding(null);
    await load();
    if (failed) setError(failed); // after the reload, which clears old errors when it succeeds
  }

  function openKidMode(childId?: string) {
    enterKidMode();
    const locked = fam.children.find((c) => c.id === childId)?.hasPin; // the child enters their PIN on the picker
    go(childId && !locked ? `/kid/${childId}` : "/kid");
  }

  async function add(input: ChildInput) {
    await addChild(familyId, input);
    await reload();
  }

  const pending = approvals ?? [];
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
            <a className="btn btn--soft" href="#/setup">Child details</a>
            <button className="btn btn--gold" onClick={() => openKidMode()}>Open kid mode</button>
          </div>
        </div>

        {error && <div className="form-error" role="alert">{error} <button className="link-button" onClick={() => void load()} disabled={loading}>Retry dashboard</button></div>}
        <SafetyAlerts items={checkins.items} onDone={() => void checkins.markRead()} />

        {/* ── Waiting for approval ─────────────────────────────────────── */}
        <section className="panel panel--approvals" aria-labelledby="approvals-title">
          <div className="panel__head">
            <h2 id="approvals-title">Waiting for your OK</h2>
            <span className="count-badge">{pending.length}</span>
          </div>
          {approvals === null ? (
            <p className="empty">Checking for quests…</p>
          ) : pending.length === 0 ? (
            <p className="empty">
              When your child taps &ldquo;I did it!&rdquo;, the quest shows up here for you to approve.
            </p>
          ) : (
            <ul className="approvals">
              {pending.map((item) => {
                const child = fam.children.find((c) => c.id === item.child_id);
                const dayOf = days[item.child_id]?.day ?? dayKey();
                return (
                  <li key={item.completion_id} className="approval">
                    <HabitArt habit={item.habit_id} icon={item.icon} className="approval__art" />
                    <div className="approval__text">
                      <span className="approval__who">{child && <Buddy {...buddyDisplayProps(child)} size={24} />} {item.child_name}</span>
                      <b>{item.title}</b>
                      <span className="muted">{item.day === dayOf ? "Today" : weekdayShort(item.day)} · marked done · worth {item.points} points</span>
                    </div>
                    <div className="approval__actions">
                      <button className="btn btn--ghost btn--sm" disabled={deciding === item.completion_id} onClick={() => decide(item, false)}>Not yet</button>
                      <button className="btn btn--primary btn--sm" disabled={deciding === item.completion_id} onClick={() => decide(item, true)}>
                        Approve <SparkIcon size={14} /> +1
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <RewardRequests family={fam} familyId={familyId} onCount={setRequests} />

        {/* ── Children ─────────────────────────────────────────────────── */}
        <div className="kids-grid">
          {fam.children.map((child) => (
            <ChildCard key={child.id} family={fam} child={child} today={days[child.id]} plan={plans[child.id]} loading={loading} onOpen={() => openKidMode(child.id)} />
          ))}
          <AddChildCard onAdd={add} />
        </div>

        {recentCheckins(checkins.items).length > 0 ? (
          <div className="two-col">
            <KidFeedback items={checkins.items} onRead={() => void checkins.markRead()} />
            <SurprisePlanner family={fam} familyId={familyId} />
          </div>
        ) : (
          <SurprisePlanner family={fam} familyId={familyId} wide />
        )}

        <AiHelpers family={fam} onPlanSaved={() => void load()} />
      </main>
      <Footer />
      {levelUp && (
        <Celebration habits={[levelUp.habit]} name={levelUp.name} buddy={levelUp.buddy} catalogMode={levelUp.catalogMode} sparks={levelUp.sparks} points={levelUp.points} unlocks={[levelUp.message]} onDone={() => setLevelUp(null)} />
      )}
    </div>
  );
}

function ChildCard({ family, child, today, plan, loading, onOpen }: { family: Family; child: Child; today?: Today; plan?: Plan; loading: boolean; onOpen: () => void }) {
  const day = today?.day ?? dayKey();
  const quests = today?.habits ?? [];
  const done = quests.filter((h) => h.status === "approved").length;
  const sparks = today?.progress.sparks ?? child.sparks;
  const next = nextWorld(sparks);
  const week = Object.entries(today?.week ?? {});
  const streak = today?.streak ?? 0;
  const allowance = appAllowance(family, child, day);
  const usedMin = Math.round(appUsedSeconds(child, day) / 60);
  const nextAt = today?.progress.next_level_at;
  const todayIds = new Set(quests.map((h) => h.child_habit_id));
  const otherDays = plan?.habits.filter((h) => h.status === "active" && !todayIds.has(h.id)) ?? [];
  const paused = plan?.habits.filter((h) => h.status === "paused") ?? [];
  // Resolve by the saved foreign key, never by goal order or the first displayed card.
  const assignments = new Map(plan?.habits.map(habit => [habit.id, habit]));
  const goalIds = new Set(plan?.habits.map(habit => habit.goal_id));
  const goals: DashboardGoal[] = plan?.goals.filter(goal => goal.status === "active" || goalIds.has(goal.goal_id)) ?? [];
  for (const goalId of goalIds) {
    if (!goals.some(goal => goal.goal_id === goalId)) {
      goals.push({ goal_id: goalId, title: catalogVisualForGoal(goalId)?.title ?? "Goal details unavailable" });
    }
  }
  const goalsById = new Map(goals.map(goal => [goal.goal_id, goal]));
  const goalHabits = (goalId: string) => plan?.habits.filter(habit => habit.goal_id === goalId) ?? [];
  const orderedGoals = [...goals].sort((a, b) => Number(goalHabits(b.goal_id).length > 0) - Number(goalHabits(a.goal_id).length > 0));

  return (
    <article className="kid-card" aria-label={`${child.name}'s dashboard`}>
      <header className="kid-card__head">
        <Buddy {...buddyDisplayProps(child)} accessory={child.wearing} size={56} />
        <div>
          <h3>{child.name}</h3>
          <span className="muted">Age {child.age}{today && ` · ${done} of ${quests.length} today`}</span>
        </div>
        <SparkCount count={sparks} />
      </header>

      <div className="kid-card__stats">
        {today && (
          <span title={nextAt != null ? `${nextAt - sparks} Sparks to the next level` : "Top level"}>
            <b>Level {today.progress.level}</b> {today.progress.level_name}
          </span>
        )}
        <span><b>🪙 {child.balance}</b> points</span>
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
              <span>{sparks} / {next.sparks}</span>
            </div>
            <div className="bar"><span style={{ width: `${Math.min(100, (sparks / next.sparks) * 100)}%` }} /></div>
          </>
        ) : (
          <div className="progress-block__label"><span>Every world unlocked!</span></div>
        )}
      </div>

      <section className="kid-card__plan" aria-label={`${child.name}'s assigned plan`}>
        <div className="kid-card__section-head"><h4>Habits</h4>{plan && <span>{plan.habits.length} {plan.habits.length === 1 ? "habit" : "habits"} assigned</span>}</div>
        {!plan ? <p className="muted">{loading ? "Loading saved plan…" : "Saved plan could not be loaded. Try refreshing the dashboard."}</p>
          : plan.habits.length === 0 ? <p className="empty">No habits assigned to {child.name} yet. Choose habits from a goal and add them to this child's plan.</p> : null}

      </section>

      <section className="kid-card__schedule" aria-label={`${child.name}'s quests today`}>
      <h4>Today</h4>
      {!today && <p className="muted">{loading ? "Loading today's quests…" : "Today's quests could not be loaded. Your saved plan is shown above."}</p>}
      {today && quests.length === 0 && (
        <p className="empty">
          {today.rest_day && today.next_quest_day
            ? `Rest day. Next quests on ${weekdayName(today.next_quest_day)}.`
            : plan?.habits.length ? "No habits scheduled for today. Your assigned habits are shown below." : "No habits scheduled for today."}
        </p>
      )}
      <ul className="kid-card__quests">
        {quests.map((h) => {
          const status = localStatus(h.status);
          return (
            <li key={h.child_habit_id}>
              <HabitArt habit={h.habit_id} icon={h.icon} text={`${h.kid_title} ${h.kid_hint}`} className="mini-art" />
              <span>{h.kid_title}<small className="tier-tag">Tier {h.tier}</small><HabitGoal childId={child.id} habitName={h.kid_title} goal={goalsById.get(assignments.get(h.child_habit_id)?.goal_id ?? "")} /></span>
              <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ul>
      </section>

      {otherDays.length > 0 && <AssignedHabits child={child} goals={goalsById} habits={otherDays} title={today ? "Other days" : "Assigned habits"} />}
      {paused.length > 0 && <AssignedHabits child={child} goals={goalsById} habits={paused} title="Paused" />}

      <section className="kid-card__plan kid-card__goal-section" aria-label={`${child.name}'s goals`}>
        <div className="kid-card__section-head"><h4>Goals</h4>{plan && <span>{orderedGoals.length} saved</span>}</div>
        {!plan ? <p className="muted">{loading ? "Loading linked goals…" : "Goal details could not be loaded."}</p>
          : orderedGoals.length === 0 ? <p className="empty">No goals saved yet.</p> : null}
        {orderedGoals.length > 0 && <ul className="kid-card__goals" aria-label="Saved goals">
          {orderedGoals.map(goal => {
            const visual = catalogVisualForGoal(goal.goal_id);
            const count = goalHabits(goal.goal_id).length;
            return <li key={goal.goal_id}><a href={goalPlanLink(child.id, goal.goal_id)} aria-label={`View ${goal.title} in ${child.name}'s plan`}>
              {visual?.image && <img src={visual.image} alt={visual.alt} width="40" height="40" loading="lazy" />}
              <span>{goal.title}<small>{count ? `${count} linked ${count === 1 ? "habit" : "habits"}` : "Saved · no habits yet"}</small></span>
            </a></li>;
          })}
        </ul>}
      </section>

      <div className="week" aria-label="Sparks earned in the last 7 days">
        {week.map(([d, n]) => {
          return (
            <div key={d} className={`week__day ${d === day ? "is-today" : ""}`}>
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
        <a className="btn btn--ghost btn--sm" href={`#/quests/${child.id}`}>Quests</a>
        <a className="btn btn--ghost btn--sm" href={`#/coach/${child.id}`}>Ask coach</a>
        <a className="btn btn--ghost btn--sm" href={`#/setup/${child.id}`}>Edit</a>
        <button className="btn btn--soft btn--sm" onClick={onOpen}>Open {child.name}'s quests</button>
      </div>
    </article>
  );
}

type DashboardGoal = Pick<Plan["goals"][number], "goal_id" | "title">;
const goalPlanLink = (childId: string, goalId: string) => `#/quests/${childId}/goal/${encodeURIComponent(goalId)}`;

/** Missing linkage stays explicit; an unrelated saved goal is never used as a fallback. */
function HabitGoal({ childId, habitName, goal }: { childId: string; habitName: string; goal?: DashboardGoal }) {
  return <small className="kid-card__habit-goal">{goal
    ? <a href={goalPlanLink(childId, goal.goal_id)} aria-label={`Goal for ${habitName}: ${goal.title}`}>Goal: {goal.title}</a>
    : "Goal details unavailable"}</small>;
}

/** Saved assignments stay visible on rest days; only the Today API supplies completion status. */
function AssignedHabits({ child, habits, title, goals }: { child: Child; habits: PlanHabit[]; title: string; goals: Map<string, DashboardGoal> }) {
  return <section className="kid-card__schedule" aria-label={`${child.name}'s ${title.toLowerCase()}`}>
    <h4>{title}</h4>
    <ul className="kid-card__quests kid-card__assigned">
      {habits.map((habit) => <li key={habit.id}>
        <HabitArt habit={habit.habit_id} icon={habit.icon} text={`${habit.kid_title} ${habit.kid_hint}`} className="mini-art" />
        <span>{habit.kid_title}<small>{presetFor(habit.days) ?? WEEK.filter((day) => habit.days.includes(day.id)).map((day) => day.short).join(", ")} · {habit.cue_time.slice(0, 5)}</small><HabitGoal childId={child.id} habitName={habit.kid_title} goal={goals.get(habit.goal_id)} /></span>
        <a className="link-button" href={`#/quests/${child.id}`} aria-label={`Manage ${habit.kid_title} for ${child.name}`}>{habit.status === "paused" ? "Paused" : "In plan"}</a>
      </li>)}
    </ul>
  </section>;
}

function AddChildCard({ onAdd }: { onAdd: (input: ChildInput) => Promise<void> }) {
  const [open, setOpen] = useState(false);

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
    <div className="kid-card kid-card--form">
      <h3>Add a child</h3>
      <ChildForm submitLabel="Add child" onCancel={() => setOpen(false)}
        onSubmit={async (input) => { await onAdd(input); setOpen(false); }} />
    </div>
  );
}
