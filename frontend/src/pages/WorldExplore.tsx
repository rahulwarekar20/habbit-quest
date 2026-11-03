/**
 * Exploring one world in kid mode: its scene, the path of landmarks found so far, and what
 * the next Spark reveals. Locked worlds show how many Sparks they need.
 */
import { useState } from "react";
import { WorldPath } from "../components/Journey";
import { BreakTime, TimeWarning, usePlaytime } from "../components/KidExtras";
import { SparkIcon } from "../components/Spark";
import WorldArt from "../components/WorldArt";
import { updateKidExtras, type Landmark } from "../lib/api";
import { WORLDS, discover, isUnlocked } from "../lib/family";
import { landmarkKey } from "../lib/journeyPath";
import { useStore } from "../lib/store";
import { useKidDay } from "../lib/useKidDay";
import { KidBar, KidLapsed, NotFound, LockIcon } from "../components/KidChrome";

/** Exploring one world (#/world/:child/:world). */
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
