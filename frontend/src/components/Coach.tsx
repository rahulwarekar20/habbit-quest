import { buddyDisplayProps } from "../lib/buddyIdentity";
/**
 * The habit coach chat: a parent describes a child's problem in their own words, the coach
 * answers with guidance and suggests goals as cards, which the parent can refine and
 * add with the PIN. Shown on the Habit coach page.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { acceptSuggestion, dismissGoalRecommendation, dismissSuggestion, errorText, getCoachThread, sendCoachMessage, type CoachMessage, type CoachThread, type GoalRecommendation, type HabitSetting, type Suggestion } from "../lib/api";
import { cachedCoachThread, freshCoachThread, rememberCoachThread } from "../lib/coachContext";
import type { Family } from "../lib/family";
import { coachFreshThisSignIn } from "../lib/storage";
import { useStore } from "../lib/store";
import Buddy from "./Buddy";
import { GuidanceText } from "./GuidanceText";
import { SettingPicker } from "./SettingPicker";
import { suggestHabitSetting } from "../lib/habitSetting";
import HabitArt from "./HabitArt";
import { useHelperCall, GenerationProgress, ResponseTime, useResponseTimer, type ResponseTiming } from "./AiParts";
import { GoalRecommendations } from "./GoalRecommendations";
import { CoachingBudgetMeter, useCoachingBudget } from "./CoachingBudget";
import { observeGeneration, refreshCoachingBudget } from "../lib/api/tokenomics";

/** Citation markers the coach writes inline, e.g. "[G12]" or "[G3, G7]". */
const CITE = /\s?\[(G\d+(?:\s*,\s*G\d+)*)\]/g;

/** The chat shows plain text, so citation marks and any markdown the model adds are stripped. */
const plainText = (text: string) => text.replace(CITE, "").replace(/\*\*|__/g, "").replace(/^#{1,6}\s+/gm, "").trim();

/**
 * The coach chat for one child at a time (`childId`, or the first child), with the child picker, suggested
 * quest cards and New chat. `onChange` runs after a card is accepted.
 */
export function Coach({ family, childId: start, onChange }: { family: Family; childId?: string; onChange: () => Promise<void> }) {
  const { askPinValue, server } = useStore();
  const { busy, error, run } = useHelperCall();
  const { timing, measure, clear: clearTiming } = useResponseTimer("Habit Coach");
  const [responseTimes, setResponseTimes] = useState<Record<number, ResponseTiming>>({});
  const [automaticSlots, setAutomaticSlots] = useState<{ goal_id: string; parent_operation_id: string }[]>([]);
  const requestIdentity = useRef<{ fingerprint: string; id: string } | null>(null);
  const [about, setAbout] = useState(start ?? family.children[0]?.id ?? "");
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [goals, setGoals] = useState<GoalRecommendation[]>([]);
  const [latestGoalIds, setLatestGoalIds] = useState<string[]>([]);
  const [moreGoalsNotice, setMoreGoalsNotice] = useState<string | null>(null);
  const [prepareGoalIds, setPrepareGoalIds] = useState<string[]>([]);
  const [settingOverride, setSettingOverride] = useState<HabitSetting | null>(null);
  const [lastSetting, setLastSetting] = useState<HabitSetting | undefined>();
  const [draft, setDraft] = useState("");
  const suggestedSetting = suggestHabitSetting(draft, "", undefined, lastSetting);
  const setting = settingOverride ?? suggestedSetting.setting;
  const [pending, setPending] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [safety, setSafety] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const lifecycle = useRef(0);
  const clearing = useRef<Promise<void>>(Promise.resolve()); // a first message waits for the fresh start
  const child = family.children.find((c) => c.id === about) ?? family.children[0];
  const childId = child?.id;
  const { budget, error: budgetError } = useCoachingBudget(server?.id, childId);
  const addCards = cards.filter((c) => c.kind === "add" && c.source === "coach");

  function adopt(thread: CoachThread, id = childId) {
    if (id) rememberCoachThread(id, thread);
    setMessages(thread.messages);
    setCards(thread.suggestions);
    setGoals(thread.goal_recommendations ?? []);
    setPicked(thread.suggestions.map((s) => s.id));
  }

  // Each sign-in starts the coach fresh: the first time a child's chat opens, the old one is cleared.
  useEffect(() => {
    if (!childId) return;
    const current = ++lifecycle.current;
    setSafety(null);
    setFallback(false);
    setOutcome(null);
    setHistoryError(null);
    setPending(null);
    setPrepareGoalIds([]);
    setLatestGoalIds([]);
    setMoreGoalsNotice(null);
    setSettingOverride(null);
    setLastSetting(undefined);
    clearTiming();
    setResponseTimes({});
    setAutomaticSlots([]); requestIdentity.current = null;
    const empty = { messages: [], suggestions: [] };
    if (coachFreshThisSignIn(childId)) {
      clearing.current = Promise.resolve();
      const cached = cachedCoachThread(childId);
      if (cached) adopt(cached, childId);
      else {
        setMessages([]);
        setCards([]);
        setGoals([]);
        getCoachThread(childId).then((thread) => {
          if (lifecycle.current === current) adopt(thread, childId);
        }).catch((e) => { if (lifecycle.current === current) setHistoryError(errorText(e)); });
      }
    } else {
      adopt(empty, childId);
      clearing.current = freshCoachThread(childId);
      void clearing.current.catch((e) => {
        if (lifecycle.current === current) setHistoryError(errorText(e));
      });
    }
    return () => { lifecycle.current += 1; };
  }, [childId, loadVersion]);

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

  function send(text: string, moreGoals = false) {
    const message = text.trim();
    if (!message || busy) return;
    const requestSetting = settingOverride ?? suggestHabitSetting(message, "", undefined, lastSetting).setting;
    setLastSetting(requestSetting);
    if (!moreGoals) setDraft("");
    setMoreGoalsNotice(null);
    setPending(message);
    setSafety(null);
    setPrepareGoalIds([]);
    const current = lifecycle.current;
    const selectedId = child!.id;
    const fingerprint = JSON.stringify({ selectedId, message, requestSetting, moreGoals });
    if (requestIdentity.current?.fingerprint !== fingerprint) requestIdentity.current = { fingerprint, id: crypto.randomUUID() };
    const requestId = requestIdentity.current.id;
    void run(async () => {
      try {
        const { value: reply, elapsedMs, stages } = await measure(async (onProgress) => {
          await clearing.current;
          if (lifecycle.current !== current) return null;
          let reported = false;
          const result = await sendCoachMessage(selectedId, message, requestSetting, event => { onProgress(event); if (!reported) { reported = true; refreshCoachingBudget(); } }, moreGoals, requestId);
          if (lifecycle.current === current) adopt(result, selectedId);
          return result;
        });
        if (!reply || lifecycle.current !== current) return;
        requestIdentity.current = null;
        const previous = new Set(messages.map((m) => m.id));
        const response = [...reply.messages].reverse().find((m) => m.role === "coach" && !previous.has(m.id));
        if (response && !reply.safety) setResponseTimes((times) => ({ ...times, [response.id]: { state: "complete", elapsedMs, stages } }));
        if (server?.id && reply.tokenomics) void observeGeneration(server.id, reply.tokenomics.operation_id, { response_ms: elapsedMs }).catch(() => {});
        setSafety(reply.safety?.guidance ?? null);
        setFallback(!reply.outcome && reply.mapped_by !== "ai" && !reply.safety);
        setOutcome(reply.outcome ?? null);
        if (!reply.safety && reply.outcome === "recommendations") {
          const returnedIds = (reply.response_goal_ids ?? (reply.goal_recommendations ?? [])
            .filter(card => !moreGoals || !goals.some(previous => previous.goal_id === card.goal_id)).map(card => card.goal_id)).slice(0, 4);
          if (returnedIds.length) setLatestGoalIds(returnedIds);
          const slots = reply.tokenomics?.automatic_slots ?? [];
          setAutomaticSlots(slots);
          const permitted = reply.tokenomics ? returnedIds.filter(id => slots.some(slot => slot.goal_id === id)) : returnedIds;
          setPrepareGoalIds(permitted);
          if (reply.tokenomics && permitted.length < returnedIds.length) setMoreGoalsNotice("Some goals are ready to explore without new habit choices. You can request more choices when your coaching allowance permits.");
        }
        if (moreGoals && !reply.safety && (reply.outcome === "no_direct_fit" || (reply.outcome === "recommendations" && reply.response_goal_ids?.length === 0))) {
          setMoreGoalsNotice("No additional matching goals this time. Your existing choices are still here; tell Coach more about what you need to try a different direction.");
        }
        await onChange();
      } catch (e) {
        if (lifecycle.current !== current) return;
        if (!moreGoals) setDraft(message);
        throw e;
      } finally {
        refreshCoachingBudget();
        if (lifecycle.current === current) setPending(null);
      }
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  async function addPicked() {
    const current = lifecycle.current;
    const selectedId = child!.id;
    const chosen = addCards.filter((c) => picked.includes(c.id));
    if (chosen.length === 0) return;
    const pin = await askPinValue(`Add ${chosen.length} new ${chosen.length === 1 ? "quest" : "quests"} for ${name}.`);
    if (pin === null) return;
    if (lifecycle.current !== current) return;
    await run(async () => {
      let thread: CoachThread = { messages, suggestions: cards, goal_recommendations: goals };
      for (const card of chosen) {
        if (lifecycle.current !== current) return;
        thread = await acceptSuggestion(card.id, pin);
      }
      if (lifecycle.current !== current) return;
      adopt(thread, selectedId);
      await onChange();
    });
  }

  const dismiss = (card: Suggestion) => {
    const current = lifecycle.current;
    const selectedId = child!.id;
    return run(async () => {
      const thread = await dismissSuggestion(card.id);
      if (lifecycle.current === current) adopt(thread, selectedId);
    });
  };
  const dismissGoal = (card: GoalRecommendation) => {
    const current = lifecycle.current;
    const selectedId = child!.id;
    return run(async () => {
      const thread = await dismissGoalRecommendation(selectedId, card.id);
      if (lifecycle.current === current) adopt(thread, selectedId);
    });
  };
  const reset = () => run(async () => {
    const selectedId = child!.id;
    const current = ++lifecycle.current;
    await freshCoachThread(selectedId);
    if (lifecycle.current !== current) return;
    adopt({ messages: [], suggestions: [] });
    clearTiming();
    setResponseTimes({});
    setAutomaticSlots([]); requestIdentity.current = null;
    setPrepareGoalIds([]);
    setLatestGoalIds([]);
    setMoreGoalsNotice(null);
    setSafety(null);
    setFallback(false);
    setOutcome(null);
    setSettingOverride(null);
    setLastSetting(undefined);
    await onChange();
  });

  return (
    <div className="coach-layout">
    <section className="ai-card ai-chat" aria-label={`Chat about ${name}`}>
      <div className="ai-chat__bar">
        <div className="about" role="radiogroup" aria-label="Talking about">
          <span className="muted">Talking about:</span>
          {family.children.map((c) => (
            <button key={c.id} role="radio" aria-checked={child.id === c.id} className={`about__chip ${child.id === c.id ? "is-on" : ""}`}
              onClick={() => setAbout(c.id)} disabled={busy}>
              <Buddy {...buddyDisplayProps(c)} accessory={c.wearing} size={22} />
              <span className="about__child"><span>{c.name}</span><small>{c.age} yrs</small></span>
            </button>
          ))}
        </div>
        <div className="ai-chat__tools">
          <CoachingBudgetMeter budget={budget} error={budgetError} compact />
          {messages.length > 0 && <button className="btn btn--ghost btn--sm ai-chat__clear" disabled={busy} onClick={reset}>New chat</button>}
        </div>
      </div>

      {safety && <p className="safety-banner" role="alert">{safety}<ResponseTime timing={timing} /></p>}
      {fallback && <p className="hint">The coach couldn't reach its full notes just now, so these come from a simple match.</p>}
      {!fallback && outcome && (outcome.includes("unavailable") || outcome === "timeout" || outcome === "safety_rejected") && <p className="hint">The coach couldn't finish this response. Your earlier suggestions are still available.</p>}

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
              <div className={`bubble bubble--${from}`}>{from === "parent" ? m.content : <GuidanceText text={plainText(m.content)} />}</div>
              {m.sources.length > 0 && <p className="bubble__sources">Sources: {m.sources.map((s) => s.title).join(" · ")}</p>}
              {m.role === "coach" && responseTimes[m.id] !== undefined && (
                <GenerationProgress timing={responseTimes[m.id]} />
              )}
              {m.no_habit_match && <p className="bubble__warning" role="note">⚠️ We don't have an approved habit for this problem yet, so none is suggested.</p>}
            </div>
          );
        })}
        {pending && <p className="bubble bubble--parent">{pending}</p>}
        {pending && <div className="bubble bubble--assistant"><GenerationProgress timing={timing?.state === "waiting" ? timing : null} /></div>}
      </div>

      <div className="ai-chat__composer">
        {(goals.length > 0 || addCards.length > 0) && <div className="ai-chat__refinements" aria-label="Refine recommendations">
          {goals.length > 0 && <button type="button" className="chip chip--button more-choices" disabled={busy} onClick={() => send("Show me other goals for the same concern.", true)} title="Find up to four more goals; keep the existing choices">Get more goals</button>}
          <button className="chip chip--button" disabled={busy} onClick={() => send(`Those feel too hard for ${name}. Can you suggest easier steps?`)}>Too hard</button>
          <button className="chip chip--button" disabled={busy} onClick={() => send(`Can you suggest something different for ${name}?`)}>Something different</button>
        </div>}
        {historyError && <p className="form-error">{historyError} <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setLoadVersion((v) => v + 1)}>Retry loading chat</button></p>}
        {error && <p className="form-error">{error}</p>}
        {moreGoalsNotice && <p className="hint" role="status">{moreGoalsNotice}</p>}
        {timing?.state === "failed" && <GenerationProgress timing={timing} />}
        <SettingPicker value={setting} onChange={setSettingOverride} rationale={suggestedSetting.rationale}
          automatic={settingOverride === null} onAutomatic={() => setSettingOverride(null)} disabled={busy} />
        <form className="ai-chat__form" onSubmit={submit}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000}
            placeholder={`What's going on with ${name}?`} aria-label="Message the habit coach" />
          <button className="btn btn--primary" disabled={busy || !draft.trim()}>Send</button>
        </form>
      </div>
      <p className="hint ai-chat__disclaimer">The coach gives general guidance, not medical advice. In an emergency, contact your local emergency number.</p>
    </section>

      <GoalRecommendations key={child.id} cards={goals} childId={child.id} childName={name} setting={setting}
        disabled={busy} prepareGoalIds={prepareGoalIds} automaticSlots={automaticSlots} latestGoalIds={latestGoalIds} onDismiss={dismissGoal} onChange={onChange} />

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
            <button className="btn btn--primary btn--sm" disabled={busy || picked.length === 0} onClick={addPicked}>
              Add {picked.length || ""} to {name}'s quests
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────
