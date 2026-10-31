/**
 * Parent dashboard: safety alerts, quests waiting for approval (from the backend, PIN-protected),
 * reward requests, each child's day, level, Sparks and points, the family's invite code and
 * caregivers, check-ins, the surprise planner, adding a child, and "Describe a problem".
 */
import { useCallback, useEffect, useState } from "react";
import AiHelpers from "../components/AiHelpers";
import { KidFeedback, RewardRequests, SafetyAlerts, SurprisePlanner } from "../components/ParentPanels";
import Buddy from "../components/Buddy";
import Celebration from "../components/Celebration";
import { ChildForm } from "../components/ChildForm";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import { SparkCount, SparkIcon } from "../components/Spark";
import {
  addChild, approveCompletion, errorText, getChildToday, listApprovals, newInviteCode, rejectCompletion,
  type Approval, type ChildInput, type Today,
} from "../lib/api";
import { approvedCount, nextWorld, streakOf, type Child, type Family, type QuestStatus } from "../lib/family";
import { appAllowance, appUsedSeconds } from "../lib/playtime";
import { pendingRedemptions } from "../lib/rewards";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import { applyProgress, applyToday, localStatus } from "../lib/sync";
import { dayKey, greeting, lastDays, weekdayShort } from "../lib/time";

const POLL_MS = 30_000;
const STATUS_LABEL: Record<QuestStatus, string> = {
  todo: "To do", submitted: "Waiting for you", approved: "Spark earned", notyet: "Trying again",
};

interface LevelUp { habit: { id: string; kidTitle: string }; name: string; points: number; message: string }

export default function ParentDashboard() {
  const { family, server, update, askPin, reload, enterKidMode } = useStore();
  const fam = family!;
  const familyId = server!.id;
  const childIds = fam.children.map((c) => c.id).join();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [days, setDays] = useState<Record<string, Today>>({});
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);

  const load = useCallback(async () => {
    try {
      const ids = childIds ? childIds.split(",") : [];
      const [waiting, todays] = await Promise.all([listApprovals(familyId), Promise.all(ids.map(getChildToday))]);
      setApprovals(waiting);
      setDays(Object.fromEntries(todays.map((t) => [t.child.id, t])));
      update((f) => todays.reduce(applyToday, f));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [childIds, familyId, update]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  async function decide(item: Approval, approve: boolean) {
    const ok = await askPin(approve ? `Approve "${item.title}" for ${item.child_name}.` : `Send "${item.title}" back to ${item.child_name}.`);
    if (!ok) return;
    setDeciding(item.completion_id);
    setError(null);
    const before = days[item.child_id]?.progress.level;
    try {
      const result = await (approve ? approveCompletion : rejectCompletion)(item.completion_id);
      update((f) => applyProgress(f, result.child_id, result.progress, result.points));
      if (approve && before !== undefined && result.progress.level > before) {
        setLevelUp({
          habit: { id: item.habit_id, kidTitle: item.kid_title }, name: item.child_name, points: item.points,
          message: `Level up! ${item.child_name} is a ${result.progress.level_name} now.`,
        });
      }
    } catch (e) {
      setError(errorText(e)); // e.g. another caregiver decided first
    }
    setDeciding(null);
    await load();
  }

  function openKidMode(childId?: string) {
    enterKidMode();
    go(childId ? `/kid/${childId}` : "/kid");
  }

  async function add(input: ChildInput) {
    await addChild(familyId, input);
    await reload();
  }

  const pending = approvals ?? [];
  const requests = pendingRedemptions(fam).length;
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

        {error && <p className="form-error" role="alert">{error}</p>}
        <SafetyAlerts family={fam} />

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
                    <HabitArt habit={item.habit_id} className="approval__art" />
                    <div className="approval__text">
                      <span className="approval__who">{child && <Buddy buddy={child.buddy} size={24} />} {item.child_name}</span>
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

        <RewardRequests family={fam} />

        {/* ── Children ─────────────────────────────────────────────────── */}
        <div className="kids-grid">
          {fam.children.map((child) => (
            <ChildCard key={child.id} family={fam} child={child} today={days[child.id]} onOpen={() => openKidMode(child.id)} />
          ))}
          <AddChildCard onAdd={add} />
        </div>

        <FamilyPanel />

        <div className="two-col">
          <KidFeedback family={fam} />
          <SurprisePlanner family={fam} />
        </div>

        <AiHelpers family={fam} onPlanSaved={() => void load()} />
      </main>
      <Footer />
      {levelUp && (
        <Celebration habits={[levelUp.habit]} name={levelUp.name} points={levelUp.points} unlocks={[levelUp.message]} onDone={() => setLevelUp(null)} />
      )}
    </div>
  );
}

function ChildCard({ family, child, today, onOpen }: { family: Family; child: Child; today?: Today; onOpen: () => void }) {
  const day = today?.day ?? dayKey();
  const quests = today?.habits ?? [];
  const done = quests.filter((h) => h.status === "approved").length;
  const sparks = today?.progress.sparks ?? child.sparks;
  const next = nextWorld(sparks);
  const week = lastDays(7);
  const streak = streakOf(family, child.id, day);
  const allowance = appAllowance(family, child, day);
  const usedMin = Math.round(appUsedSeconds(child, day) / 60);
  const nextAt = today?.progress.next_level_at;

  return (
    <article className="kid-card">
      <header className="kid-card__head">
        <Buddy buddy={child.buddy} accessory={child.wearing} size={56} />
        <div>
          <h3>{child.name}</h3>
          <span className="muted">Age {child.age} · {done} of {quests.length} today</span>
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

      {today && quests.length === 0 && <p className="empty">No quests today. Describe a problem below, or pick quests in the library.</p>}
      <ul className="kid-card__quests">
        {quests.map((h) => {
          const status = localStatus(h.status);
          return (
            <li key={h.child_habit_id}>
              <HabitArt habit={h.habit_id} className="mini-art" />
              <span>{h.kid_title}<small className="tier-tag">Tier {h.tier}</small></span>
              <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ul>

      <div className="week" aria-label="Sparks earned in the last 7 days, as seen on this device">
        {week.map((d) => {
          const n = approvedCount(family, d, child.id);
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
        <a className="btn btn--ghost btn--sm" href={`#/setup/${child.id}`}>Edit</a>
        <button className="btn btn--soft btn--sm" onClick={onOpen}>Open {child.name}'s quests</button>
      </div>
    </article>
  );
}

function FamilyPanel() {
  const { server, setServer } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fam = server!;

  async function refreshCode() {
    setBusy(true);
    setError(null);
    try {
      setServer(await newInviteCode(fam.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="family-title">
      <div className="panel__head">
        <h2 id="family-title">{fam.name}</h2>
        <span className="muted">{fam.timezone}</span>
      </div>
      <div className="invite">
        <div>
          <span className="muted">Invite code for another grown-up</span>
          <code className="invite__code">{fam.invite_code}</code>
        </div>
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={refreshCode}>New code</button>
      </div>
      <ul className="mini-list">
        {fam.caregivers.map((c) => <li key={c.user_id}><span>{c.display_name}</span><span className="muted">{c.role}</span></li>)}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
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
