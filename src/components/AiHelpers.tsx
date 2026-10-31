/**
 * The parent's AI helpers on the dashboard, all served by the backend:
 *   - Suggested changes: plan changes from any helper, accepted with the parent PIN.
 *   - Habit coach: the parent describes a child's problem in their own words; the coach cites
 *     guidance and suggests quests the parent can pick, refine and add with the PIN.
 *   - Weekly review and Quest planner.
 *
 * Helpers only propose. Nothing changes until the parent accepts a card with the PIN.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  acceptSuggestion, dismissSuggestion, errorText, getCoachThread, getFamilySettings, getReports, listSuggestions,
  requestPlan, requestReview, resetCoachThread, sendCoachMessage, updateFamilySettings,
  type CoachMessage, type PlanReport, type Report, type ReviewReport, type Suggestion,
} from "../lib/api";
import type { Family } from "../lib/family";
import { useStore } from "../lib/store";
import { formatTime } from "../lib/time";
import Buddy from "./Buddy";
import HabitArt from "./HabitArt";

const SOURCE_LABEL: Record<Suggestion["source"], string> = {
  planner: "Quest planner", reviewer: "Weekly review", coach: "Habit coach",
};
/** Citation markers the coach writes inline, e.g. "[G12]" or "[G3, G7]". */
const CITE = /\s?\[(G\d+(?:\s*,\s*G\d+)*)\]/g;

function since(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function describe(s: Suggestion): string {
  if (s.kind === "add") return `Add "${s.title}" for ${s.child_name}`;
  if (s.kind === "retime") return `${s.title} for ${s.child_name}: move to ${formatTime(s.cue_time ?? "")}`;
  const verb = { pause: "Pause", resume: "Resume", remove: "Remove" }[s.kind];
  return `${verb} "${s.title}" for ${s.child_name}`;
}

export default function AiHelpers({ family, onPlanSaved }: { family: Family; onPlanSaved: () => void }) {
  const { server } = useStore();
  const familyId = server!.id;
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCards(await listSuggestions(familyId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [familyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changed = useCallback(async () => {
    await refresh();
    onPlanSaved();
  }, [onPlanSaved, refresh]);

  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <Proposals cards={cards.filter((c) => c.kind !== "add" || c.source !== "coach")} onChange={changed} />
      <section className="ai" aria-labelledby="ai-title">
        <div className="ai__head">
          <div>
            <p className="eyebrow">AI helpers</p>
            <h2 id="ai-title">Your family's quest team</h2>
            <p className="muted">They read your quest history and suggest changes. Nothing changes until you approve it with your PIN.</p>
          </div>
          <BuddyTalkToggle familyId={familyId} />
        </div>
        <Coach family={family} onChange={changed} />
        <Reports familyId={familyId} family={family} onChange={refresh} />
      </section>
    </>
  );
}

// ── Suggested changes ─────────────────────────────────────────────────────────

function Proposals({ cards, onChange }: { cards: Suggestion[]; onChange: () => Promise<void> }) {
  const { askPinValue } = useStore();
  const [error, setError] = useState<string | null>(null);

  async function approve(list: Suggestion[]) {
    const pin = await askPinValue(list.length === 1 ? `Approve: ${describe(list[0])}.` : `Approve ${list.length} suggested changes.`);
    if (!pin) return;
    setError(null);
    try {
      for (const card of list) await acceptSuggestion(card.id, pin);
    } catch (e) {
      setError(errorText(e));
    }
    await onChange();
  }

  async function dismiss(card: Suggestion) {
    try {
      await dismissSuggestion(card.id);
    } catch (e) {
      setError(errorText(e));
    }
    await onChange();
  }

  if (cards.length === 0) return null;
  return (
    <section className="panel panel--proposals" aria-labelledby="proposals-title">
      <div className="panel__head">
        <h2 id="proposals-title">Suggested changes</h2>
        {cards.length > 1
          ? <button className="btn btn--primary btn--sm" onClick={() => approve(cards)}>Approve all</button>
          : <span className="count-badge count-badge--violet">{cards.length}</span>}
      </div>
      <ul className="approvals">
        {cards.map((card) => (
          <li key={card.id} className="approval">
            <HabitArt habit={card.habit_id} className="approval__art" />
            <div className="approval__text">
              <span className="approval__who">{SOURCE_LABEL[card.source]} · {since(card.created_at)}</span>
              <b>{describe(card)}</b>
              <span className="muted">{card.reason}</span>
            </div>
            <div className="approval__actions">
              <button className="btn btn--ghost btn--sm" onClick={() => dismiss(card)}>Dismiss</button>
              <button className="btn btn--primary btn--sm" onClick={() => approve([card])}>Approve</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

// ── Reviewer and planner ──────────────────────────────────────────────────────

function Reports({ familyId, family, onChange }: { familyId: string; family: Family; onChange: () => Promise<void> }) {
  const [plan, setPlan] = useState<Report<PlanReport> | null>(null);
  const [review, setReview] = useState<Report<ReviewReport> | null>(null);

  useEffect(() => {
    getReports(familyId).then((found) => {
      setPlan(found.plan);
      setReview(found.review);
    }).catch(() => {}); // the cards still offer to write a new one
  }, [familyId]);

  return (
    <div className="ai__grid">
      <ReviewCard family={family} review={review} write={async () => { setReview(await requestReview(familyId)); await onChange(); }} />
      <PlanCard plan={plan} write={async () => { setPlan(await requestPlan(familyId)); await onChange(); }} />
    </div>
  );
}

/** Runs one helper call with loading and error state. */
function useHelperCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ReviewCard({ family, review, write }: { family: Family; review: Report<ReviewReport> | null; write: () => Promise<void> }) {
  const { busy, error, run } = useHelperCall();
  return (
    <article className="ai-card">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--review" aria-hidden="true">✦</span>
        <div>
          <h3>Weekly review</h3>
          <span className="muted">{review ? `Written ${since(review.created_at)}` : "How the last two weeks went"}</span>
        </div>
      </header>

      {review ? (
        <div className="ai-card__body">
          <p className="ai-card__headline">{review.result.headline}</p>
          {review.result.children.map((c, i) => {
            const name = family.children.find((k) => c.child.includes(k.name));
            return (
              <div key={i} className="ai-child">
                {name && <Buddy buddy={name.buddy} size={34} />}
                <div>
                  <b>{c.child}</b>
                  <p><span className="tag tag--win">Win</span> {c.wins}</p>
                  <p><span className="tag tag--watch">Watch</span> {c.watch}</p>
                </div>
              </div>
            );
          })}
          {review.result.patterns.length > 0 && (
            <ul className="ai-list">{review.result.patterns.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
        </div>
      ) : (
        <p className="empty">The reviewer reads each child's quests and writes you a short summary with wins, patterns and ideas.</p>
      )}

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--soft btn--block" onClick={() => run(write)} disabled={busy}>
        {busy ? <Thinking label="Reading this week's quests" /> : review ? "Write a fresh review" : "Write this week's review"}
      </button>
    </article>
  );
}

function PlanCard({ plan, write }: { plan: Report<PlanReport> | null; write: () => Promise<void> }) {
  const { busy, error, run } = useHelperCall();
  return (
    <article className="ai-card">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--plan" aria-hidden="true">◷</span>
        <div>
          <h3>Quest planner</h3>
          <span className="muted">{plan ? `Planned ${since(plan.created_at)}` : "Habits and times that fit your kids"}</span>
        </div>
      </header>

      {plan ? (
        <div className="ai-card__body">
          <p>{plan.result.summary}</p>
          {plan.result.tips.length > 0 && (
            <ul className="ai-list">{plan.result.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
        </div>
      ) : (
        <p className="empty">The planner looks at your children's ages and recent quests, then suggests habits and times. You approve each one.</p>
      )}

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--soft btn--block" onClick={() => run(write)} disabled={busy}>
        {busy ? <Thinking label="Planning your routine" /> : plan ? "Plan again" : "Suggest a plan"}
      </button>
    </article>
  );
}

// ── Habit coach (chat) ────────────────────────────────────────────────────────

/** The chat shows plain text, so citation marks and any markdown the model adds are stripped. */
const plainText = (text: string) => text.replace(CITE, "").replace(/\*\*|__/g, "").replace(/^#{1,6}\s+/gm, "").trim();

function Coach({ family, onChange }: { family: Family; onChange: () => Promise<void> }) {
  const { askPinValue } = useStore();
  const { busy, error, run } = useHelperCall();
  const [about, setAbout] = useState(family.children[0]?.id ?? "");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [safety, setSafety] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const child = family.children.find((c) => c.id === about) ?? family.children[0];
  const childId = child?.id;
  const addCards = cards.filter((c) => c.kind === "add" && c.source === "coach");

  function adopt(thread: { messages: CoachMessage[]; suggestions: Suggestion[] }) {
    setMessages(thread.messages);
    setCards(thread.suggestions);
    setPicked(thread.suggestions.map((s) => s.id));
  }

  useEffect(() => {
    if (!childId) return;
    setSafety(null);
    setFallback(false);
    getCoachThread(childId).then(adopt).catch(() => adopt({ messages: [], suggestions: [] }));
  }, [childId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  if (!child) return null;
  const name = child.name;
  const examples = [
    `${name} has a meltdown when screen time ends`,
    `${name} keeps stalling at bedtime`,
    `${name} won't tidy up after playing`,
    `${name} is a really picky eater`,
  ];

  function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setPending(message);
    setSafety(null);
    void run(async () => {
      try {
        const reply = await sendCoachMessage(child!.id, message);
        adopt(reply);
        setSafety(reply.safety?.guidance ?? null);
        setFallback(reply.mapped_by !== "ai" && !reply.safety);
        await onChange();
      } catch (e) {
        setDraft(message);
        throw e;
      } finally {
        setPending(null);
      }
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  async function addPicked() {
    const chosen = addCards.filter((c) => picked.includes(c.id));
    if (chosen.length === 0) return;
    const pin = await askPinValue(`Add ${chosen.length} new ${chosen.length === 1 ? "quest" : "quests"} for ${name}.`);
    if (!pin) return;
    await run(async () => {
      let thread = { messages, suggestions: cards };
      for (const card of chosen) thread = await acceptSuggestion(card.id, pin);
      adopt(thread);
      await onChange();
    });
  }

  const dismiss = (card: Suggestion) => run(async () => adopt(await dismissSuggestion(card.id)));
  const reset = () => run(async () => {
    await resetCoachThread(child!.id);
    adopt({ messages: [], suggestions: [] });
    setSafety(null);
    await onChange();
  });

  return (
    <article className="ai-card ai-chat">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--chat" aria-hidden="true">✉</span>
        <div>
          <h3>Habit coach</h3>
          <span className="muted">Tell the coach what's going on in your own words. It suggests new quests from expert guidance; you pick.</span>
        </div>
        {messages.length > 0 && <button className="btn btn--ghost btn--sm ai-chat__clear" disabled={busy} onClick={reset}>New chat</button>}
      </header>

      {family.children.length > 1 && (
        <div className="about" role="radiogroup" aria-label="Talking about">
          <span className="muted">Talking about:</span>
          {family.children.map((c) => (
            <button key={c.id} role="radio" aria-checked={child.id === c.id} className={`about__chip ${child.id === c.id ? "is-on" : ""}`}
              onClick={() => setAbout(c.id)} disabled={busy}>
              <Buddy buddy={c.buddy} accessory={c.wearing} size={22} /> {c.name}
            </button>
          ))}
        </div>
      )}

      {safety && <p className="safety-banner" role="alert">{safety}</p>}
      {fallback && <p className="hint">The coach couldn't reach its full notes just now, so these come from a simple match.</p>}

      <div className="ai-chat__log" ref={logRef} aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="ai-chat__suggest">
            <p className="muted">Describe a problem, for example:</p>
            {examples.map((s) => <button key={s} className="chip chip--button" onClick={() => send(s)} disabled={busy}>{s}</button>)}
          </div>
        )}
        {messages.map((m) => {
          const from = m.role === "parent" ? "parent" : "assistant";
          return (
            <div key={m.id} className={`bubble-wrap bubble-wrap--${from}`}>
              <p className={`bubble bubble--${from}`}>{from === "parent" ? m.content : plainText(m.content)}</p>
              {m.sources.length > 0 && <p className="bubble__sources">Sources: {m.sources.map((s) => s.title).join(" · ")}</p>}
            </div>
          );
        })}
        {pending && <p className="bubble bubble--parent">{pending}</p>}
        {pending && <p className="bubble bubble--assistant"><Thinking label="Reading guidance and your family's quests" /></p>}
      </div>

      {addCards.length > 0 && (
        <div className="recs">
          <div className="recs__head"><b>Suggested quests for {name}</b></div>
          <ul className="recs__list">
            {addCards.map((card) => {
              const on = picked.includes(card.id);
              return (
                <li key={card.id} className={`rec ${on ? "is-on" : ""}`}>
                  <label>
                    <input type="checkbox" checked={on}
                      onChange={() => setPicked((p) => (p.includes(card.id) ? p.filter((x) => x !== card.id) : [...p, card.id]))} />
                    <HabitArt habit={card.habit_id} className="rec__art" />
                    <span className="rec__text">
                      <b>{card.title}</b>
                      <small className="tier-tag">Tier {card.tier}</small>
                      <span className="muted">{card.reason}</span>
                    </span>
                  </label>
                  <button className="btn btn--ghost btn--sm" onClick={() => dismiss(card)} aria-label={`Dismiss ${card.title}`}>×</button>
                </li>
              );
            })}
          </ul>
          <div className="recs__actions">
            <button className="chip chip--button" disabled={busy} onClick={() => send(`Those feel too hard for ${name}. Can you suggest easier steps?`)}>Too hard</button>
            <button className="chip chip--button" disabled={busy} onClick={() => send(`Can you suggest something different for ${name}?`)}>Something different</button>
            <button className="btn btn--primary btn--sm" disabled={busy || picked.length === 0} onClick={addPicked}>
              Add {picked.length || ""} to {name}'s quests
            </button>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
      <form className="ai-chat__form" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000}
          placeholder={`What's going on with ${name}?`} aria-label="Message the habit coach" />
        <button className="btn btn--primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
      <p className="hint">The coach gives general guidance, not medical advice. In an emergency, contact your local emergency number.</p>
    </article>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function BuddyTalkToggle({ familyId }: { familyId: string }) {
  const { askPin } = useStore();
  const [on, setOn] = useState(true);

  useEffect(() => {
    getFamilySettings(familyId).then((s) => setOn(s.buddy_talk)).catch(() => {});
  }, [familyId]);

  async function toggle() {
    if (!(await askPin(on ? "Turn off AI buddy messages in kid mode." : "Turn on AI buddy messages in kid mode."))) return;
    const saved = await updateFamilySettings(familyId, { buddy_talk: !on });
    setOn(saved.buddy_talk);
  }

  return (
    <label className="ai-toggle" title="When on, your child's buddy says short AI-written encouragement in kid mode.">
      <span className="switch">
        <input type="checkbox" checked={on} onChange={toggle} />
        <span aria-hidden="true" />
      </span>
      Buddy talks in kid mode
    </label>
  );
}

function Thinking({ label }: { label: string }) {
  return <span className="thinking"><span className="thinking__dots" aria-hidden="true"><i /><i /><i /></span>{label}…</span>;
}
