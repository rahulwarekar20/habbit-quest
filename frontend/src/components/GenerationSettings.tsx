import { useGenerationDetails, useGenerationHistory } from "../lib/generationPreferences";
import { GenerationProgress } from "./AiParts";
import { CoachingBudgetMeter, useCoachingBudget } from "./CoachingBudget";
export function GenerationSettings({ familyId }: { familyId?: string }) {
  const [show, setShow] = useGenerationDetails();
  const history = useGenerationHistory();
  const { budget, error } = useCoachingBudget(familyId);
  return <section className="panel settings__section generation-settings" aria-label="AI generation">
    <h2>AI generation</h2>
    <label><input type="checkbox" checked={show} onChange={event => setShow(event.target.checked)} />Show generation seconds and stage details</label>
    <p className="muted">Live status keeps updating either way. Timings are saved for the last 100 calls on this browser, for your account, including failed requests.</p>
    <h3>Family coaching allowance</h3>
    <CoachingBudgetMeter budget={budget} error={error} />
    <p className="muted">Shared by the grown-ups and children in your family. Saved results do not use more credits.</p>
    <details><summary>Recent generation history ({history.length})</summary>
      <p className="muted">Browser-local timing history. Earlier entries do not contain model prices or verified costs.</p>
      {history.length ? <ol className="generation-history">{history.map(record => <li key={record.id}><b>{record.kind}</b> · {new Date(record.at).toLocaleString()}<GenerationProgress timing={record} />{!show && <small>{record.state === "failed" ? "Failed" : "Completed"} · Turn on generation details to see seconds.</small>}</li>)}</ol> : <p>No recorded calls on this browser yet. Earlier timings cannot be reconstructed.</p>}
    </details>
  </section>;
}
