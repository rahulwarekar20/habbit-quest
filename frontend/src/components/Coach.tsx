/**
 * The habit coach chat: a parent describes a child's problem in their own words, the coach
 * answers with cited guidance and suggests quests as cards, which the parent can refine and
 * add with the PIN. Shown on the Habit coach page.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { acceptSuggestion, dismissSuggestion, getCoachThread, resetCoachThread, sendCoachMessage, type CoachMessage, type CoachThread, type Suggestion } from "../lib/api";
import type { Family } from "../lib/family";
import { MAX_HABITS } from "../lib/plan";
import { coachFreshThisSignIn, markCoachFresh } from "../lib/storage";
import { useStore } from "../lib/store";
import Buddy from "./Buddy";
import HabitArt from "./HabitArt";
import { useHelperCall, Thinking } from "./AiParts";

/** Citation markers the coach writes inline, e.g. "[G12]" or "[G3, G7]". */
const CITE = /\s?\[(G\d+(?:\s*,\s*G\d+)*)\]/g;

/** "A", "A and B", "A, B and C". */
const listJoin = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** The chat shows plain text, so citation marks and any markdown the model adds are stripped. */
const plainText = (text: string) => text.replace(CITE, "").replace(/\*\*|__/g, "").replace(/^#{1,6}\s+/gm, "").trim();

/**
 * The coach chat for one child at a time (`childId`, or the first child), with the child picker, suggested
 * quest cards and New chat. `onChange` runs after a card is accepted.
 */
export function Coach({ family, childId: start, onChange }: { family: Family; childId?: string; onChange: () => Promise<void> }) {
  const { askPinValue } = useStore();
  const { busy, error, run } = useHelperCall();
  const [about, setAbout] = useState(start ?? family.children[0]?.id ?? "");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [safety, setSafety] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [planFull, setPlanFull] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const clearing = useRef<Promise<void>>(Promise.resolve()); // a first message waits for the fresh start
  const child = family.children.find((c) => c.id === about) ?? family.children[0];
  const childId = child?.id;
  // A full plan can't take another quest, so its chat shows tips only.
  const addCards = planFull ? [] : cards.filter((c) => c.kind === "add" && c.source === "coach");
  const lastReply = [...messages].reverse().find((m) => m.role !== "parent")?.id;

  function adopt(thread: CoachThread) {
    setMessages(thread.messages);
    setCards(thread.suggestions);
    setPicked(thread.suggestions.map((s) => s.id));
    setPlanFull(thread.plan_full ?? false);
  }

  // Each sign-in starts the coach fresh: the first time a child's chat opens, the old one is cleared.
  useEffect(() => {
    if (!childId) return;
    setSafety(null);
    setFallback(false);
    const empty = { messages: [], suggestions: [] };
    if (coachFreshThisSignIn(childId)) {
      getCoachThread(childId).then(adopt).catch(() => adopt(empty));
      return;
    }
    adopt(empty);
    clearing.current = resetCoachThread(childId).then(() => markCoachFresh(childId)).catch(() => {});
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
        await clearing.current;
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
    if (pin === null) return;
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
      {(family.children.length > 1 || messages.length > 0) && (
        <div className="ai-chat__bar">
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
          {messages.length > 0 && <button className="btn btn--ghost btn--sm ai-chat__clear" disabled={busy} onClick={reset}>New chat</button>}
        </div>
      )}

      {safety && <p className="safety-banner" role="alert">{safety}</p>}
      {fallback && <p className="hint">The coach couldn't reach its full notes just now, so these come from a simple match.</p>}

      <div className={`ai-chat__log ${messages.length === 0 && !pending ? "is-empty" : ""}`} ref={logRef} aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="ai-chat__suggest">
            <p className="muted">Try one of these, or write your own below:</p>
            {examples.map((s) => <button key={s} className="chip chip--button" onClick={() => send(s)} disabled={busy}>{s}</button>)}
          </div>
        )}
        {messages.map((m) => {
          const from = m.role === "parent" ? "parent" : "assistant";
          return (
            <div key={m.id} className={`bubble-wrap bubble-wrap--${from}`}>
              <p className={`bubble bubble--${from}`}>{from === "parent" ? m.content : plainText(m.content)}</p>
              {m.sources.length > 0 && <p className="bubble__sources">Sources: {m.sources.map((s) => s.title).join(" · ")}</p>}
              {m.covered_by?.length > 0 && (
                <p className="bubble__note" role="note">✓ {name} already has {m.covered_by.length === 1 ? "a quest" : "quests"} for this: {listJoin(m.covered_by)}. The tips above can help {m.covered_by.length === 1 ? "it" : "them"} work better.</p>
              )}
              {!m.covered_by?.length && planFull && m.id === lastReply && (
                <p className="bubble__warning" role="note">⚠️ {name} already has {MAX_HABITS} quests, so no new quest is suggested. To add one, remove a quest in the Quest library first.</p>
              )}
              {!planFull && m.no_habit_match && <p className="bubble__warning" role="note">⚠️ We don't have an approved habit for this problem yet, so none is suggested.</p>}
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
                    <HabitArt habit={card.habit_id} icon={card.icon} className="rec__art" />
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
