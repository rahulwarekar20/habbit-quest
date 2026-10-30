/**
 * Rewards & limits (parent): price the reward shop, set the daily kid-mode time limit and the
 * screen-time habit's daily limit, and see past reward requests.
 */
import { useState, type FormEvent } from "react";
import { Footer, ParentHeader } from "../components/Headers";
import { setHabits, MAX_MULTIPLIER, STREAK_DAYS, TIER_POINTS } from "../lib/family";
import { screenText } from "../lib/guardrails";
import { HABIT_BY_ID } from "../lib/habits";
import { APP_LIMIT_OPTIONS, setAppLimit } from "../lib/playtime";
import { REWARD_KIND_LABEL, defaultRewards, type RewardItem, type RewardKind } from "../lib/rewards";
import { useStore } from "../lib/store";
import { formatMinutes } from "../lib/time";

const EMOJIS = ["🎁", "📺", "🎮", "🍕", "🍦", "🌙", "🍿", "🛝", "🧸", "📚", "🎨", "⚽", "🏊", "🎢", "🧁", "⭐"];

export default function RewardsPage() {
  const { family, update } = useStore();
  const fam = family!;
  const screen = HABIT_BY_ID.screen;
  const screenSetting = fam.habits.screen;
  const options = screen.setting.kind === "minutes" ? screen.setting.options : [];

  return (
    <div className="page page--app">
      <ParentHeader active="rewards" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Rewards &amp; limits</p>
            <h1>What can points buy?</h1>
            <p className="lead">
              Children earn {TIER_POINTS[1]}-{TIER_POINTS[3]} points per approved quest, boosted up to {MAX_MULTIPLIER}x by the daily golden quest,
              a {STREAK_DAYS}-day streak or your surprise double days. They spend points here, and you approve each request.
            </p>
          </div>
        </div>

        <div className="two-col">
          <section className="panel" aria-labelledby="limit-title">
            <h2 id="limit-title">Time in kid mode</h2>
            <p className="muted">How long each child can use HabbitQuest per day. When time's up they see a friendly break screen; you can add minutes with your PIN.</p>
            <div className="pill-choice" role="radiogroup" aria-label="Daily kid-mode limit">
              {APP_LIMIT_OPTIONS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={fam.settings.appLimit === m}
                  className={fam.settings.appLimit === m ? "is-on" : ""} onClick={() => update((f) => setAppLimit(f, m))}>
                  {m === 0 ? "No limit" : formatMinutes(m)}
                </button>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="screen-title">
            <h2 id="screen-title">Daily screen-time goal</h2>
            <p className="muted">The "{screen.parentTitle}" quest: TV, tablet and games in total. Screen-time rewards add minutes to this for the day.</p>
            <div className="pill-choice" role="radiogroup" aria-label="Daily screen-time limit">
              <button type="button" role="radio" aria-checked={!screenSetting.enabled} className={!screenSetting.enabled ? "is-on" : ""}
                onClick={() => update((f) => setHabits(f, { ...f.habits, screen: { ...f.habits.screen, enabled: false } }))}>Off</button>
              {options.map((m) => {
                const on = screenSetting.enabled && screenSetting.value === String(m);
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} className={on ? "is-on" : ""}
                    onClick={() => update((f) => setHabits(f, { ...f.habits, screen: { enabled: true, value: String(m) } }))}>
                    {formatMinutes(m)}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <section className="panel" aria-labelledby="shop-title">
          <div className="panel__head">
            <h2 id="shop-title">Reward shop</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => update((f) => ({ ...f, rewards: defaultRewards() }))}>Reset to suggestions</button>
          </div>
          <ul className="reward-admin">
            {fam.rewards.map((r) => <RewardRow key={r.id} reward={r} />)}
          </ul>
          <AddReward />
        </section>

        <section className="panel" aria-labelledby="history-title">
          <h2 id="history-title">Recent requests</h2>
          {fam.redemptions.length === 0 ? <p className="empty">No requests yet.</p> : (
            <ul className="mini-list">
              {fam.redemptions.slice(-12).reverse().map((r) => (
                <li key={r.id}>
                  <span>{r.emoji} <b>{fam.children.find((c) => c.id === r.childId)?.name}</b>: {r.title} · {r.cost} pts</span>
                  <span className={`status status--${r.status === "approved" ? "approved" : r.status === "pending" ? "submitted" : "notyet"}`}>
                    {r.status === "approved" ? "Given" : r.status === "pending" ? "Waiting" : "Declined (refunded)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Footer />
    </div>
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
