/**
 * The world journey in kid mode: the small progress card on the quest screen, the path across a
 * world with the child's buddy on it, and the buddy picker. Sparks are steps: the buddy walks
 * when a grown-up approves a quest, and dotted steps show quests waiting for approval.
 */
import { useEffect, useState } from "react";
import type { Journey, JourneyWorld, Landmark, Progress } from "../lib/api";
import { updateKidExtras } from "../lib/api";
import { BUDDY_THEME } from "../lib/buddyTheme";
import { updateChild, type Child } from "../lib/family";
import { landmarkState, positionAt, prints, readyLandmarks, trail } from "../lib/journeyPath";
import { useStore } from "../lib/store";
import Buddy, { BUDDIES } from "./Buddy";
import { SparkIcon } from "./Spark";
import WorldArt from "./WorldArt";

/** "Where am I?" on the quest screen. */
export function JourneyCard({ child, journey, progress }: { child: Child; journey: Journey | null; progress: Progress }) {
  const world = journey?.worlds.find((w) => w.id === progress.world);
  if (!journey || !world) return null;
  const ready = readyLandmarks(journey.worlds, progress.sparks, child.discoveries)[0];
  const next = progress.next_landmark;
  const from = Math.max(world.sparks, ...world.landmarks.filter((m) => m.sparks <= progress.sparks).map((m) => m.sparks));
  const pct = next ? ((progress.sparks - from) / (next.sparks - from)) * 100 : 100;
  const target = ready ? ready.world.id : world.id;
  return (
    <a className={`journey-card ${ready ? "journey-card--ready" : ""}`} href={`#/world/${child.id}/${target}`}>
      <Buddy buddy={child.buddy} accessory={child.wearing} size={56} />
      <div>
        <b>{world.name}</b>
        {ready
          ? <span>Something is waiting for you. Tap to find it!</span>
          : next
            ? <span>{next.sparks - progress.sparks} {next.sparks - progress.sparks === 1 ? "Spark" : "Sparks"} to your next find</span>
            : <span>You've walked every path!</span>}
        <div className="bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
        {progress.pending_sparks > 0 && <small>+{progress.pending_sparks} waiting for a grown-up</small>}
      </div>
    </a>
  );
}

const walkedKey = (childId: string) => `habbit-quest.walked.${childId}`;

function lastWalked(childId: string, sparks: number): number {
  try {
    const saved = Number(localStorage.getItem(walkedKey(childId)));
    return saved > 0 && saved <= sparks ? saved : sparks;
  } catch {
    return sparks;
  }
}

/** Starts the buddy where the child last saw it, then lets it walk to where it is now. */
function useWalkedSparks(childId: string, sparks: number): number {
  const [shown, setShown] = useState(() => lastWalked(childId, sparks));
  useEffect(() => {
    const id = window.setTimeout(() => setShown(sparks), 350);
    try {
      localStorage.setItem(walkedKey(childId), String(sparks));
    } catch {
      /* the buddy just won't walk next time */
    }
    return () => window.clearTimeout(id);
  }, [childId, sparks]);
  return shown;
}

export function WorldPath({ child, world, progress, onReveal }: {
  child: Child; world: JourneyWorld; progress: Progress; onReveal: (mark: Landmark) => void;
}) {
  const shown = useWalkedSparks(child.id, progress.sparks);
  const here = positionAt(world, shown);
  const parts = trail(world, shown, progress.pending_sparks);
  const theme = BUDDY_THEME[child.buddy];
  return (
    <div className="explore-scene">
      <WorldArt world={world.id} />
      <svg className="path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline className="path__all" points={parts.all} />
        <polyline className="path__walked" points={parts.walked} />
        {progress.pending_sparks > 0 && <polyline className="path__waiting" points={parts.waiting} />}
      </svg>
      {prints(world, shown).map((p) => (
        <span key={`${p.x}-${p.y}`} className="path__print" aria-hidden="true" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{theme.print}</span>
      ))}
      {world.landmarks.map((mark) => {
        const state = landmarkState(world, mark, progress.sparks, child.discoveries);
        const left = mark.sparks - progress.sparks;
        return (
          <button key={mark.id} className={`hotspot hotspot--${state}`} disabled={state === "hidden"}
            style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
            aria-label={state === "found" ? mark.name : state === "ready" ? "Something new! Tap to find it" : `Hidden. ${left} more Sparks`}
            onClick={() => onReveal(mark)}>
            {state === "found" ? <span aria-hidden="true">{mark.emoji}</span> : state === "ready" ? <SparkIcon size={28} /> : <span aria-hidden="true">?</span>}
          </button>
        );
      })}
      <div className="path__buddy" style={{ left: `${here.x}%`, top: `${here.y}%` }}>
        <Buddy buddy={child.buddy} accessory={child.wearing} size={46} />
      </div>
    </div>
  );
}

/** Lets a child change their buddy. Progress and outfits stay with them. */
export function BuddyPicker({ child }: { child: Child }) {
  const { update } = useStore();
  const choose = (buddy: Child["buddy"]) => {
    update((f) => updateChild(f, child.id, (c) => ({ ...c, buddy })));
    updateKidExtras({ buddy }).catch(() => {}); // the next refresh shows the saved buddy
  };
  return (
    <div className="buddy-picker" role="radiogroup" aria-label="Your buddy">
      {BUDDIES.map((b) => (
        <button key={b.id} type="button" role="radio" aria-checked={child.buddy === b.id}
          className={`buddy-option ${child.buddy === b.id ? "is-on" : ""}`} onClick={() => choose(b.id)}>
          <Buddy buddy={b.id} accessory={child.wearing} size={64} />
          <span>{b.name}</span>
        </button>
      ))}
    </div>
  );
}
