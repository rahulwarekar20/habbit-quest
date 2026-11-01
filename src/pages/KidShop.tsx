/**
 * Kid mode reward shop, from the backend. Asking for a reward holds the points until a grown-up says
 * yes or "not this time" (the points come back). A mystery box picks its prize on the server. The
 * child can also pick a reward to save towards and dress up their buddy.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import { BreakTime, PointsPill, TimeWarning, Wardrobe, usePlaytime } from "../components/KidExtras";
import {
  askForReward, errorText, getKidPoints, listKidRequests, listKidRewards, updateKidExtras,
  type PointsHistory, type Reward, type RewardRequest,
} from "../lib/api";
import { updateChild } from "../lib/family";
import { useStore } from "../lib/store";
import { applyExtras } from "../lib/sync";
import { useKidDay } from "../lib/useKidDay";
import { KidBar, KidLapsed, NotFound } from "./Kid";

export default function KidShop({ childId }: { childId: string }) {
  const { family, update } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId);
  const { today, lapsed, resume } = useKidDay(childId);
  const [points, setPoints] = useState<PointsHistory | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [requests, setRequests] = useState<RewardRequest[]>([]);
  const [confirm, setConfirm] = useState<Reward | null>(null);
  const [result, setResult] = useState<RewardRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = usePlaytime(child);
  const ready = !!today;

  function refresh() {
    getKidPoints(8).then(setPoints).catch(() => setPoints(null)); // the balance still shows from today
    listKidRequests().then(setRequests).catch(() => {});
  }

  useEffect(() => {
    if (!ready) return;
    listKidRewards().then(setRewards).catch((e) => setError(errorText(e)));
    refresh();
  }, [ready]);

  if (!child) return <NotFound />;
  if (lapsed) return <KidLapsed onResume={resume} />;

  const balance = points?.points ?? today?.points ?? child.balance;
  const goal = rewards.find((r) => r.id === child.goal) ?? null;

  function setGoal(id: string | null) {
    updateKidExtras(id ? { goal: id } : { clear_goal: true })
      .then((extras) => update((f) => applyExtras(f, childId, extras)))
      .catch((e) => setError(errorText(e)));
  }

  async function buy(reward: Reward) {
    setConfirm(null);
    setError(null);
    try {
      const bought = await askForReward(reward.id);
      update((f) => updateChild(f, childId, (c) => ({ ...c, balance: bought.points })));
      setResult(bought.request);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="page page--kid" data-buddy={child.buddy}>
      <KidBar child={child} />
      <main className="wrap kid-main">
        <a className="back" href={`#/kid/${child.id}`}>&larr; Back to my quests</a>
        <section className="shop-hero">
          <Buddy buddy={child.buddy} accessory={child.wearing} size={84} />
          <div>
            <h1>Reward shop</h1>
            <p>Pick something fun. A grown-up says yes before you get it, and if it's not this time, your points come back.</p>
          </div>
          <PointsPill points={balance} />
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}

        {goal && (
          <section className="goal-jar" aria-label="Saving goal">
            <span className="goal-jar__emoji" aria-hidden="true">{goal.emoji}</span>
            <div>
              <b>Saving for: {goal.title}</b>
              <div className="bar"><span style={{ width: `${Math.min(100, (balance / goal.cost) * 100)}%` }} /></div>
              <small>{balance >= goal.cost ? "You have enough. Ask a grown-up!" : `${goal.cost - balance} more points to go`}</small>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setGoal(null)}>Change</button>
          </section>
        )}

        <div className="shop-grid">
          {rewards.map((r) => {
            const afford = balance >= r.cost;
            const mystery = r.kind === "mystery";
            return (
              <article key={r.id} className={`reward ${afford ? "" : "is-short"} ${mystery ? "reward--mystery" : ""}`}>
                <span className="reward__emoji" aria-hidden="true">{r.emoji}</span>
                <b>{r.title}</b>
                <span className="reward__cost">🪙 {r.cost}</span>
                {afford ? (
                  <button className="btn btn--gold btn--sm btn--block" onClick={() => setConfirm(r)}>
                    {mystery ? "Open a box!" : "Ask a grown-up"}
                  </button>
                ) : (
                  <button className="btn btn--soft btn--sm btn--block" onClick={() => setGoal(r.id)} disabled={child.goal === r.id}>
                    {child.goal === r.id ? "Saving for this" : `Save up (${r.cost - balance} more)`}
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
      </main>

      {confirm && (
        <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Get this reward?">
          <div className="kid-overlay__card">
            <span className="reward__emoji reward__emoji--big" aria-hidden="true">{confirm.emoji}</span>
            <h2>{confirm.kind === "mystery" ? "Open a mystery box?" : `Ask for “${confirm.title}”?`}</h2>
            <p>It costs {confirm.cost} points. You'll have {balance - confirm.cost} left.</p>
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
