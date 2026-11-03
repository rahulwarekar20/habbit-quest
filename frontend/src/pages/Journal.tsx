/**
 * The field journal: a child's collection. It holds the buddy picker, a sticker for every landmark
 * found, and stars for each quest practised. Nothing in here can ever be lost.
 */
import { BreakTime, TimeWarning, usePlaytime } from "../components/KidExtras";
import { BuddyPicker } from "../components/Journey";
import { landmarkKey } from "../lib/journeyPath";
import { useStore } from "../lib/store";
import { useKidDay } from "../lib/useKidDay";
import { KidBar, KidLapsed, NotFound } from "./Kid";

const MEDAL = ["", "Bronze", "Silver", "Gold"];

export default function Journal({ childId }: { childId: string }) {
  const { family } = useStore();
  const child = family!.children.find((c) => c.id === childId);
  const { journey, lapsed, resume } = useKidDay(childId);
  const secondsLeft = usePlaytime(child);
  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;
  const total = journey?.worlds.reduce((n, w) => n + w.landmarks.length, 0) ?? 0;

  return (
    <div className="page page--kid" data-buddy={child.buddy}>
      <KidBar child={child} />
      <main className="wrap kid-main">
        <a className="back" href={`#/kid/${child.id}`}>&larr; Back to my quests</a>
        <h1>{child.name}'s field journal</h1>

        <section className="panel">
          <div className="panel__head"><h2>My buddy</h2></div>
          <BuddyPicker child={child} />
          <p className="hint">Your Sparks and outfits stay the same when you change buddy.</p>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2>Stickers</h2>
            <span className="chip chip--gold">{child.discoveries.length} of {total}</span>
          </div>
          {journey?.worlds.map((world) => (
            <div key={world.id} className="journal-world">
              <h3>{world.name}</h3>
              <div className="stickers">
                {world.landmarks.map((mark) => {
                  const found = child.discoveries.includes(landmarkKey(world, mark));
                  return (
                    <div key={mark.id} className={`sticker-slot ${found ? "is-found" : ""}`}>
                      <span aria-hidden="true">{found ? mark.emoji : "?"}</span>
                      <small>{found ? mark.name : "Not found yet"}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="panel__head"><h2>Quest stars</h2></div>
          {journey?.quest_stars.length === 0 && <p className="empty">Finish a quest to earn your first star.</p>}
          <ul className="mini-list">
            {journey?.quest_stars.map((quest) => (
              <li key={quest.habit_id}>
                <span>{quest.icon} {quest.kid_title}</span>
                <span className="quest-stars" aria-label={`${quest.stars} of 3 stars`}>
                  {"⭐".repeat(quest.stars)}{" "}
                  <small>{quest.stars === 3 ? "Gold!" : quest.stars ? `${MEDAL[quest.stars]}, ${quest.targets[quest.stars] - quest.approvals} to go` : `${quest.targets[0] - quest.approvals} to go`}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <TimeWarning seconds={secondsLeft} />
      {secondsLeft === 0 && <BreakTime child={child} family={family!} />}
    </div>
  );
}
