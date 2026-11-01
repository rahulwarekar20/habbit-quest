/**
 * Kid mode: "Who's playing?", the child's picture quests for today, and world exploring.
 *
 * Everything here comes from the backend with the kid token, which also pays the boosts.
 *
 * Children see pictures, clocks and big buttons instead of text-heavy lists. Each quest shows
 * the points it's worth and any boost (golden quest, streak, surprise double day, welcome back).
 * When a grown-up approves a quest, the child sees a celebration with Sparks, points, new finds,
 * worlds and level-ups, and their buddy walks along the path. Finishing every quest opens a chest.
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
import { JourneyCard, WorldPath } from "../components/Journey";
import {
  BreakTime, ChestCard, CheckIn, LevelBadge, PointsPill, SurpriseReveal, TimeWarning, usePlaytime,
} from "../components/KidExtras";
import Logo from "../components/Logo";
import { SparkCount, SparkIcon } from "../components/Spark";
import WorldArt from "../components/WorldArt";
import { getTodayCheckin, updateKidExtras, type Landmark, type TodayHabit } from "../lib/api";
import { useBuddyLine, type BuddyEvent } from "../lib/buddy";
import { BUDDY_THEME, buddyNudge } from "../lib/buddyTheme";
import {
  BOOST_LABEL, WORLDS, celebrationsDue, discover, isUnlocked, markCelebrated,
  type Child, type QuestStatus,
} from "../lib/family";
import { QUEST_BY_ID } from "../lib/habits";
import { landmarkKey, readyLandmarks } from "../lib/journeyPath";
import { go } from "../lib/router";
import { setKidMode } from "../lib/storage";
import { useStore } from "../lib/store";
import { weekdayName } from "../lib/schedule";
import { localStatus } from "../lib/sync";
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
  sparks: number;
  points: number;
  unlocks: string[];
}

export function KidQuests({ childId }: { childId: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId);
  const { today, journey, error, lapsed, surprises, dropSurprise, reload, submit, resume } = useKidDay(childId, true);
  const day = today?.day ?? "";
  const [celebrating, setCelebrating] = useState<Celebrating | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<TodayHabit | null>(null);
  const [checkIn, setCheckIn] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const secondsLeft = usePlaytime(child);

  // Buddy lines: a null event means buddy talk is off (or no child), so nothing is fetched.
  const talk = !!child && fam.settings.buddyTalk;
  const buddyAsk = (event: BuddyEvent): BuddyEvent | null => (talk ? event : null);
  const quests = today?.habits ?? [];
  const remaining = quests.filter((q) => q.status !== "approved");
  const greetLine = useBuddyLine(`${childId}:greet`, today && remaining.length > 0 ? buddyAsk("greet") : null);
  const submittedLine = useBuddyLine(`${childId}:submitted:${submitted?.habit_id}`, submitted ? buddyAsk("submitted") : null);
  const celebrateLine = useBuddyLine(`${childId}:celebrate:${celebrating?.quests.map((h) => h.id).join("+")}`,
    celebrating ? buddyAsk("celebrate") : null);
  const buddySays = submittedLine ?? greetLine;
  const progress = today?.progress;
  const waitingFind = child && journey && progress && readyLandmarks(journey.worlds, progress.sparks, child.discoveries).length > 0;
  const buddyNote = !child || !progress ? null
    : today.welcome_back ? BUDDY_THEME[child.buddy].welcomeBack
      : waitingFind ? BUDDY_THEME[child.buddy].waiting
        : progress.next_landmark ? buddyNudge(child.buddy, progress.next_landmark.sparks - progress.sparks) : null;

  useEffect(() => {
    if (today) getTodayCheckin().then((found) => setCheckedIn(!!found)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today?.day, checkIn]);

  // Show a celebration for any approvals the child hasn't seen yet (after any surprise).
  const due = child && today ? celebrationsDue(fam, day, child.id) : [];
  useEffect(() => {
    if (!child || !today || due.length === 0 || celebrating || surprises.length > 0) return;
    const earned = due.flatMap((q) => quests.filter((h) => h.habit_id === q.id));
    const sparks = earned.reduce((n, h) => n + h.tier, 0);
    const before = child.sparks - sparks;
    const unlocks = WORLDS.filter((w) => w.sparks > 0 && before < w.sparks && child.sparks >= w.sparks).map((w) => `New world unlocked: ${w.name}!`);
    const finds = journey?.worlds.flatMap((w) => w.landmarks).filter((m) => before < m.sparks && child.sparks >= m.sparks) ?? [];
    if (finds.length > 0) unlocks.push("You reached a new find on your path!");
    const level = today.progress.level;
    if (level > child.levelSeen) {
      const tier = WORLDS[level - 1].tier;
      const gainedTier = tier > WORLDS[child.levelSeen - 1].tier;
      unlocks.push(`Level up! You're a ${today.progress.level_name} now${gainedTier ? " and harder quests are open" : ""}!`);
    }
    const points = earned.reduce((n, h) => n + h.points * h.multiplier, 0);
    setCelebrating({ quests: due, sparks, points, unlocks });
    update((f) => markCelebrated(f, day, child.id, due.map((h) => h.id)));
    if (level > child.levelSeen) updateKidExtras({ level_seen: level }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due.length, child?.id, surprises.length, today]);

  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;

  const done = quests.filter((q) => q.status === "approved").length;
  const streak = today?.streak ?? 0;
  const doubleDay = quests.some((h) => h.boosts.includes("double"));

  async function didIt(quest: TodayHabit) {
    if (!(await submit(quest))) return;
    setSubmitted(quest);
    setCheer(`Great job! A grown-up will check "${quest.kid_title}" soon.`);
    window.setTimeout(() => setCheer(null), 3500);
  }

  const teaser = progress?.next_landmark
    ? `Tomorrow, you're only ${progress.next_landmark.sparks - progress.sparks} Sparks from your next find!`
    : "You finished every quest today. Super star!";

  return (
    <div className="page page--kid" data-buddy={child.buddy}>
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
                  ? today.rest_day && today.next_quest_day
                    ? `Rest day! Your next quests are on ${weekdayName(today.next_quest_day)}.`
                    : "No quests today. Enjoy your day!"
                  : done === quests.length
                    ? teaser
                    : remaining.length === 1
                      ? "One more quest and today's chest opens!"
                      : `You've done ${done} of ${quests.length} quests today. Let's go!`}
            </p>
            {(buddyNote ?? buddySays) && <p className="speech" aria-live="polite">{today?.welcome_back ? buddyNote : buddySays ?? buddyNote}</p>}
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
            {doubleDay && <span className="streak streak--double">⚡ Double points day</span>}
          </div>
        </section>

        {progress && <JourneyCard child={child} journey={journey} progress={progress} />}

        {error && (
          <div className="kid-error">
            <p className="form-error" role="alert">{error}</p>
            <button className="btn btn--soft btn--sm" onClick={reload}>Try again</button>
          </div>
        )}

        <div className="quest-grid">
          {quests.map((h) => (
            <QuestCard key={h.child_habit_id} habit={h} status={localStatus(h.status)} points={h.points * h.multiplier}
              boost={h.boosts.map((r) => BOOST_LABEL[r])} multiplier={h.multiplier} golden={h.boosts.includes("golden")} onDone={() => didIt(h)} />
          ))}
        </div>

        {today && quests.length > 0 && <ChestCard child={child} today={today} />}

        <div className="kid-actions">
          <button className="kid-action kid-action--checkin" onClick={() => setCheckIn(true)}>
            <span aria-hidden="true">💌</span>
            <div><b>{checkedIn ? "Change your check-in" : "How was today?"}</b><span>{checkedIn ? "Sent to your grown-ups ✓" : "Tell your grown-ups"}</span></div>
          </button>
          <a className="kid-action kid-action--shop" href={`#/shop/${child.id}`}>
            <span aria-hidden="true">🛍️</span>
            <div><b>Reward shop</b><span>You have {today?.points ?? child.balance} points</span></div>
          </a>
          <a className="kid-action kid-action--journal" href={`#/journal/${child.id}`}>
            <span aria-hidden="true">📔</span>
            <div><b>Field journal</b><span>{child.discoveries.length} {child.discoveries.length === 1 ? "sticker" : "stickers"} found</span></div>
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
      {surprises[0] && <SurpriseReveal key={surprises[0].id} surprise={surprises[0]} child={child} parentName={fam.parentName}
        onDone={() => dropSurprise(surprises[0].id)} />}
      {!surprises[0] && celebrating && (
        <Celebration habits={celebrating.quests} name={child.name} buddy={child.buddy} sparks={celebrating.sparks} points={celebrating.points} unlocks={celebrating.unlocks} forKid
          buddyLine={celebrateLine} onDone={() => setCelebrating(null)} />
      )}
      {checkIn && <CheckIn child={child} quests={quests.map((h) => ({ id: h.habit_id, kidTitle: h.kid_title }))} onClose={() => setCheckIn(false)} />}
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
          {habit.stars > 0 && <span className="chip chip--gold" aria-label={`${habit.stars} of 3 stars`}>{"⭐".repeat(habit.stars)}</span>}
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
  const { today, journey, lapsed, resume } = useKidDay(childId); // keeps Sparks current on a direct visit
  const [found, setFound] = useState<Landmark | null>(null);
  const secondsLeft = usePlaytime(child);

  const world = journey?.worlds.find((w) => w.id === worldId);
  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;
  if (journey && !world) return <NotFound />;
  const summary = WORLDS.find((w) => w.id === worldId);
  if (!summary) return <NotFound />;
  const open = isUnlocked(summary, child.sparks);
  const foundCount = world?.landmarks.filter((m) => child.discoveries.includes(landmarkKey(world, m))).length ?? 0;
  const progress = today?.progress;
  const next = progress?.next_landmark;

  function reveal(mark: Landmark) {
    setFound(mark);
    const key = `${worldId}:${mark.id}`;
    update((f) => discover(f, childId, key));
    updateKidExtras({ discover: key }).catch(() => {});
  }

  return (
    <div className="page page--kid" data-buddy={child.buddy}>
      <KidBar child={child} />
      <main className="wrap kid-main">
        <a className="back" href={`#/kid/${child.id}`}>&larr; Back to my quests</a>
        <div className="explore-head">
          <h1>{summary.name}</h1>
          {open && world && <span className="chip chip--gold">Found {foundCount} of {world.landmarks.length}</span>}
        </div>

        {!open ? (
          <div className="explore-locked">
            <WorldArt world={summary.id} />
            <div>
              <LockIcon />
              <p>Earn {summary.sparks - child.sparks} more Sparks to open {summary.name}!</p>
            </div>
          </div>
        ) : world && progress ? (
          <>
            <p className="lead">{world.blurb}</p>
            <WorldPath child={child} world={world} progress={progress} onReveal={reveal} />
            {next?.world === world.id && (
              <p className="path__next"><SparkIcon size={20} /> {next.sparks - progress.sparks} more {next.sparks - progress.sparks === 1 ? "Spark" : "Sparks"} to reveal the next find!</p>
            )}
            {progress.pending_sparks > 0 && <p className="hint">The dotted steps are quests waiting for a grown-up.</p>}
          </>
        ) : <p className="lead">Getting your map…</p>}
      </main>
      {found && (
        <div className="kid-overlay" role="dialog" aria-modal="true" aria-label={`You found ${found.name}`} onClick={() => setFound(null)}>
          <div className="kid-overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="reveal__emoji" aria-hidden="true">{found.emoji}</div>
            <h2>You found the {found.name}!</h2>
            <p>It's in your field journal now.</p>
            <button className="btn btn--gold btn--lg" onClick={() => setFound(null)} autoFocus>Yay!</button>
          </div>
        </div>
      )}
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
