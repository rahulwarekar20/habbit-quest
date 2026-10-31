/**
 * Kid mode: "Who's playing?", the child's picture quests for today, and world exploring.
 *
 * Today's quests, "I did it!" and the balance come from the backend with the kid token. Worlds,
 * chests, surprises, boosts and the time limit stay in the browser.
 *
 * Children see pictures, clocks and big buttons instead of text-heavy lists. Each quest shows
 * the points it's worth and any boost (golden quest, streak, surprise double day). When a
 * grown-up approves a quest, the child sees a sparkle celebration with points, new worlds and
 * level-ups (which unlock harder quest tiers). Finishing every quest opens a treasure chest.
 * Parents' surprises pop up as presents. When the parent allows it, the child's buddy says
 * short AI-written encouragement (safety-checked on the server).
 *
 * Kid-mode time counts towards the parent's daily limit; when it runs out, a break screen
 * covers the app. Leaving kid mode needs the parent PIN.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import Celebration from "../components/Celebration";
import Clock from "../components/Clock";
import HabitArt from "../components/HabitArt";
import {
  BreakTime, ChestCard, CheckIn, LevelBadge, PointsPill, SurpriseReveal, TimeWarning, usePlaytime,
} from "../components/KidExtras";
import Logo from "../components/Logo";
import { SparkCount, SparkIcon } from "../components/Spark";
import WorldArt from "../components/WorldArt";
import { aiState, type BuddyEvent, type BuddyRequest } from "../lib/agents";
import { useBuddyLine } from "../lib/agentClient";
import type { TodayHabit } from "../lib/api";
import {
  BOOST_LABEL, LEVELS, WORLDS, WORLD_BY_ID, boostFor, celebrationsDue, discover, isUnlocked, levelOf, markCelebrated,
  streakOf, type Child, type QuestStatus, type WorldId,
} from "../lib/family";
import { feedbackFor } from "../lib/feedback";
import { QUEST_BY_ID } from "../lib/habits";
import { dueSurprises } from "../lib/rewards";
import { go } from "../lib/router";
import { setKidMode } from "../lib/storage";
import { useStore } from "../lib/store";
import { boostExtra, creditBoost, localStatus } from "../lib/sync";
import { formatTime, greeting } from "../lib/time";
import { useKidDay } from "../lib/useKidDay";

/** Top bar shared by the kid screens, with the PIN-protected way back to the parent area. */
export function KidBar({ child }: { child?: Child }) {
  const { askPin } = useStore();
  async function grownUps() {
    if (await askPin("Leave kid mode and open the parent dashboard.")) {
      setKidMode(false);
      go("/parent");
    }
  }
  return (
    <header className="kidbar">
      <div className="wrap kidbar__inner">
        <Logo href={child ? `#/kid/${child.id}` : "#/kid"} />
        <div className="kidbar__right">
          {child && <a href={`#/shop/${child.id}`} className="kidbar__points" aria-label="Reward shop"><PointsPill points={child.balance} /></a>}
          {child && <SparkCount count={child.sparks} />}
          <button className="btn btn--ghost btn--sm kidbar__lock" onClick={grownUps} aria-label="Grown-ups">
            <LockIcon /> <span className="lock-label">Grown-ups</span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Who's playing? ────────────────────────────────────────────────────────────

export function KidPicker() {
  const { family } = useStore();
  const fam = family!;
  useEffect(() => {
    if (fam.children.length === 1) go(`/kid/${fam.children[0].id}`);
  }, [fam.children]);

  return (
    <div className="page page--kid">
      <KidBar />
      <main className="wrap kid-main kid-picker">
        <h1>Who's on a quest today?</h1>
        <div className="kid-picker__grid">
          {fam.children.map((c) => (
            <a key={c.id} className="kid-picker__card" href={`#/kid/${c.id}`}>
              <Buddy buddy={c.buddy} accessory={c.wearing} size={110} />
              <b>{c.name}</b>
              <SparkCount count={c.sparks} />
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

// ── Today's quests ────────────────────────────────────────────────────────────

interface Celebrating {
  quests: { id: string; kidTitle: string }[];
  points: number;
  unlocks: string[];
}

export function KidQuests({ childId }: { childId: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId);
  const { today, error, lapsed, reload, submit, resume } = useKidDay(childId, true);
  const day = today?.day ?? "";
  const [celebrating, setCelebrating] = useState<Celebrating | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<TodayHabit | null>(null);
  const [checkIn, setCheckIn] = useState(false);
  const secondsLeft = usePlaytime(child);

  // Buddy lines: null request = buddy talk is off (or no child), so nothing is fetched.
  const talk = !!child && aiState(fam).buddyTalk;
  const buddyAsk = (event: BuddyEvent, quests: string[]): BuddyRequest | null =>
    talk && child ? { event, buddy: child.buddy, name: child.name, age: child.age, quests, sparks: child.sparks } : null;
  const quests = today?.habits ?? [];
  const remaining = quests.filter((q) => q.status !== "approved");
  const greetLine = useBuddyLine(`${childId}:greet`, today ? buddyAsk("greet", remaining.map((h) => h.kid_title)) : null);
  const submittedLine = useBuddyLine(`${childId}:submitted:${submitted?.habit_id}`,
    submitted ? buddyAsk("submitted", [submitted.kid_title]) : null);
  const celebrateLine = useBuddyLine(`${childId}:celebrate:${celebrating?.quests.map((h) => h.id).join("+")}`,
    celebrating ? buddyAsk("celebrate", celebrating.quests.map((h) => h.kidTitle)) : null);
  const buddySays = submittedLine ?? greetLine;

  const surprises = child && today ? dueSurprises(fam, child.id, day) : [];

  // Show a celebration for any approvals the child hasn't seen yet (after any surprise).
  const due = child && today ? celebrationsDue(fam, day, child.id) : [];
  useEffect(() => {
    if (!child || !today || due.length === 0 || celebrating || surprises.length > 0) return;
    const before = child.sparks - due.length;
    const unlocks = WORLDS.filter((w) => w.sparks > 0 && before < w.sparks && child.sparks >= w.sparks).map((w) => `New world unlocked: ${w.name}!`);
    const level = levelOf(child.sparks);
    if (level.level > child.levelSeen) {
      const gainedTier = level.tier > (LEVELS.find((l) => l.level === child.levelSeen)?.tier ?? 1);
      unlocks.push(`Level up! You're a ${level.name} now${gainedTier ? ` and tier ${level.tier} quests are unlocked` : ""}!`);
    }
    const earned = due.flatMap((q) => quests.filter((h) => h.habit_id === q.id));
    const points = earned.reduce((n, h) => n + h.points + boostExtra(fam, day, child.id, h.habit_id, h.points), 0);
    setCelebrating({ quests: due, points, unlocks });
    update((f) => markCelebrated(
      earned.reduce((next, h) => creditBoost(next, day, child.id, h.habit_id, h.kid_title, h.points), f),
      day, child.id, due.map((h) => h.id),
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.length, child?.id, surprises.length, today]);

  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;

  const done = quests.filter((q) => q.status === "approved").length;
  const streak = today ? streakOf(fam, child.id, day) : 0;
  const checkedIn = today ? !!feedbackFor(fam, child.id, day) : false;

  async function didIt(quest: TodayHabit) {
    if (!(await submit(quest))) return;
    setSubmitted(quest);
    setCheer(`Great job! A grown-up will check "${quest.kid_title}" soon.`);
    window.setTimeout(() => setCheer(null), 3500);
  }

  return (
    <div className="page page--kid">
      <KidBar child={child} />
      <main className="wrap kid-main">
        <section className="kid-hero">
          <Buddy buddy={child.buddy} accessory={child.wearing} size={92} />
          <div className="kid-hero__text">
            <h1>{greeting()}, {child.name}!</h1>
            <p>
              {!today
                ? "Getting your quests…"
                : quests.length === 0
                  ? "No quests today. Enjoy your day!"
                  : done === quests.length
                    ? "You finished every quest today. Super star!"
                    : `You've earned ${done} of ${quests.length} Sparks today. Let's go!`}
            </p>
            {buddySays && <p className="speech" aria-live="polite">{buddySays}</p>}
            <div className="star-path" aria-label={`${done} of ${quests.length} quests done`}>
              {quests.map((h) => (
                <span key={h.child_habit_id} className={h.status === "approved" ? "is-lit" : ""}>
                  <SparkIcon size={26} />
                </span>
              ))}
            </div>
          </div>
          <div className="kid-hero__side">
            <LevelBadge child={child} />
            {streak >= 2 && <span className="streak">🔥 {streak}-day streak</span>}
            {fam.doubleDays.includes(day) && <span className="streak streak--double">⚡ Double points day</span>}
          </div>
        </section>

        {error && (
          <div className="kid-error">
            <p className="form-error" role="alert">{error}</p>
            <button className="btn btn--soft btn--sm" onClick={reload}>Try again</button>
          </div>
        )}

        <div className="quest-grid">
          {quests.map((h) => {
            const boost = boostFor(fam, day, child.id, h.habit_id);
            return (
              <QuestCard key={h.child_habit_id} habit={h} status={localStatus(h.status)} points={h.points * boost.multiplier}
                boost={boost.reasons.map((r) => BOOST_LABEL[r])} multiplier={boost.multiplier} golden={boost.reasons.includes("golden")} onDone={() => didIt(h)} />
            );
          })}
        </div>

        {today && <ChestCard family={fam} child={child} day={day} />}

        <div className="kid-actions">
          <button className="kid-action kid-action--checkin" onClick={() => setCheckIn(true)}>
            <span aria-hidden="true">💌</span>
            <div><b>{checkedIn ? "Change your check-in" : "How was today?"}</b><span>{checkedIn ? "Sent to your grown-ups ✓" : "Tell your grown-ups"}</span></div>
          </button>
          <a className="kid-action kid-action--shop" href={`#/shop/${child.id}`}>
            <span aria-hidden="true">🛍️</span>
            <div><b>Reward shop</b><span>You have {today?.points ?? child.balance} points</span></div>
          </a>
        </div>

        <section className="kid-worlds">
          <h2>Your worlds</h2>
          <div className="kid-worlds__grid">
            {WORLDS.map((w) => {
              const open = isUnlocked(w, child.sparks);
              return (
                <a key={w.id} href={open ? `#/world/${child.id}/${w.id}` : undefined}
                  className={`kid-world ${open ? "is-open" : "is-locked"}`} aria-disabled={!open}>
                  <WorldArt world={w.id} />
                  <div className="kid-world__label">
                    <b>{w.name}</b>
                    {open ? (
                      <span className="btn btn--gold btn--sm">Explore</span>
                    ) : (
                      <span className="kid-world__lock"><LockIcon /> {child.sparks} / {w.sparks} <SparkIcon size={14} /></span>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      </main>

      <TimeWarning seconds={secondsLeft} />
      {cheer && <div className="toast" role="status">{cheer}</div>}
      {surprises[0] && <SurpriseReveal surprise={surprises[0]} child={child} parentName={fam.parentName} />}
      {!surprises[0] && celebrating && (
        <Celebration habits={celebrating.quests} name={child.name} points={celebrating.points} unlocks={celebrating.unlocks}
          buddyLine={celebrateLine} onDone={() => setCelebrating(null)} />
      )}
      {checkIn && <CheckIn family={fam} child={child} onClose={() => setCheckIn(false)} />}
      {secondsLeft === 0 && <BreakTime child={child} family={fam} />}
    </div>
  );
}

function QuestCard({ habit, status, points, boost, multiplier, golden, onDone }: {
  habit: TodayHabit; status: QuestStatus; points: number; boost: string[]; multiplier: number; golden: boolean; onDone: () => void;
}) {
  const known = QUEST_BY_ID[habit.habit_id];
  return (
    <article className={`quest quest--${status} ${golden ? "quest--golden" : ""}`}>
      <div className="quest__art">
        <HabitArt habit={habit.habit_id} />
        {golden && status !== "approved" && <span className="quest__golden">✨ Golden quest</span>}
        {known && !known.routine && <span className="quest__tier">Bonus · Tier {habit.tier}</span>}
        {status === "approved" && (
          <span className="quest__stamp"><SparkIcon size={40} /></span>
        )}
      </div>
      <div className="quest__body">
        <div className="quest__title">
          <div>
            <h3>{habit.kid_title}</h3>
            <p>{habit.kid_hint}</p>
          </div>
          <Clock time={habit.cue_time} size={54} />
        </div>
        <div className="quest__chips">
          <span className="chip">by {formatTime(habit.cue_time)}</span>
          {status !== "approved" && (
            <span className={`chip ${boost.length ? "chip--gold" : ""}`} title={boost.join(" + ")}>
              🪙 {points} pts{multiplier > 1 ? ` · ${multiplier}x` : ""}
            </span>
          )}
        </div>

        {status === "todo" && <button className="btn btn--gold btn--block btn--lg" onClick={onDone}>I did it!</button>}
        {status === "notyet" && (
          <>
            <p className="quest__note">Not quite yet. You can do it!</p>
            <button className="btn btn--gold btn--block btn--lg" onClick={onDone}>I did it now!</button>
          </>
        )}
        {status === "submitted" && (
          <div className="quest__state quest__state--wait">
            <HourglassIcon /> Waiting for a grown-up
          </div>
        )}
        {status === "approved" && (
          <div className="quest__state quest__state--done">
            <SparkIcon size={20} /> Spark earned!
          </div>
        )}
      </div>
    </article>
  );
}

// ── Explore a world ───────────────────────────────────────────────────────────

export function WorldExplore({ childId, worldId }: { childId: string; worldId: string }) {
  const { family, update } = useStore();
  const child = family!.children.find((c) => c.id === childId);
  const world = WORLD_BY_ID[worldId as WorldId];
  const { lapsed, resume } = useKidDay(childId); // keeps Sparks current on a direct visit
  const [found, setFound] = useState<string | null>(null);
  const secondsLeft = usePlaytime(child);

  if (!child || !world) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;
  const open = isUnlocked(world, child.sparks);
  const seen = (id: string) => child.discoveries.includes(`${world.id}:${id}`);
  const foundCount = world.discoveries.filter((d) => seen(d.id)).length;

  return (
    <div className="page page--kid">
      <KidBar child={child} />
      <main className="wrap kid-main">
        <a className="back" href={`#/kid/${child.id}`}>&larr; Back to my quests</a>
        <div className="explore-head">
          <h1>{world.name}</h1>
          {open && <span className="chip chip--gold">Found {foundCount} of {world.discoveries.length}</span>}
        </div>

        {!open ? (
          <div className="explore-locked">
            <WorldArt world={world.id} />
            <div>
              <LockIcon />
              <p>Earn {world.sparks - child.sparks} more Sparks to open {world.name}!</p>
            </div>
          </div>
        ) : (
          <>
            <p className="lead">{world.blurb} Tap the sparkles to find hidden treasures.</p>
            <div className="explore-scene">
              <WorldArt world={world.id} />
              {world.discoveries.map((d) => (
                <button key={d.id} className={`hotspot ${seen(d.id) ? "is-found" : ""}`}
                  style={{ left: `${d.x}%`, top: `${d.y}%` }}
                  aria-label={seen(d.id) ? d.name : "Hidden treasure"}
                  onClick={() => {
                    update((f) => discover(f, child.id, `${world.id}:${d.id}`));
                    setFound(d.name);
                  }}>
                  {seen(d.id) ? <span className="hotspot__label">{d.name}</span> : <SparkIcon size={28} />}
                </button>
              ))}
            </div>
            {found && <div className="toast" role="status" onAnimationEnd={() => setFound(null)}>You found: {found}!</div>}
          </>
        )}
      </main>
      <TimeWarning seconds={secondsLeft} />
      {secondsLeft === 0 && <BreakTime child={child} family={family!} />}
    </div>
  );
}

/** The kid session ran out: a grown-up starts it again with the PIN. */
export function KidLapsed({ onResume }: { onResume: () => void }) {
  return (
    <div className="page page--kid">
      <main className="wrap kid-main">
        <h1>Quest time paused</h1>
        <p className="lead">Ask a grown-up to start your quests again.</p>
        <button className="btn btn--gold btn--lg" onClick={onResume}>Grown-ups: enter PIN</button>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page page--kid">
      <main className="wrap kid-main">
        <h1>Hmm, we couldn't find that.</h1>
        <a className="btn btn--primary" href="#/kid">Back to quests</a>
      </main>
    </div>
  );
}

export function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
  );
}

function HourglassIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h12v4l-4 6 4 6v4H6v-4l4-6-4-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 19h6l-3-4z" fill="currentColor" />
    </svg>
  );
}
