/**
 * Kid mode reward shop: spend points on rewards the parent has priced. Requests wait for a
 * grown-up (points are held, and refunded if the answer is "not this time"). The child can
 * pick a reward to save towards (a goal jar), open mystery boxes, dress up their buddy with
 * accessories from treasure chests, and see where their points came from.
 */
import { useState } from "react";
import Buddy from "../components/Buddy";
import { BreakTime, PointsPill, TimeWarning, Wardrobe, fixedRolls, usePlaytime } from "../components/KidExtras";
import { requestReward, setGoal, type Redemption, type RewardItem } from "../lib/rewards";
import { useStore } from "../lib/store";
import { dayKey } from "../lib/time";
import { KidBar, NotFound } from "./Kid";

export default function KidShop({ childId }: { childId: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId);
  const [confirm, setConfirm] = useState<RewardItem | null>(null);
  const [result, setResult] = useState<Redemption | null>(null);
  const secondsLeft = usePlaytime(child);
  if (!child) return <NotFound />;

  const goal = fam.rewards.find((r) => r.id === child.goal) ?? null;
  const requests = fam.redemptions.filter((r) => r.childId === child.id).slice(-6).reverse();
  const history = child.ledger.slice(-8).reverse();

  function buy(reward: RewardItem) {
    const day = dayKey();
    // Roll once and replay inside update() so the mystery prize shown is the one saved.
    const rng = fixedRolls();
    const preview = requestReward(fam, child!.id, reward.id, day, rng());
    if (preview.error) return;
    update((f) => requestReward(f, child!.id, reward.id, day, rng()).family);
    setConfirm(null);
    setResult(preview.redemption);
  }

  return (
    <div className="page page--kid">
      <KidBar child={child} />
      <main className="wrap kid-main">
        <a className="back" href={`#/kid/${child.id}`}>&larr; Back to my quests</a>
        <section className="shop-hero">
          <Buddy buddy={child.buddy} accessory={child.wearing} size={84} />
          <div>
            <h1>Reward shop</h1>
            <p>Spend your points on fun rewards. A grown-up says yes before you get them.</p>
          </div>
          <PointsPill points={child.points} />
        </section>

        {goal && (
          <section className="goal-jar" aria-label="Saving goal">
            <span className="goal-jar__emoji" aria-hidden="true">{goal.emoji}</span>
            <div>
              <b>Saving for: {goal.title}</b>
              <div className="bar"><span style={{ width: `${Math.min(100, (child.points / goal.cost) * 100)}%` }} /></div>
              <small>{child.points >= goal.cost ? "You have enough. Go get it!" : `${goal.cost - child.points} more points to go`}</small>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => update((f) => setGoal(f, child.id, null))}>Change</button>
          </section>
        )}

        <div className="shop-grid">
          {fam.rewards.map((r) => {
            const afford = child.points >= r.cost;
            return (
              <article key={r.id} className={`reward ${afford ? "" : "is-short"} ${r.kind === "mystery" ? "reward--mystery" : ""}`}>
                <span className="reward__emoji" aria-hidden="true">{r.emoji}</span>
                <b>{r.title}</b>
                <span className="reward__cost">🪙 {r.cost}</span>
                {afford ? (
                  <button className="btn btn--gold btn--sm btn--block" onClick={() => setConfirm(r)}>
                    {r.kind === "mystery" ? "Open a box!" : "Get it"}
                  </button>
                ) : (
                  <button className="btn btn--soft btn--sm btn--block" onClick={() => update((f) => setGoal(f, child.id, r.id))} disabled={child.goal === r.id}>
                    {child.goal === r.id ? "Saving for this" : `Save up (${r.cost - child.points} more)`}
                  </button>
                )}
              </article>
            );
          })}
        </div>

        {requests.length > 0 && (
          <section className="panel">
            <h2>My requests</h2>
            <ul className="mini-list">
              {requests.map((r) => (
                <li key={r.id}>
                  <span><span aria-hidden="true">{r.emoji}</span> {r.title}</span>
                  <span className={`status status--${r.status === "approved" ? "approved" : r.status === "pending" ? "submitted" : "notyet"}`}>
                    {r.status === "approved" ? "Yes!" : r.status === "pending" ? "Asking a grown-up" : "Not this time (points back)"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>Dress up {child.name}'s buddy</h2>
          <Wardrobe child={child} />
        </section>

        {history.length > 0 && (
          <section className="panel">
            <h2>My points</h2>
            <ul className="mini-list">
              {history.map((e, i) => (
                <li key={i}>
                  {e.label}
                  <b className={e.points >= 0 ? "pts-plus" : "pts-minus"}>{e.points >= 0 ? "+" : ""}{e.points}</b>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {confirm && (
        <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Get this reward?">
          <div className="kid-overlay__card">
            <span className="reward__emoji reward__emoji--big" aria-hidden="true">{confirm.emoji}</span>
            <h2>{confirm.kind === "mystery" ? "Open a mystery box?" : `Get “${confirm.title}”?`}</h2>
            <p>It costs {confirm.cost} points. You'll have {child.points - confirm.cost} left.</p>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setConfirm(null)}>Not now</button>
              <button className="btn btn--gold" onClick={() => buy(confirm)} autoFocus>Yes please!</button>
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Reward requested" onClick={() => setResult(null)}>
          <div className="kid-overlay__card" onClick={(e) => e.stopPropagation()}>
            {result.mystery && <div className="gift__burst" aria-hidden="true">✨🎁✨</div>}
            <span className="reward__emoji reward__emoji--big" aria-hidden="true">{result.emoji}</span>
            <h2>{result.mystery ? `You got: ${result.title}!` : result.title}</h2>
            <p>{result.status === "approved" ? "The points are already yours!" : "We've asked a grown-up. They'll say yes soon!"}</p>
            <button className="btn btn--gold btn--lg" onClick={() => setResult(null)} autoFocus>Yay!</button>
          </div>
        </div>
      )}
      <TimeWarning seconds={secondsLeft} />
      {secondsLeft === 0 && <BreakTime child={child} family={fam} />}
    </div>
  );
}
