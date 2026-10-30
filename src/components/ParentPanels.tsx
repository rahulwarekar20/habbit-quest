/**
 * Parent dashboard panels:
 *   SafetyAlerts     notes from a child that raised a safety concern (always shown first)
 *   RewardRequests   shop requests waiting for a yes (PIN) or "not this time" (points refunded)
 *   KidFeedback      the children's check-ins: mood, trickiest and favourite quests, messages
 *   SurprisePlanner  plant a surprise note with bonus points, or a double-points day
 */
import { useState, type FormEvent } from "react";
import type { Family } from "../lib/family";
import { MOODS, STICKERS, markFeedbackSeen } from "../lib/feedback";
import { PARENT_RISK_GUIDANCE, screenText } from "../lib/guardrails";
import { QUEST_BY_ID } from "../lib/habits";
import { MAX_SURPRISE_POINTS, pendingRedemptions, plantSurprise, resolveRedemption } from "../lib/rewards";
import { useStore } from "../lib/store";
import { dayKey, lastDays, weekdayShort } from "../lib/time";
import Buddy from "./Buddy";

const nameOf = (family: Family, childId: string) => family.children.find((c) => c.id === childId)?.name ?? "A child";

export function SafetyAlerts({ family }: { family: Family }) {
  const { update } = useStore();
  const alerts = family.safety.filter((e) => e.action === "flagged" && e.excerpt);
  if (alerts.length === 0) return null;
  return (
    <section className="panel panel--alert" aria-labelledby="safety-title" role="alert">
      <div className="panel__head">
        <h2 id="safety-title">Please check in with your child</h2>
      </div>
      <p>Something your child wrote may mean they're upset or unsafe. It wasn't shared with the AI. Talk with them gently and listen.</p>
      <ul className="mini-list">
        {alerts.map((a) => (
          <li key={a.id}>
            <span><b>{nameOf(family, a.childId ?? "")}</b> · {new Date(a.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}: “{a.excerpt}”</span>
            <button className="btn btn--ghost btn--sm"
              onClick={() => update((f) => ({ ...f, safety: f.safety.map((e) => (e.id === a.id ? { ...e, excerpt: undefined } : e)) }))}>
              I've talked with them
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">{PARENT_RISK_GUIDANCE}</p>
    </section>
  );
}

export function RewardRequests({ family }: { family: Family }) {
  const { update, askPin } = useStore();
  const pending = pendingRedemptions(family);
  if (pending.length === 0) return null;

  async function decide(id: string, title: string, child: string, approve: boolean) {
    if (approve && !(await askPin(`Say yes to "${title}" for ${child}.`))) return;
    update((f) => resolveRedemption(f, id, approve));
  }

  return (
    <section className="panel panel--rewards" aria-labelledby="requests-title">
      <div className="panel__head">
        <h2 id="requests-title">Reward requests</h2>
        <span className="count-badge">{pending.length}</span>
      </div>
      <ul className="approvals">
        {pending.map((r) => {
          const child = family.children.find((c) => c.id === r.childId);
          return (
            <li key={r.id} className="approval">
              <span className="reward__emoji" aria-hidden="true">{r.emoji}</span>
              <div className="approval__text">
                <span className="approval__who">{child && <Buddy buddy={child.buddy} accessory={child.wearing} size={24} />} {child?.name}{r.mystery ? " · from a mystery box" : ""}</span>
                <b>{r.title}</b>
                <span className="muted">{r.cost} points spent{r.minutes ? ` · adds ${r.minutes} min to today's screen time` : ""}</span>
              </div>
              <div className="approval__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => decide(r.id, r.title, child?.name ?? "", false)}>Not this time</button>
                <button className="btn btn--primary btn--sm" onClick={() => decide(r.id, r.title, child?.name ?? "", true)}>Yes!</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hint">"Not this time" gives the points back.</p>
    </section>
  );
}

export function KidFeedback({ family }: { family: Family }) {
  const { update } = useStore();
  const recent = new Set(lastDays(7));
  const items = family.feedback.filter((f) => recent.has(f.day)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const unseen = items.filter((f) => !f.seen).length;
  return (
    <section className="panel" aria-labelledby="feedback-title">
      <div className="panel__head">
        <h2 id="feedback-title">From your kids</h2>
        {unseen > 0 ? (
          <button className="btn btn--ghost btn--sm" onClick={() => update(markFeedbackSeen)}>Mark {unseen} as read</button>
        ) : <span className="muted">Last 7 days</span>}
      </div>
      {items.length === 0 ? (
        <p className="empty">In kid mode, children tap "How was today?" to tell you how their quests felt. Their check-ins show up here.</p>
      ) : (
        <ul className="feedback-list">
          {items.map((f) => {
            const child = family.children.find((c) => c.id === f.childId);
            const mood = MOODS.find((m) => m.id === f.mood);
            return (
              <li key={f.id} className={`feedback ${f.seen ? "" : "is-new"}`}>
                <span className="feedback__mood" aria-label={mood?.label}>{mood?.emoji}</span>
                <div>
                  <span className="approval__who">{child?.name} · {f.day === dayKey() ? "today" : weekdayShort(f.day)} · felt {mood?.label.toLowerCase()}</span>
                  {(f.hardest || f.favorite) && (
                    <p className="muted">
                      {f.hardest && <>Tricky: <b>{QUEST_BY_ID[f.hardest]?.parentTitle}</b>. </>}
                      {f.favorite && <>Favourite: <b>{QUEST_BY_ID[f.favorite]?.parentTitle}</b>.</>}
                    </p>
                  )}
                  {f.stickers.length > 0 && (
                    <div className="feedback__stickers">
                      {f.stickers.map((s) => {
                        const st = STICKERS.find((x) => x.id === s);
                        return st && <span key={s} className="chip">{st.emoji} {st.text}</span>;
                      })}
                    </div>
                  )}
                  {f.note && !f.flagged && <p className="feedback__note">“{f.note}”</p>}
                  {f.flagged && <p className="feedback__flag">This note needs your attention (see the alert above).</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SurprisePlanner({ family }: { family: Family }) {
  const { update } = useStore();
  const [childId, setChildId] = useState<string>("all");
  const [kind, setKind] = useState<"note" | "double">("note");
  const [message, setMessage] = useState("");
  const [points, setPoints] = useState(20);
  const [when, setWhen] = useState<"today" | "tomorrow">("tomorrow");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = family.surprises.filter((s) => s.revealedBy.length === 0 && (s.kind === "note" || s.day >= dayKey()));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Kids read this, so it gets the same local check as everything else they see.
    const check = message.trim() ? screenText(message) : { ok: true };
    if (!check.ok) return setError("That message has words or details we keep out of kid mode. Try rewording it.");
    const day = when === "today" ? dayKey() : lastDaysAhead(1);
    update((f) => plantSurprise(f, { childId, kind, message, points: kind === "note" ? points : 0, day }));
    setSent(kind === "double" ? `Double points day set for ${when}.` : "Surprise planted! It pops up next time they open kid mode.");
    setMessage("");
  }

  return (
    <section className="panel panel--surprise" aria-labelledby="surprise-title">
      <div className="panel__head">
        <h2 id="surprise-title">Plant a surprise 🎁</h2>
        {waiting.length > 0 && <span className="muted">{waiting.length} waiting to be found</span>}
      </div>
      <p className="muted">Hide a present for your kids: a note with bonus points, or a double-points day. They find it in kid mode.</p>
      <form className="surprise-form" onSubmit={submit}>
        <div className="field-row">
          <label className="field">
            <span>For</span>
            <select value={childId} onChange={(e) => setChildId(e.target.value)}>
              <option value="all">Everyone</option>
              {family.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Surprise</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as "note" | "double")}>
              <option value="note">A note and bonus points</option>
              <option value="double">Double points day</option>
            </select>
          </label>
        </div>
        {kind === "note" ? (
          <div className="field-row">
            <label className="field">
              <span>Message (optional)</span>
              <input value={message} maxLength={140} onChange={(e) => setMessage(e.target.value)} placeholder="So proud of how you tidied up this week!" />
            </label>
            <label className="field field--narrow">
              <span>Bonus points</span>
              <input type="number" min={0} max={MAX_SURPRISE_POINTS} step={5} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>When</span>
            <select value={when} onChange={(e) => setWhen(e.target.value as "today" | "tomorrow")}>
              <option value="tomorrow">Tomorrow</option>
              <option value="today">Today</option>
            </select>
            <small className="hint">Every quest earns an extra 1x points that day (up to 3x with a streak and the golden quest).</small>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        {sent && <p className="form-ok" role="status">{sent}</p>}
        <div className="modal__actions">
          <button className="btn btn--gold">Plant surprise</button>
        </div>
      </form>
    </section>
  );
}

function lastDaysAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
}
