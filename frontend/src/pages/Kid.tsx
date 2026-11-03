/**
 * Kid mode: "Who's playing?" and the child's picture quests for today. Exploring a world is
 * WorldExplore.tsx; the top bar and other shared pieces are components/KidChrome.tsx.
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
import { JourneyCard } from "../components/Journey";
import { BreakTime, ChestCard, CheckIn, LevelBadge, SurpriseReveal, TimeWarning, usePlaytime } from "../components/KidExtras";
import { SparkCount, SparkIcon } from "../components/Spark";
import WorldArt from "../components/WorldArt";
import PinDialog from "../components/PinDialog";
import { ApiError, errorText, getTodayCheckin, startKidSession, updateKidExtras, type TodayHabit } from "../lib/api";
import { useBuddyLine, type BuddyEvent } from "../lib/buddy";
import { BUDDY_THEME, buddyNudge } from "../lib/buddyTheme";
import { BOOST_LABEL, WORLDS, celebrationsDue, isUnlocked, markCelebrated, type Child } from "../lib/family";
import { readyLandmarks } from "../lib/journeyPath";
import { go } from "../lib/router";
import { getKidLogin, getKidSession, saveKidSession } from "../lib/storage";
import { useStore } from "../lib/store";
import { weekdayName } from "../lib/schedule";
import { localStatus } from "../lib/sync";
import { greeting } from "../lib/time";
import { useKidDay } from "../lib/useKidDay";
import { KidBar, KidLapsed, NotFound, LockIcon } from "../components/KidChrome";
import { QuestCard } from "../components/QuestCard";

export function KidPicker() {
  const { family } = useStore();
  const fam = family!;
  const [asking, setAsking] = useState<Child | null>(null);
  useEffect(() => {
    // One child without a PIN goes straight in; a child who signed in on their own has only themselves.
    const only = fam.children.length === 1 && !fam.children[0].hasPin ? fam.children[0] : null;
    const own = getKidLogin()?.childId;
    if (own || only) go(`/kid/${own ?? only!.id}`);
  }, [fam.children]);

  function pick(child: Child) {
    if (child.hasPin && getKidSession()?.childId !== child.id) setAsking(child);
    else go(`/kid/${child.id}`);
  }

  // The kid PIN goes to the server with the session request: a wrong one starts nothing.
  async function checkPin(pin: string | null): Promise<boolean | string> {
    const child = asking!;
    if (pin === null) {
      setAsking(null);
      return true;
    }
    try {
      const session = await startKidSession(child.id, pin);
      saveKidSession(session.access_token, session.expires_in, child.id, session.child.name);
    } catch (e) {
      return e instanceof ApiError && e.status === 403 ? false : errorText(e);
    }
    setAsking(null);
    go(`/kid/${child.id}`);
    return true;
  }

  return (
    <div className="page page--kid">
      <KidBar />
      <main className="wrap kid-main kid-picker">
        <h1>Who's on a quest today?</h1>
        <div className="kid-picker__grid">
          {fam.children.map((c) => (
            <button key={c.id} className="kid-picker__card" onClick={() => pick(c)}>
              <Buddy buddy={c.buddy} accessory={c.wearing} size={110} />
              <b>{c.name}</b>
              <SparkCount count={c.sparks} />
              {c.hasPin && <span className="kid-picker__lock" aria-label="Needs your PIN"><LockIcon /></span>}
            </button>
          ))}
        </div>
      </main>
      {asking && (
        <PinDialog eyebrow={`Hi, ${asking.name}!`} title="Enter your PIN" reason="Your own 4-digit PIN keeps your quests yours." onSubmit={checkPin} />
      )}
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
