/**
 * "Describe a problem" on the dashboard. The parent writes what's going on in their own words; the
 * backend maps it to pre-approved goals with a reason and recommended habits. The parent picks
 * up to six and saves the plan with the PIN. If the text suggests a child may be at risk, the
 * guidance is shown on its own.
 */
import { useState, type FormEvent } from "react";
import { addPainPoint, errorText, type PainPoint, type Plan } from "../lib/api";
import { aiState, withAi } from "../lib/agents";
import type { Family } from "../lib/family";
import { useStore } from "../lib/store";
import Buddy from "./Buddy";
import PlanEditor from "./PlanEditor";

const MIN_TEXT = 5;

export default function AiHelpers({ family, onPlanSaved }: { family: Family; onPlanSaved: () => void }) {
  return (
    <section className="ai" aria-labelledby="ai-title">
      <div className="ai__head">
        <div>
          <p className="eyebrow">Habit coach</p>
          <h2 id="ai-title">Describe a problem</h2>
          <p className="muted">Tell us what's going on. We'll suggest goals and quests from a checked list, and you choose.</p>
        </div>
        <BuddyTalkToggle on={aiState(family).buddyTalk} />
      </div>
      <Coach family={family} onPlanSaved={onPlanSaved} />
    </section>
  );
}

function Coach({ family, onPlanSaved }: { family: Family; onPlanSaved: () => void }) {
  const { askPin } = useStore();
  const [about, setAbout] = useState(family.children[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [result, setResult] = useState<{ plan: Plan; mappedBy: PainPoint["mapped_by"] } | null>(null);
  const [saved, setSaved] = useState(false);
  const child = family.children.find((c) => c.id === about) ?? family.children[0];

  function reset() {
    setSafety(null);
    setResult(null);
    setSaved(false);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!child || text.trim().length < MIN_TEXT) return;
    reset();
    setBusy(true);
    try {
      const reply = await addPainPoint(child.id, text.trim());
      if (reply.safety) setSafety(reply.safety.guidance);
      else if (reply.plan && reply.pain_point) setResult({ plan: reply.plan, mappedBy: reply.pain_point.mapped_by });
      setText("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!child) return null;

  // Safety guidance stands alone: no plan, no suggestions.
  if (safety) {
    return (
      <article className="ai-card">
        <p className="safety-banner" role="alert">{safety}</p>
        <button className="btn btn--ghost btn--sm" onClick={reset}>Close</button>
      </article>
    );
  }

  return (
    <article className="ai-card ai-chat">
      {family.children.length > 1 && (
        <div className="about" role="radiogroup" aria-label="Talking about">
          <span className="muted">Talking about:</span>
          {family.children.map((c) => (
            <button key={c.id} role="radio" aria-checked={about === c.id} className={`about__chip ${about === c.id ? "is-on" : ""}`}
              onClick={() => { setAbout(c.id); reset(); }}>
              <Buddy buddy={c.buddy} accessory={c.wearing} size={22} /> {c.name}
            </button>
          ))}
        </div>
      )}

      <form className="coach-form" onSubmit={submit}>
        <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label={`What's going on with ${child.name}?`}
          placeholder={`What's going on with ${child.name}? For example: "Bedtime is a battle and he wants more tablet."`} />
        <button className="btn btn--primary" disabled={busy || text.trim().length < MIN_TEXT}>
          {busy ? <span className="thinking"><span className="thinking__dots" aria-hidden="true"><i /><i /><i /></span>Finding goals…</span> : "Suggest goals"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {saved && <p className="form-ok" role="status">{child.name}'s plan is saved. New quests start today.</p>}

      {result && (
        <>
          {result.mappedBy === "keywords" && <p className="hint">Our helper is unavailable right now, so these goals have no recommendations. Pick the quests that fit.</p>}
          {result.mappedBy === "manual" && <p className="hint">We couldn't match that to a goal. Pick one from the list.</p>}
          <PlanEditor child={child} plan={result.plan} showCatalog={result.mappedBy === "manual"}
            confirm={() => askPin(`Save the plan for ${child.name}.`)}
            onSaved={() => { setResult(null); setSaved(true); onPlanSaved(); }} />
        </>
      )}
      <p className="hint">This gives general guidance, not medical advice. In an emergency, contact your local emergency number.</p>
    </article>
  );
}

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
