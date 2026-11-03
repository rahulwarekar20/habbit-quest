/**
 * The parent's AI helpers on the dashboard, all served by the backend:
 *   - Suggested changes: plan changes from any helper, accepted with the parent PIN.
 *   - A link to the habit coach (the chat itself is Coach.tsx, on its own page).
 *   - Weekly review and Quest planner.
 *   - The switch for AI buddy messages in kid mode.
 *
 * Helpers only propose. Nothing changes until the parent accepts a card with the PIN.
 */
import { useCallback, useEffect, useState } from "react";
import { acceptSuggestion, dismissSuggestion, errorText, getFamilySettings, getReports, listSuggestions, requestPlan, requestReview, updateFamilySettings, type PlanReport, type Report, type ReviewReport, type Suggestion } from "../lib/api";
import type { Family } from "../lib/family";
import { useStore } from "../lib/store";
import { formatTime } from "../lib/time";
import Buddy from "./Buddy";
import HabitArt from "./HabitArt";
import { useHelperCall, Thinking } from "./AiParts";

const SOURCE_LABEL: Record<Suggestion["source"], string> = {
  planner: "Quest planner", reviewer: "Weekly review", coach: "Habit coach", mastery: "Quest mastered",
};

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

/**
 * The dashboard's AI section: suggested changes waiting for a decision, the coach link, the weekly review and
 * quest planner cards, and the buddy-talk switch. `onPlanSaved` runs after a suggestion changes a plan.
 */
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
        <a className="ai-card coach-link" href="#/coach">
          <span className="ai-card__icon ai-card__icon--chat" aria-hidden="true">✉</span>
          <span>
            <b>Something tricky? Ask the habit coach</b>
            <span className="muted">Describe a problem in your own words and get quests from expert guidance.</span>
          </span>
          <span className="coach-link__go" aria-hidden="true">&rarr;</span>
        </a>
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
    if (pin === null) return;
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
            <HabitArt habit={card.habit_id} icon={card.icon} className="approval__art" />
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
