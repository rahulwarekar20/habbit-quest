/** Isolated operator workspace. This route never mounts the family store. */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AdminError, adminLogin, adminRequest, type AdminPrice, type AdminRecord, type TokenomicsPolicy } from "../lib/adminApi";

type Tab = "Tokenomics" | "Metrics" | "Models" | "Generation history" | "Change history";
const TABS: Tab[] = ["Tokenomics", "Metrics", "Models", "Generation history", "Change history"];
const ACTIVITIES: Record<string, string> = { coach: "Coach / more goals", habit_batch: "Three habit choices", planner: "Quest planner", review: "Weekly review", onboarding: "Onboarding", buddy: "Buddy encouragement", child_screen: "Child text screening" };
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
const money = (n: unknown) => n === null || n === undefined ? "Not available" : Number.isFinite(Number(n)) ? `$${Number(n).toFixed(8)}` : "Not available";
const display = (value: unknown): string => value === null || value === undefined ? "Not measured" : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "object" ? JSON.stringify(value) : String(value);
const TOKEN_STATUS: Record<string, string> = { measured: "Measured", partial: "Partial", unavailable: "Not measured", not_applicable: "Not applicable" };
const HISTORY_COLUMNS = ["activity", "status", "input_tokens", "output_tokens", "token_usage_status", "estimated_cost_usd", "created_at"];
const columnLabel = (key: string) => key === "token_usage_status" ? "Token counts" : key.endsWith("_ms") ? `${pretty(key.slice(0, -3))} (seconds)` : pretty(key);
const cell = (key: string, value: unknown) => {
  if (value === null || value === undefined) return "Not measured";
  if (key === "input_tokens" || key === "output_tokens") return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value).toLocaleString("en-US") : display(value);
  if (key === "token_usage_status") return TOKEN_STATUS[String(value)] ?? display(value);
  return key.endsWith("_usd") ? money(value) : key.endsWith("_ms") ? `${(Number(value) / 1000).toFixed(2)}s` : ["usage_coverage", "tariff_coverage"].includes(key) ? `${(Number(value) * 100).toFixed(1)}%` : display(value);
};

export default function AdminApp() {
  const [session, setSession] = useState<{ token: string; username: string; expires: number } | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("Tokenomics");
  const [policy, setPolicy] = useState<TokenomicsPolicy | null>(null);
  const [models, setModels] = useState<AdminRecord[]>([]);
  const [prices, setPrices] = useState<AdminPrice[]>([]);
  const [metrics, setMetrics] = useState<AdminRecord>({});
  const [rows, setRows] = useState<AdminRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const signOut = useCallback((message?: string) => {
    generation.current += 1; setSession(null); setPolicy(null); setModels([]); setPrices([]); setMetrics({}); setRows([]); setPassword(""); setError(message ?? null);
  }, []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof AdminError && e.status === 401) signOut("Your admin session ended. Please sign in again.");
    else setError(e instanceof Error ? e.message : "The admin request could not be completed.");
  }, [signOut]);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => signOut("Your admin session expired. Please sign in again."), Math.max(0, session.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session, signOut]);
  useEffect(() => {
    if (!session) return;
    const seq = ++generation.current;
    setBusy(true); setError(null); setRows([]);
    const load = async () => {
      if (tab === "Tokenomics") {
        const [p, tariffs, referenceMetrics] = await Promise.all([
          adminRequest<TokenomicsPolicy>("/tokenomics/config", session.token),
          adminRequest<{ items: AdminPrice[] }>("/tokenomics/prices", session.token),
          adminRequest<AdminRecord>("/metrics", session.token),
        ]);
        if (seq === generation.current) { setPolicy(p); setPrices(tariffs.items); setMetrics(referenceMetrics); }
      } else if (tab === "Models") {
        const result = await adminRequest<{ items: AdminRecord[] }>("/models", session.token);
        if (seq === generation.current) setModels(result.items);
      } else if (tab === "Metrics") {
        const result = await adminRequest<AdminRecord>("/metrics", session.token);
        if (seq === generation.current) setMetrics(result);
      } else {
        const result = await adminRequest<{ items: AdminRecord[] }>(tab === "Generation history" ? `/generations?limit=25&offset=${offset}` : "/audit?limit=25", session.token);
        if (seq === generation.current) setRows(result.items);
      }
    };
    void load().catch(e => { if (seq === generation.current) fail(e); }).finally(() => { if (seq === generation.current) setBusy(false); });
    return () => { generation.current += 1; };
  }, [session, tab, offset, version, fail]);

  async function login(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await adminLogin(username, password);
      setSession({ token: result.access_token, username: result.username, expires: Date.now() + result.expires_in * 1000 });
      setPassword(""); setTab("Tokenomics"); setOffset(0);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return <div className="admin-shell">
    <header className="admin-header"><div><span className="admin-eyebrow">HabitQuest · operator workspace</span><h1>{session ? "Tokenomics" : "Admin sign in"}</h1></div>
      {session && <div className="admin-session"><span>{session.username}</span><button className="btn btn--ghost btn--sm" onClick={() => signOut()}>Sign out</button></div>}
    </header>
    {!session ? <main className="admin-login panel"><h2>Welcome back</h2><p>Use the separate admin credentials configured for this service.</p>
      <form onSubmit={event => void login(event)}>
        <label>Username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? "Signing in…" : "Sign in as admin"}</button>
      </form><small>This session stays in memory. Refreshing the page requires sign-in.</small>
    </main> : <>
      <nav className="admin-nav" aria-label="Admin sections">{TABS.map(item => <button key={item} aria-current={tab === item ? "page" : undefined} onClick={() => { setTab(item); setOffset(0); }} className={tab === item ? "is-active" : ""}>{item}</button>)}</nav>
      <main className="admin-main">
        <div className="admin-section-heading"><h2>{tab}</h2><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setVersion(n => n + 1)}>Refresh</button></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        {busy && <p role="status" className="muted">Loading admin data…</p>}
        {tab === "Tokenomics" && policy && <><PolicyEditor key={version} policy={policy} token={session.token} onSave={value => { setPolicy(value); void adminRequest<AdminRecord>("/metrics", session.token).then(setMetrics).catch(fail); }} onError={fail} />
          <ReferenceCards policy={policy} rows={(metrics.recommendations ?? []) as AdminRecord[]} />
          <RateEditor token={session.token} prices={prices} onSaved={() => setVersion(n => n + 1)} onError={fail} />
        </>}
        {tab === "Models" && <section className="panel admin-panel"><p>Effective service configuration. Model routing and provider credentials are managed in the backend environment.</p><RecordsTable rows={models} empty="No configured model information was returned." /></section>}
        {tab === "Metrics" && <MetricsView data={metrics} />}
        {(tab === "Generation history" || tab === "Change history") && <section className="panel admin-panel"><p>{tab === "Generation history" ? "Token counts include each operation’s reported model calls, retries and embedding input. Partial counts mean some provider usage is missing; missing counts are not zero. Prepared habit batches have their own rows. Prompts and generated text are excluded." : "Latest 25 policy and pricing revisions. Previous accounting records retain their original rates."}</p><RecordsTable rows={rows} firstColumns={tab === "Generation history" ? HISTORY_COLUMNS : undefined} empty={busy ? "Loading…" : "No records yet."} />
          {tab === "Generation history" && <div className="admin-pagination"><button className="btn btn--ghost btn--sm" disabled={busy || offset === 0} onClick={() => setOffset(n => Math.max(0, n - 25))}>Previous</button><span>Page {offset / 25 + 1}</span><button className="btn btn--ghost btn--sm" disabled={busy || rows.length < 25} onClick={() => setOffset(n => n + 25)}>Next</button></div>}
        </section>}
      </main>
    </>}
  </div>;
}

function PolicyEditor({ policy, token, onSave, onError }: { policy: TokenomicsPolicy; token: string; onSave: (value: TokenomicsPolicy) => void; onError: (e: unknown) => void }) {
  const [draft, setDraft] = useState(policy);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof TokenomicsPolicy>(key: K, value: TokenomicsPolicy[K]) => { setDraft(p => ({ ...p, [key]: value })); setSaved(false); };
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setSaved(false);
    try {
      const { revision, daily_credits, enforce_budgets, show_costs, reference_usd_per_credit, operator_cap_usd, weights } = draft;
      const result = await adminRequest<TokenomicsPolicy>("/tokenomics/config", token, "PATCH", { revision, daily_credits, enforce_budgets, show_costs, reference_usd_per_credit, operator_cap_usd, weights });
      setDraft(result); onSave(result); setSaved(true);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }
  return <section className="panel admin-panel"><div className={`admin-mode ${policy.enforce_budgets ? "is-enforced" : ""}`}><b>{policy.enforce_budgets ? "Budgets enforced" : "Tracking only"}</b><span>{policy.enforce_budgets ? "Requests use the configured family allowance and operator ceiling." : "Demos can continue beyond the allowance. Usage and costs are still recorded."}</span></div>
    <form onSubmit={event => void save(event)}>
      <div className="admin-fields"><label>Daily family coaching credits<input type="number" min="1" step="1" required value={draft.daily_credits} onChange={e => set("daily_credits", Number(e.target.value))} /></label>
        <label>Reference cost per credit ($)<input type="number" min="0.000000001" step="any" required value={draft.reference_usd_per_credit} onChange={e => set("reference_usd_per_credit", e.target.value)} /><small>Planning conversion, not a cash value.</small></label>
        <label>Operator exposure ceiling ($)<input type="number" min="0.000001" step="any" required value={draft.operator_cap_usd} onChange={e => set("operator_cap_usd", e.target.value)} /><small>Inactive while budgets are not enforced. Existing usage is preserved.</small></label>
      </div>
      <fieldset><legend>Credits per useful result</legend><div className="admin-fields admin-fields--weights">{Object.entries(draft.weights).map(([key, value]) => <label key={key}>{ACTIVITIES[key] ?? pretty(key)}<input type="number" min="0" step="1" required value={value} disabled={["buddy", "child_screen"].includes(key)} onChange={e => set("weights", { ...draft.weights, [key]: Number(e.target.value) })} />{["buddy", "child_screen"].includes(key) && <small>Always 0 family credits. Provider cost is still tracked.</small>}</label>)}</div></fieldset>
      <div className="admin-toggles"><label><input type="checkbox" checked={draft.enforce_budgets} onChange={e => set("enforce_budgets", e.target.checked)} /><span><b>Enforce coaching budgets</b><small>Turning this on uses existing settled and pending usage.</small></span></label>
        <label><input type="checkbox" checked={draft.show_costs} onChange={e => set("show_costs", e.target.checked)} /><span><b>Show generation costs to caregivers</b><small>Show cost estimates and per-generation credit details for reviews and plans. The daily credit meter stays visible; timing visibility stays separate.</small></span></label></div>
      <div className="admin-save"><button className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save configuration"}</button><small>Revision {policy.revision}{policy.updated_at ? ` · ${new Date(policy.updated_at).toLocaleString()}` : ""}</small>{saved && <span role="status">Configuration saved.</span>}</div>
    </form>
  </section>;
}

function ReferenceCards({ policy, rows }: { policy: TokenomicsPolicy; rows: AdminRecord[] }) {
  return <section className="panel admin-panel"><h3>Credit cost references</h3><p>Recommendations include writing, review, embeddings, similarity search and attributable egress. Component costs are added before rounding. Accepted activity weights change only when you save a policy revision.</p>
    <p className="muted">Reference conversion: {money(policy.reference_usd_per_credit)} per credit. Unknown prices remain unpriced; a new model does not inherit old measurements.</p>
    {rows.length ? <div className="admin-reference-grid">{rows.map(row => <article className="admin-reference" key={String(row.activity)}><h4>{ACTIVITIES[String(row.activity)] ?? pretty(String(row.activity))}</h4>
      <p><b>{display(row.configured_credits)} configured</b> · {row.recommended_credits == null ? "Recommendation not measured" : `${display(row.recommended_credits)} recommended`}</p>
      {row.components && typeof row.components === "object" ? <dl>{Object.entries(row.components as AdminRecord).map(([key, value]) => <div key={key}><dt>{pretty(key)}</dt><dd>{money(value)}</dd></div>)}<div className="admin-reference-total"><dt>Total reference</dt><dd>{money(row.reference_cost_usd)}</dd></div></dl> : <p className="muted">No matching cost reference for the configured model.</p>}
      <small>{pretty(String(row.status ?? "not_measured"))}</small>
    </article>)}</div> : <p className="muted">No verified cost reference is available for the current configuration. Configured activity weights are provisional until matching usage and tariffs are available.</p>}
  </section>;
}

function RateEditor({ token, prices, onSaved, onError }: { token: string; prices: AdminPrice[]; onSaved: () => void; onError: (e: unknown) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({ provider: "OpenAI", model: "", api_mode: "chat_completions", service_tier: "standard", region: "", context_band: "short", source_url: "", status: "manual", kind: "chat" });
  const [busy, setBusy] = useState(false);
  const numberFields = ["input_rate", "cached_input_rate", "cache_write_rate", "output_rate", "read_unit_rate", "egress_rate", "read_units_bound", "egress_bytes_bound"];
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      if (draft.status === "verified" && !draft.verified_at) throw new Error("Enter when this tariff was verified, in UTC.");
      const body = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== "" && (key !== "verified_at" || draft.status === "verified")).map(([key, value]) => {
        if (["verified_at", "effective_at"].includes(key)) {
          // These datetime-local controls explicitly collect UTC, independent of browser timezone.
          const timestamp = new Date(`${value}Z`);
          if (!Number.isFinite(timestamp.getTime())) throw new Error("Enter a valid UTC timestamp.");
          return [key, timestamp.toISOString()];
        }
        return [key, numberFields.includes(key) ? Number(value) : value];
      }));
      await adminRequest("/tokenomics/prices", token, "POST", body); onSaved();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }
  return <section className="panel admin-panel"><h3>Provider rate versions</h3><p>New rates apply to future operations. Old records keep their original price version. Verify the exact provider, model, API, region and tier before entering a tariff.</p>
    <RecordsTable rows={prices} empty="No provider rate versions have been configured." />
    <details className="admin-rate-form"><summary>Add a price version</summary><form onSubmit={event => void save(event)}><div className="admin-fields">
      <label>Usage kind<select value={draft.kind} onChange={e => setDraft(p => ({ ...p, kind: e.target.value }))}><option value="chat">Chat generation</option><option value="embedding">Embedding</option><option value="search">Similarity search</option></select></label>
      <label>Provider<select value={draft.provider} onChange={e => setDraft(p => ({ ...p, provider: e.target.value }))}>{["OpenAI", "Nebius", "Pinecone"].map(provider => <option key={provider}>{provider}</option>)}</select></label>
      <label>API mode<select value={draft.api_mode} onChange={e => setDraft(p => ({ ...p, api_mode: e.target.value }))}>{["responses", "chat_completions", "embeddings", "documents_search"].map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label>Verification<select value={draft.status} onChange={e => setDraft(p => ({ ...p, status: e.target.value }))}><option value="manual">Manual rate</option><option value="verified">Verified tariff</option><option value="planning">Planning assumption</option></select></label>
      {draft.status === "verified" && <label>Verified at (UTC)<input type="datetime-local" step="1" required value={draft.verified_at ?? ""} onChange={e => setDraft(p => ({ ...p, verified_at: e.target.value }))} /><small>Enter UTC time, not your local time.</small></label>}
      <label>Effective at (UTC, optional)<input type="datetime-local" step="1" value={draft.effective_at ?? ""} onChange={e => setDraft(p => ({ ...p, effective_at: e.target.value }))} /><small>Enter UTC time. Leave blank to apply immediately.</small></label>
      {["model", "service_tier", "region", "context_band", "source_url"].map(key => <label key={key}>{pretty(key)}<input type={key === "source_url" ? "url" : "text"} required={["model", "source_url"].includes(key)} value={draft[key] ?? ""} onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))} /></label>)}
      {numberFields.map(key => <label key={key}>{key === "read_units_bound" ? "Conservative RU ceiling per lookup" : key === "egress_bytes_bound" ? "Response byte ceiling" : `${pretty(key)} (${key === "egress_rate" ? "$/GB" : "$/million"})`}<input type="number" min="0" step={key === "egress_bytes_bound" ? "1" : "any"} value={draft[key] ?? ""} onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))} />{key.endsWith("_bound") && <small>Optional explicit bound for strict exposure enforcement; not measured usage.</small>}</label>)}
    </div><button className="btn btn--primary btn--sm" disabled={busy}>{busy ? "Saving…" : "Save price version"}</button></form></details>
  </section>;
}

function MetricsView({ data }: { data: AdminRecord }) {
  const arrays = Object.entries(data).filter(([, value]) => Array.isArray(value));
  const scalar = Object.entries({ ...(data.summary as AdminRecord ?? {}), ...Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== "summary" && !Array.isArray(value))) });
  return <section className="panel admin-panel"><p>Measured metadata only. Small samples are not a performance guarantee; unpriced usage is never treated as free.</p>
    {!!scalar.length && <dl className="admin-metric-summary">{scalar.map(([key, value]) => <div key={key}><dt>{pretty(key)}</dt><dd>{display(value)}</dd></div>)}</dl>}
    {arrays.map(([key, value]) => <div key={key}><h3>{key === "activities" ? "Complete generation operations" : ["models", "model_costs"].includes(key) ? "Provider attempts by model" : pretty(key)}</h3><RecordsTable rows={value as AdminRecord[]} empty="Not measured yet." /></div>)}
    {!Object.keys(data).length && <p className="muted">No measurements yet.</p>}
  </section>;
}

function RecordsTable({ rows, empty, firstColumns = [] }: { rows: AdminRecord[]; empty: string; firstColumns?: string[] }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const columns = [...firstColumns.filter(key => keys.includes(key)), ...keys.filter(key => !firstColumns.includes(key))];
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{columns.map(key => <th key={key} scope="col">{columnLabel(key)}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={String(row.id ?? row.operation_id ?? i)}>{columns.map(key => <td key={key}>{cell(key, row[key])}</td>)}</tr>)}</tbody></table></div>;
}
