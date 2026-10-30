/**
 * Quest library (parent): browse every bonus quest by tier and add up to four per child.
 * Tier 2 and 3 quests stay locked until the child reaches the level that unlocks them,
 * which turns harder habits into something to look forward to. Quests outside the child's
 * age range are hidden.
 */
import Buddy from "../components/Buddy";
import HabitArt from "../components/HabitArt";
import { Footer, ParentHeader } from "../components/Headers";
import {
  LEVELS, MAX_BONUS_QUESTS, addBonusQuest, bonusQuestBlocker, levelForTier, levelOf, nextLevel, removeBonusQuest,
} from "../lib/family";
import { CATEGORY_LABEL, LIBRARY, QUEST_BY_ID, fitsAge, type Tier } from "../lib/habits";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

const TIER_INFO: Record<Tier, string> = {
  1: "Small, concrete steps. Open from the start.",
  2: "A bit more responsibility. Worth 1.5x the points.",
  3: "Independence and self-management. Worth 2x the points.",
};

export default function QuestLibrary({ childId }: { childId?: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  if (!child) return null;
  const level = levelOf(child.sparks);
  const next = nextLevel(child.sparks);

  return (
    <div className="page page--app">
      <ParentHeader active="quests" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Quest library</p>
            <h1>Bonus quests for {child.name}</h1>
            <p className="lead">
              Add up to {MAX_BONUS_QUESTS} extra quests on top of the daily routine. Harder tiers unlock as {child.name} levels up.
              Not sure where to start? Tell the habit coach on the dashboard what's going on.
            </p>
          </div>
        </div>

        {fam.children.length > 1 && (
          <div className="about" role="tablist" aria-label="Child">
            {fam.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} className={`about__chip ${c.id === child.id ? "is-on" : ""}`}
                onClick={() => go(`/quests/${c.id}`)}>
                <Buddy buddy={c.buddy} accessory={c.wearing} size={24} /> {c.name}
              </button>
            ))}
          </div>
        )}

        <section className="panel">
          <div className="panel__head">
            <h2>{child.name}'s bonus quests ({child.bonusQuests.length}/{MAX_BONUS_QUESTS})</h2>
            <span className="chip">Level {level.level} · {level.name}{next ? ` · ${next.sparks - child.sparks} Sparks to ${next.name}` : ""}</span>
          </div>
          {child.bonusQuests.length === 0 ? (
            <p className="empty">No bonus quests yet. Pick one below.</p>
          ) : (
            <div className="lib-row">
              {child.bonusQuests.map((id) => {
                const q = QUEST_BY_ID[id];
                return q && (
                  <article key={id} className="lib-card is-added">
                    <HabitArt habit={id} />
                    <div className="lib-card__body">
                      <b>{q.parentTitle}</b>
                      <span className="muted">Tier {q.tier} · {CATEGORY_LABEL[q.category]}</span>
                      <button className="btn btn--ghost btn--sm" onClick={() => update((f) => removeBonusQuest(f, child.id, id))}>Remove</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {([1, 2, 3] as Tier[]).map((tier) => {
          const quests = LIBRARY.filter((q) => q.tier === tier && fitsAge(q, child.age) && !child.bonusQuests.includes(q.id));
          const locked = tier > level.tier;
          const unlockAt = levelForTier(tier);
          return (
            <section key={tier} className={`panel tier ${locked ? "tier--locked" : ""}`}>
              <div className="panel__head">
                <div>
                  <h2>Tier {tier} {locked && "🔒"}</h2>
                  <p className="muted">{TIER_INFO[tier]}</p>
                </div>
                {locked && (
                  <span className="chip chip--gold">
                    Unlocks at level {unlockAt.level} ({unlockAt.name}): {unlockAt.sparks - child.sparks} more Sparks
                  </span>
                )}
              </div>
              <div className="lib-grid">
                {quests.map((q) => {
                  const blocker = bonusQuestBlocker(fam, child.id, q.id);
                  return (
                    <article key={q.id} className="lib-card">
                      <HabitArt habit={q.id} />
                      <div className="lib-card__body">
                        <b>{q.parentTitle}</b>
                        <p>{q.description}</p>
                        <span className="muted">{CATEGORY_LABEL[q.category]} · ages {q.ages[0]}-{q.ages[1]}</span>
                        <button className="btn btn--soft btn--sm" disabled={!!blocker} title={blocker ?? undefined}
                          onClick={() => update((f) => addBonusQuest(f, child.id, q.id))}>
                          {locked ? "Locked" : blocker ? "Full" : `Add for ${child.name}`}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {quests.length === 0 && <p className="empty">Nothing more in this tier for age {child.age}.</p>}
              </div>
            </section>
          );
        })}

        <p className="hint">Levels: {LEVELS.map((l) => `${l.level} ${l.name} (${l.sparks} Sparks)`).join(" · ")}</p>
      </main>
      <Footer />
    </div>
  );
}
