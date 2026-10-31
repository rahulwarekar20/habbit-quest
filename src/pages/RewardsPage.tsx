/**
 * Rewards & limits (parent): record a reward (spends the child's points on the backend) with the
 * points history, set the daily kid-mode time limit, and price the kid shop.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Footer, ParentHeader } from "../components/Headers";
import { ApiError, errorText, getPoints, redeemPoints, type PointsHistory } from "../lib/api";
import { screenText } from "../lib/guardrails";
import { APP_LIMIT_OPTIONS, setAppLimit } from "../lib/playtime";
import { REWARD_KIND_LABEL, defaultRewards, type RewardItem, type RewardKind } from "../lib/rewards";
import { useStore } from "../lib/store";
import { formatMinutes } from "../lib/time";
import { updateChild } from "../lib/family";

const EMOJIS = ["🎁", "📺", "🎮", "🍕", "🍦", "🌙", "🍿", "🛝", "🧸", "📚", "🎨", "⚽", "🏊", "🎢", "🧁", "⭐"];

export default function RewardsPage() {
  const { family, update } = useStore();
  const fam = family!;

  return (
    <div className="page page--app">
      <ParentHeader active="rewards" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Rewards &amp; limits</p>
            <h1>What can points buy?</h1>
            <p className="lead">
              Children earn points for every quest you approve. When they use points on something, record it here.
              Sparks are never spent.
            </p>
          </div>
        </div>

        <RecordReward />

        <section className="panel" aria-labelledby="limit-title">
          <h2 id="limit-title">Time in kid mode</h2>
          <p className="muted">How long each child can use HabbitQuest per day on this device. When time's up they see a friendly break screen; you can add minutes with your PIN.</p>
          <div className="pill-choice" role="radiogroup" aria-label="Daily kid-mode limit">
            {APP_LIMIT_OPTIONS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={fam.settings.appLimit === m}
                className={fam.settings.appLimit === m ? "is-on" : ""} onClick={() => update((f) => setAppLimit(f, m))}>
                {m === 0 ? "No limit" : formatMinutes(m)}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="shop-title">
          <div className="panel__head">
            <h2 id="shop-title">Reward shop</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => update((f) => ({ ...f, rewards: defaultRewards() }))}>Reset to suggestions</button>
          </div>
          <p className="muted">Children see these in kid mode and ask a grown-up. Your yes records the reward. The shop list stays on this device.</p>
          <ul className="reward-admin">
            {fam.rewards.map((r) => <RewardRow key={r.id} reward={r} />)}
          </ul>
          <AddReward />
        </section>
      </main>
      <Footer />
    </div>
  );
}

function RecordReward() {
  const { family, update } = useStore();
  const fam = family!;
  const [childId, setChildId] = useState(fam.children[0]?.id ?? "");
  const [points, setPoints] = useState(20);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<PointsHistory | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const child = fam.children.find((c) => c.id === childId);

  const load = useCallback(async () => {
    if (!childId) return;
    try {
      setHistory(await getPoints(childId));
      setUnavailable(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
      else setError(errorText(e));
    }
  }, [childId]);

  useEffect(() => {
    setHistory(null);
    setDone(null);
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!child || !note.trim()) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await redeemPoints(child.id, points, note.trim());
      update((f) => updateChild(f, child.id, (c) => ({ ...c, balance: result.points })));
      setDone(`Recorded. ${child.name} has ${result.points} points left.`);
      setNote("");
      await load();
    } catch (err) {
      setError(errorText(err)); // "Not enough points: N available"
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="record-title">
      <div className="panel__head">
        <h2 id="record-title">Record a reward</h2>
        {history && <span className="chip chip--gold">🪙 {history.points} points · {history.earned} earned · {history.spent} spent</span>}
      </div>
      <form className="surprise-form" onSubmit={submit}>
        <div className="field-row">
          {fam.children.length > 1 && (
            <label className="field field--narrow">
              <span>For</span>
              <select value={childId} onChange={(e) => setChildId(e.target.value)}>
                {fam.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>What was it?</span>
            <input required maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="30 minutes of tablet" />
          </label>
          <label className="field field--narrow">
            <span>Points</span>
            <input required type="number" min={1} max={100000} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        {done && <p className="form-ok" role="status">{done}</p>}
        <div className="modal__actions">
          <button className="btn btn--primary" disabled={busy || !child}>{busy ? "Recording…" : "Record reward"}</button>
        </div>
      </form>

      <h3>History</h3>
      {unavailable ? (
        <p className="empty">The points history isn't available on this server yet.</p>
      ) : !history ? (
        <p className="empty">Loading…</p>
      ) : history.entries.length === 0 ? (
        <p className="empty">Nothing yet.</p>
      ) : (
        <ul className="mini-list">
          {history.entries.map((entry) => (
            <li key={entry.id}>
              <span>
                {entry.kid_title ?? entry.note ?? entry.reason}
                <span className="muted"> · {new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{entry.by ? ` · ${entry.by}` : ""}</span>
              </span>
              <b className={entry.amount >= 0 ? "pts-plus" : "pts-minus"}>{entry.amount >= 0 ? "+" : ""}{entry.amount}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RewardRow({ reward }: { reward: RewardItem }) {
  const { update } = useStore();
  const setCost = (cost: number) =>
    update((f) => ({ ...f, rewards: f.rewards.map((r) => (r.id === reward.id ? { ...r, cost: Math.max(5, Math.min(5000, Math.round(cost))) } : r)) }));
  return (
    <li className="reward-admin__row">
      <span className="reward__emoji" aria-hidden="true">{reward.emoji}</span>
      <div>
        <b>{reward.title}</b>
        <span className="muted">{REWARD_KIND_LABEL[reward.kind]}{reward.minutes ? ` · +${reward.minutes} min screen time` : ""}</span>
      </div>
      <label className="reward-admin__cost">
        <span className="sr-only">Cost in points</span>
        <input type="number" min={5} max={5000} step={5} value={reward.cost} onChange={(e) => setCost(Number(e.target.value))} />
        <span>pts</span>
      </label>
      <button className="btn btn--ghost btn--sm" onClick={() => update((f) => ({ ...f, rewards: f.rewards.filter((r) => r.id !== reward.id) }))}>Remove</button>
    </li>
  );
}

function AddReward() {
  const { update } = useStore();
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState(100);
  const [emoji, setEmoji] = useState("🎁");
  const [kind, setKind] = useState<RewardKind>("privilege");
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return;
    // Children read reward names in the shop, so they get the same local check.
    if (!screenText(clean).ok) return setError("That name has words or details we keep out of kid mode.");
    const reward: RewardItem = {
      id: `rw${Date.now().toString(36)}`, title: clean.slice(0, 60), emoji, cost: Math.max(5, Math.round(cost)), kind,
      ...(kind === "screen" ? { minutes } : {}),
    };
    update((f) => ({ ...f, rewards: [...f.rewards, reward] }));
    setTitle("");
    setError(null);
  }

  return (
    <form className="reward-add" onSubmit={submit}>
      <h3>Add a reward</h3>
      <div className="emoji-pick" role="radiogroup" aria-label="Picture">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? "is-on" : ""} onClick={() => setEmoji(e)}>{e}</button>
        ))}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Reward</span>
          <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Bake cookies together" />
        </label>
        <label className="field field--narrow">
          <span>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as RewardKind)}>
            {(["privilege", "outing", "toy", "screen"] as RewardKind[]).map((k) => <option key={k} value={k}>{REWARD_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        {kind === "screen" && (
          <label className="field field--narrow">
            <span>Minutes</span>
            <input type="number" min={5} max={120} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        )}
        <label className="field field--narrow">
          <span>Points</span>
          <input type="number" min={5} max={5000} step={5} value={cost} onChange={(e) => setCost(Number(e.target.value))} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal__actions">
        <button className="btn btn--primary" disabled={!title.trim()}>Add reward</button>
      </div>
    </form>
  );
}
