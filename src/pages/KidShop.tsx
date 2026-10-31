/**
 * Kid mode reward shop. The balance and history come from the backend, and only a parent can spend
 * points, so a reward here is "ask a grown-up": the request stays in this browser until the parent's
 * yes records it. Mystery boxes are paid with browser-only bonus points. The child can also pick
 * a reward to save towards and dress up their buddy.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import { BreakTime, PointsPill, TimeWarning, Wardrobe, fixedRolls, usePlaytime } from "../components/KidExtras";
import { getKidPoints, type PointsHistory } from "../lib/api";
import { askForReward, requestReward, setGoal, type Redemption, type RewardItem } from "../lib/rewards";
import { useStore } from "../lib/store";
import { dayKey } from "../lib/time";
import { useKidDay } from "../lib/useKidDay";
import { KidBar, KidLapsed, NotFound } from "./Kid";

export default function KidShop({ childId }: { childId: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId);
  const { today, lapsed, resume } = useKidDay(childId);
  const [points, setPoints] = useState<PointsHistory | null>(null);
  const [confirm, setConfirm] = useState<RewardItem | null>(null);
  const [result, setResult] = useState<Redemption | null>(null);
  const secondsLeft = usePlaytime(child);
  const ready = !!today;

  useEffect(() => {
    if (ready) getKidPoints(8).then(setPoints).catch(() => setPoints(null)); // the balance still shows from today
  }, [ready]);

  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;

  const balance = points?.points ?? today?.points ?? child.balance;
  const bonus = child.points;
  const goal = fam.rewards.find((r) => r.id === child.goal) ?? null;
  const requests = fam.redemptions.filter((r) => r.childId === child.id).slice(-6).reverse();
  const bonusHistory = child.ledger.slice(-6).reverse();
  const canGet = (r: RewardItem) => (r.kind === "mystery" ? bonus >= r.cost : balance >= r.cost);
  const short = (r: RewardItem) => r.cost - (r.kind === "mystery" ? bonus : balance);

  function buy(reward: RewardItem) {
    const day = dayKey();
    // Roll once and replay inside update() so the mystery prize shown is the one saved.
    const rng = fixedRolls();
    const act = reward.kind === "mystery" ? requestReward : askForReward;
    const preview = act(fam, child!.id, reward.id, day, rng());
    if (preview.error) return;
    update((f) => act(f, child!.id, reward.id, day, rng()).family);
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
            <p>Pick something fun and ask a grown-up. They say yes before you get it.</p>
            {bonus > 0 && <p>You also have {bonus} bonus points for mystery boxes.</p>}
          </div>
          <PointsPill points={balance} />
        </section>

        {goal && (
          <section className="goal-jar" aria-label="Saving goal">
            <span className="goal-jar__emoji" aria-hidden="true">{goal.emoji}</span>
            <div>
              <b>Saving for: {goal.title}</b>
              <div className="bar"><span style={{ width: `${Math.min(100, (balance / goal.cost) * 100)}%` }} /></div>
              <small>{balance >= goal.cost ? "You have enough. Ask a grown-up!" : `${goal.cost - balance} more points to go`}</small>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => update((f) => setGoal(f, child.id, null))}>Change</button>
          </section>
        )}

        <div className="shop-grid">
          {fam.rewards.map((r) => {
            const afford = canGet(r);
            const mystery = r.kind === "mystery";
            return (
              <article key={r.id} className={`reward ${afford ? "" : "is-short"} ${mystery ? "reward--mystery" : ""}`}>
                <span className="reward__emoji" aria-hidden="true">{r.emoji}</span>
                <b>{r.title}</b>
                <span className="reward__cost">🪙 {r.cost}{mystery ? " bonus" : ""}</span>
                {afford ? (
                  <button className="btn btn--gold btn--sm btn--block" onClick={() => setConfirm(r)}>
                    {mystery ? "Open a box!" : "Ask a grown-up"}
                  </button>
                ) : mystery ? (
                  <button className="btn btn--soft btn--sm btn--block" disabled>{short(r)} more bonus points</button>
                ) : (
                  <button className="btn btn--soft btn--sm btn--block" onClick={() => update((f) => setGoal(f, child.id, r.id))} disabled={child.goal === r.id}>
                    {child.goal === r.id ? "Saving for this" : `Save up (${short(r)} more)`}
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
                    {r.status === "approved" ? "Yes!" : r.status === "pending" ? "Asking a grown-up" : r.asked ? "Not this time" : "Not this time (points back)"}
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

        {points && points.entries.length > 0 && (
          <section className="panel">
            <h2>My points</h2>
            <ul className="mini-list">
              {points.entries.map((e) => (
                <li key={e.id}>
                  {e.kid_title ?? e.note ?? "Points"}
                  <b className={e.amount >= 0 ? "pts-plus" : "pts-minus"}>{e.amount >= 0 ? "+" : ""}{e.amount}</b>
                </li>
              ))}
            </ul>
          </section>
        )}

        {bonusHistory.length > 0 && (
          <section className="panel">
            <h2>My bonus points</h2>
            <ul className="mini-list">
              {bonusHistory.map((e, i) => (
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
            <h2>{confirm.kind === "mystery" ? "Open a mystery box?" : `Ask for “${confirm.title}”?`}</h2>
            <p>
              {confirm.kind === "mystery"
                ? `It costs ${confirm.cost} bonus points. You'll have ${bonus - confirm.cost} left.`
                : `It costs ${confirm.cost} points when a grown-up says yes.`}
            </p>
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
            <p>{result.status === "approved" ? "The points are already yours!" : "We've asked a grown-up. They'll answer soon!"}</p>
            <button className="btn btn--gold btn--lg" onClick={() => setResult(null)} autoFocus>Yay!</button>
          </div>
        </div>
      )}
      <TimeWarning seconds={secondsLeft} />
      {secondsLeft === 0 && <BreakTime child={child} family={fam} />}
    </div>
  );
}
