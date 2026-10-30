/**
 * The parent's AI helpers on the dashboard:
 *   - Suggested changes: every proposal from any agent, approved with the parent PIN.
 *   - Weekly review (reviewer agent) and Quest planner (planner agent).
 *   - Habit coach: the parent describes a child's problem in their own words; the coach
 *     retrieves guidance (with sources) and recommends bonus quests the parent can pick,
 *     refine ("too hard", "something different") and add with the PIN.
 *
 * Agents only propose. Nothing changes until the parent approves a card with the PIN.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  acceptRecommendations, addProposals, addRecommendations, aiState, buildContext, describeChange, dismissRecommendation,
  recommendationBlocker, resolveProposal, withAi, type Proposal, type Recommendation,
} from "../lib/agents";
import { askAssistant, askPlanner, askReviewer } from "../lib/agentClient";
import { MAX_BONUS_QUESTS, type Family } from "../lib/family";
import { safetyEvent } from "../lib/guardrails";
import { QUEST_BY_ID } from "../lib/habits";
import { useStore } from "../lib/store";
import Buddy from "./Buddy";
import HabitArt from "./HabitArt";

const SOURCE_LABEL: Record<Proposal["source"], string> = {
  planner: "Quest planner", reviewer: "Weekly review", assistant: "Habit coach",
};

function since(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function AiHelpers({ family }: { family: Family }) {
  const ai = aiState(family);
  return (
    <>
      {ai.proposals.length > 0 && <Proposals family={family} proposals={ai.proposals} />}
      <section className="ai" aria-labelledby="ai-title">
        <div className="ai__head">
          <div>
            <p className="eyebrow">AI helpers</p>
            <h2 id="ai-title">Your family's quest team</h2>
            <p className="muted">They read your quest history and suggest changes. Nothing changes until you approve it with your PIN.</p>
          </div>
          <BuddyTalkToggle on={ai.buddyTalk} />
        </div>
        <Coach family={family} />
        <div className="ai__grid">
          <ReviewCard family={family} />
          <PlanCard family={family} />
        </div>
      </section>
    </>
  );
}

// ── Suggested changes ─────────────────────────────────────────────────────────

function Proposals({ family, proposals }: { family: Family; proposals: Proposal[] }) {
  const { update, askPin } = useStore();

  async function approve(list: Proposal[]) {
    const what = list.length === 1 ? describeChange(family, list[0]) : `${list.length} suggested changes`;
    if (!(await askPin(`Approve: ${what}.`))) return;
    update((f) => list.reduce((acc, p) => resolveProposal(acc, p.id, true), f));
  }

  return (
    <section className="panel panel--proposals" aria-labelledby="proposals-title">
      <div className="panel__head">
        <h2 id="proposals-title">Suggested changes</h2>
        {proposals.length > 1
          ? <button className="btn btn--primary btn--sm" onClick={() => approve(proposals)}>Approve all</button>
          : <span className="count-badge count-badge--violet">{proposals.length}</span>}
      </div>
      <ul className="approvals">
        {proposals.map((p) => (
          <li key={p.id} className="approval">
            <HabitArt habit={p.habit} className="approval__art" />
            <div className="approval__text">
              <span className="approval__who">{SOURCE_LABEL[p.source]} · {since(p.createdAt)}</span>
              <b>{describeChange(family, p)}</b>
              <span className="muted">{p.reason}</span>
            </div>
            <div className="approval__actions">
              <button className="btn btn--ghost btn--sm" onClick={() => update((f) => resolveProposal(f, p.id, false))}>Dismiss</button>
              <button className="btn btn--primary btn--sm" onClick={() => approve([p])}>Approve</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Reviewer and planner ──────────────────────────────────────────────────────

/** Runs one agent call with loading and error state. */
function useAgentCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ReviewCard({ family }: { family: Family }) {
  const { update } = useStore();
  const { busy, error, run } = useAgentCall();
  const review = aiState(family).review;

  const write = () =>
    run(async () => {
      const result = await askReviewer(buildContext(family));
      update((f) => addProposals(withAi(f, () => ({ review: { at: new Date().toISOString(), result } })), result.changes, "reviewer"));
    });

  return (
    <article className="ai-card">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--review" aria-hidden="true">✦</span>
        <div>
          <h3>Weekly review</h3>
          <span className="muted">{review ? `Written ${since(review.at)}` : "How the last two weeks went"}</span>
        </div>
      </header>

      {review ? (
        <div className="ai-card__body">
          <p className="ai-card__headline">{review.result.headline}</p>
          {review.result.children.map((c) => {
            const child = family.children.find((k) => k.id === c.childId);
            if (!child) return null;
            return (
              <div key={c.childId} className="ai-child">
                <Buddy buddy={child.buddy} size={34} />
                <div>
                  <b>{child.name}</b>
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
      <button className="btn btn--soft btn--block" onClick={write} disabled={busy}>
        {busy ? <Thinking label="Reading this week's quests" /> : review ? "Write a fresh review" : "Write this week's review"}
      </button>
    </article>
  );
}

function PlanCard({ family }: { family: Family }) {
  const { update } = useStore();
  const { busy, error, run } = useAgentCall();
  const plan = aiState(family).plan;

  const suggest = () =>
    run(async () => {
      const result = await askPlanner(buildContext(family));
      update((f) => addProposals(withAi(f, () => ({ plan: { at: new Date().toISOString(), result } })), result.changes, "planner"));
    });

  return (
    <article className="ai-card">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--plan" aria-hidden="true">◷</span>
        <div>
          <h3>Quest planner</h3>
          <span className="muted">{plan ? `Planned ${since(plan.at)}` : "Habits and times that fit your kids"}</span>
        </div>
      </header>

      {plan ? (
        <div className="ai-card__body">
          <p>{plan.result.summary}</p>
          {plan.result.changes.length === 0 && <p className="muted">No changes needed: your routine already fits.</p>}
          {plan.result.tips.length > 0 && (
            <ul className="ai-list">{plan.result.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
        </div>
      ) : (
        <p className="empty">The planner looks at your children's ages and recent quests, then suggests habits and times. You approve each one.</p>
      )}

      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--soft btn--block" onClick={suggest} disabled={busy}>
        {busy ? <Thinking label="Planning your routine" /> : plan ? "Plan again" : "Suggest a plan"}
      </button>
    </article>
  );
}

// ── Habit coach (chat) ────────────────────────────────────────────────────────

interface Bubble { from: "parent" | "assistant"; text: string; sources: string[] }

const PARENT_MARK = "\n\nParent: ";

type StoredMessage = { role: string; content: string | null };

/** Citation markers the coach writes inline, e.g. "[G12]" or "[G3, G7]". */
const CITE = /\s?\[(G\d+(?:\s*,\s*G\d+)*)\]/g;

/**
 * Turns the stored conversation (OpenAI-style messages) into chat bubbles, skipping tool calls
 * and results. Cited refs are looked up in the search_guidance results earlier in the
 * conversation and shown as source titles under the reply.
 */
function bubbles(history: unknown[]): Bubble[] {
  const titles = new Map<string, string>();
  const out: Bubble[] = [];
  for (const m of history as StoredMessage[]) {
    if (m.role === "tool" && typeof m.content === "string" && m.content.startsWith("{")) {
      try {
        for (const src of (JSON.parse(m.content).sources ?? []) as { ref: string; title: string }[]) titles.set(src.ref, src.title);
      } catch {
        /* not a guidance result */
      }
    } else if (m.role === "user" && typeof m.content === "string") {
      const i = m.content.lastIndexOf(PARENT_MARK);
      out.push({ from: "parent", text: i >= 0 ? m.content.slice(i + PARENT_MARK.length) : m.content, sources: [] });
    } else if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
      const refs = [...m.content.matchAll(CITE)].flatMap((x) => x[1].split(/\s*,\s*/));
      const sources = [...new Set(refs.map((r) => titles.get(r)).filter((t): t is string => !!t))];
      // The chat shows plain text, so strip any markdown emphasis and heading marks the model adds.
      const text = m.content.replace(CITE, "").replace(/\*\*|__/g, "").replace(/^#{1,6}\s+/gm, "").trim();
      out.push({ from: "assistant", text, sources });
    }
  }
  return out;
}

function Coach({ family }: { family: Family }) {
  const { update, askPin } = useStore();
  const { busy, error, run } = useAgentCall();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [about, setAbout] = useState<string>(family.children.length === 1 ? family.children[0].id : "");
  const [picked, setPicked] = useState<string[]>([]);
  const [safety, setSafety] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const ai = aiState(family);
  const shown = bubbles(ai.chat);
  const aboutChild = family.children.find((c) => c.id === about);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [shown.length, pending]);

  const name = aboutChild?.name ?? family.children[0]?.name ?? "my child";
  const suggestions = [
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
    run(async () => {
      try {
        const notes = aiState(family).notes;
        const prefix = [
          notes.length ? `Since your last reply: ${notes.join("; ")}.` : "",
          aboutChild ? `The parent is talking about ${aboutChild.name} (id ${aboutChild.id}).` : "",
        ].filter(Boolean).join(" ");
        const full = prefix ? `[App] ${prefix}${PARENT_MARK}${message}` : message;
        const reply = await askAssistant(buildContext(family), ai.chat, full);
        if (reply.safety) setSafety(reply.safety.guidance);
        update((f) => {
          let next = withAi(f, () => ({ chat: reply.messages, notes: [] }));
          next = addProposals(next, reply.proposals, "assistant");
          next = addRecommendations(next, reply.recommendations);
          if (reply.safety) next = { ...next, safety: [...next.safety, safetyEvent({ source: "coach", category: reply.safety.category, action: "flagged" })].slice(-50) };
          return next;
        });
        setPicked(reply.recommendations.map((r) => `${r.childId}:${r.questId}`));
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

  const recs = ai.recommendations;
  const byChild = family.children.map((c) => ({ child: c, recs: recs.filter((r) => r.childId === c.id) })).filter((g) => g.recs.length > 0);
  const keyOf = (r: Recommendation) => `${r.childId}:${r.questId}`;
  const isPicked = (r: Recommendation) => picked.includes(keyOf(r));

  async function addPicked(childName: string, ids: string[]) {
    if (ids.length === 0) return;
    if (!(await askPin(`Add ${ids.length} new ${ids.length === 1 ? "quest" : "quests"} for ${childName}.`))) return;
    update((f) => acceptRecommendations(f, ids));
  }

  return (
    <article className="ai-card ai-chat">
      <header className="ai-card__head">
        <span className="ai-card__icon ai-card__icon--chat" aria-hidden="true">✉</span>
        <div>
          <h3>Habit coach</h3>
          <span className="muted">Tell the coach what's going on in your own words. It suggests new quests from expert guidance; you pick.</span>
        </div>
        {shown.length > 0 && (
          <button className="btn btn--ghost btn--sm ai-chat__clear" disabled={busy}
            onClick={() => update((f) => withAi(f, () => ({ chat: [], notes: [], recommendations: [] })))}>
            New chat
          </button>
        )}
      </header>

      {family.children.length > 1 && (
        <div className="about" role="radiogroup" aria-label="Talking about">
          <span className="muted">Talking about:</span>
          {family.children.map((c) => (
            <button key={c.id} role="radio" aria-checked={about === c.id} className={`about__chip ${about === c.id ? "is-on" : ""}`}
              onClick={() => setAbout(about === c.id ? "" : c.id)}>
              <Buddy buddy={c.buddy} accessory={c.wearing} size={22} /> {c.name}
            </button>
          ))}
        </div>
      )}

      {safety && <p className="safety-banner" role="alert">{safety}</p>}

      <div className="ai-chat__log" ref={logRef} aria-live="polite">
        {shown.length === 0 && !pending && (
          <div className="ai-chat__suggest">
            <p className="muted">Describe a problem, for example:</p>
            {suggestions.map((s) => (
              <button key={s} className="chip chip--button" onClick={() => send(s)} disabled={busy}>{s}</button>
            ))}
          </div>
        )}
        {shown.map((b, i) => (
          <div key={i} className={`bubble-wrap bubble-wrap--${b.from}`}>
            <p className={`bubble bubble--${b.from}`}>{b.text}</p>
            {b.sources.length > 0 && <p className="bubble__sources">Sources: {b.sources.join(" · ")}</p>}
          </div>
        ))}
        {pending && <p className="bubble bubble--parent">{pending}</p>}
        {busy && <p className="bubble bubble--assistant"><Thinking label="Reading guidance and your family's quests" /></p>}
      </div>

      {byChild.map(({ child, recs: list }) => {
        const chosen = list.filter(isPicked).map((r) => r.id);
        const room = MAX_BONUS_QUESTS - child.bonusQuests.length;
        return (
          <div key={child.id} className="recs">
            <div className="recs__head">
              <b>Suggested quests for {child.name}</b>
              <span className="muted">{child.bonusQuests.length}/{MAX_BONUS_QUESTS} bonus quests in use</span>
            </div>
            <ul className="recs__list">
              {list.map((r) => {
                const q = QUEST_BY_ID[r.questId];
                const blocked = recommendationBlocker(family, r);
                return (
                  <li key={r.id} className={`rec ${isPicked(r) ? "is-on" : ""}`}>
                    <label>
                      <input type="checkbox" checked={isPicked(r)} disabled={!!blocked}
                        onChange={() => setPicked((p) => (p.includes(keyOf(r)) ? p.filter((x) => x !== keyOf(r)) : [...p, keyOf(r)]))} />
                      <HabitArt habit={r.questId} className="rec__art" />
                      <span className="rec__text">
                        <b>{q?.parentTitle}</b>
                        <small className="tier-tag">Tier {q?.tier}</small>
                        <span className="muted">{r.reason}</span>
                        {blocked && <span className="form-error">{blocked}</span>}
                      </span>
                    </label>
                    <button className="btn btn--ghost btn--sm" onClick={() => update((f) => dismissRecommendation(f, r.id))} aria-label={`Dismiss ${q?.parentTitle}`}>×</button>
                  </li>
                );
              })}
            </ul>
            <div className="recs__actions">
              <button className="chip chip--button" disabled={busy} onClick={() => send(`Those feel too hard for ${child.name}. Can you suggest easier steps?`)}>Too hard</button>
              <button className="chip chip--button" disabled={busy} onClick={() => send(`Can you suggest something different for ${child.name}?`)}>Something different</button>
              <button className="btn btn--primary btn--sm" disabled={chosen.length === 0 || chosen.length > room}
                onClick={() => addPicked(child.name, chosen)}>
                {chosen.length > room ? `Only ${room} more fit. Remove a bonus quest first` : `Add ${chosen.length || ""} to ${child.name}'s quests`}
              </button>
            </div>
          </div>
        );
      })}

      {error && <p className="form-error">{error}</p>}
      <form className="ai-chat__form" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000}
          placeholder={aboutChild ? `What's going on with ${aboutChild.name}?` : "What's going on? e.g. \"Bedtime is a battle every night\""} aria-label="Message the habit coach" />
        <button className="btn btn--primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
      <p className="hint">The coach gives general guidance, not medical advice. In an emergency, contact your local emergency number.</p>
    </article>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────

function BuddyTalkToggle({ on }: { on: boolean }) {
  const { update, askPin } = useStore();
  async function toggle() {
    if (!(await askPin(on ? "Turn off AI buddy messages in kid mode." : "Turn on AI buddy messages in kid mode."))) return;
    update((f) => withAi(f, () => ({ buddyTalk: !on })));
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
