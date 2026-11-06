import { KidGoalReference } from "./CatalogVisual";
/**
 * One picture quest on the kid's today screen: art, time, points and any boost, and the big
 * "I did it!" button; a submitted quest shows an hourglass until a grown-up approves it.
 */
import Clock from "./Clock";
import { useEffect, useState } from "react";
import HabitArt from "./HabitArt";
import { SparkIcon } from "./Spark";
import { errorText, getKidHabitDetails, type KidHabitDetails, type TodayHabit } from "../lib/api";
import { type QuestStatus } from "../lib/family";
import { QUEST_BY_ID } from "../lib/habits";
import { formatTime } from "../lib/time";

/** One quest card (see above). `onDone` is the "I did it!" tap. */
export function QuestCard({ habit, status, points, boost, multiplier, golden, onDone }: {
  habit: TodayHabit; status: QuestStatus; points: number; boost: string[]; multiplier: number; golden: boolean; onDone: () => void;
}) {
  const known = QUEST_BY_ID[habit.habit_id];
  return (
    <article className={`quest quest--${status} ${golden ? "quest--golden" : ""}`}>
      <div className="quest__art">
        <HabitArt habit={habit.habit_id} icon={habit.icon} text={`${habit.kid_title} ${habit.kid_hint}`} />
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

        {habit.habit_id.startsWith("my-ai-") && <GeneratedSteps key={habit.habit_id} habitId={habit.habit_id} />}

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

/** Loads only accepted, child-visible wording with the current kid token. */
export function GeneratedSteps({ habitId }: { habitId: string }) {
  const [details, setDetails] = useState<KidHabitDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    getKidHabitDetails(habitId).then(result => { if (live) setDetails(result); }).catch(error => { if (live) setError(errorText(error)); });
    return () => { live = false; };
  }, [habitId, reload]);
  return <div className="generated-steps">
    {!details && !error && <p role="status">Loading your steps…</p>}
    {error && <p role="alert">{error} <button type="button" className="link-button" onClick={() => setReload(value => value + 1)}>Try loading steps again</button></p>}
    {details && <><p className="habit-draft__instruction">{details.instruction}</p>
      <ol className="practice-steps">{details.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
      <p className="habit-finish"><b>Done when:</b> {details.completion}</p>
      <KidGoalReference goalId={details.goal_id} />
      <details><summary>Things to have ready and help</summary>
        {details.materials.length > 0 && <p><b>You need:</b> {details.materials.join(", ")}</p>}
        <p><b>When:</b> {details.cue}</p>{details.help_text && <p><b>Need help?</b> {details.help_text}</p>}
      </details>
    </>}
  </div>;
}

// ── Explore a world ───────────────────────────────────────────────────────────

function HourglassIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h12v4l-4 6 4 6v4H6v-4l4-6-4-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 19h6l-3-4z" fill="currentColor" />
    </svg>
  );
}
