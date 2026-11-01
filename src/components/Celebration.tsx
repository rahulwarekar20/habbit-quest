/**
 * Sparkle celebration shown to a child when a grown-up has approved a quest:
 * a burst in the buddy's style, the quest picture, "+N Sparks", the points earned, and anything
 * newly unlocked (a landmark, a world, or a new level with harder quests). Tap anywhere to close.
 */
import { useEffect, type CSSProperties } from "react";
import { BUDDY_THEME } from "../lib/buddyTheme";
import type { BuddyId } from "../lib/family";
import type { QuestDef } from "../lib/habits";
import HabitArt from "./HabitArt";
import { SparkIcon } from "./Spark";

interface Props {
  habits: Pick<QuestDef, "id" | "kidTitle">[];
  name: string;
  buddy: BuddyId;
  sparks: number;
  points?: number;
  unlocks?: string[];
  forKid?: boolean; // a big moment on a child's screen is worth showing to a grown-up
  buddyLine?: string | null; // AI-written line from the child's buddy, when it has arrived
  onDone: () => void;
}

export default function Celebration({ habits, name, buddy, sparks, points = 0, unlocks = [], forKid = false, buddyLine, onDone }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const first = habits[0];
  return (
    <div className="celebrate" role="dialog" aria-modal="true" aria-label="You earned a Spark" onClick={onDone}>
      <div className="celebrate__burst" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} style={{ "--a": `${i * 20}deg`, "--d": `${(i % 3) * 0.12}s` } as CSSProperties}>
            <span style={{ fontSize: 14 + (i % 3) * 8 }}>{BUDDY_THEME[buddy].confetti}</span>
          </span>
        ))}
      </div>
      <div className="celebrate__card" onClick={(e) => e.stopPropagation()}>
        <div className="celebrate__spark">
          <SparkIcon size={84} />
        </div>
        <p className="celebrate__eyebrow">Amazing, {name}!</p>
        <h2>
          +{sparks} {sparks === 1 ? "Spark" : "Sparks"}
        </h2>
        {first && (
          <div className="celebrate__quest">
            <HabitArt habit={first.id} />
            <span>
              {habits.length === 1 ? first.kidTitle : `${first.kidTitle} and ${habits.length - 1} more`}
            </span>
          </div>
        )}
        {buddyLine && <p className="celebrate__buddy">{buddyLine}</p>}
        {points > 0 && <p className="celebrate__points">+{points} points</p>}
        {unlocks.map((u) => <p key={u} className="celebrate__unlock">{u}</p>)}
        {forKid && unlocks.length > 0 && <p className="celebrate__show">Show a grown-up!</p>}
        <button className="btn btn--gold btn--lg" onClick={onDone} autoFocus>
          Yay!
        </button>
      </div>
    </div>
  );
}
