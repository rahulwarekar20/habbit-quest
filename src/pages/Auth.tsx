/**
 * Account pages: Register (parent + first child, then on to habit setup) and Login.
 * Both share a split layout: the form on the left, a friendly illustrated panel on the right.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import Buddy, { BUDDIES } from "../components/Buddy";
import HabitArt from "../components/HabitArt";
import Logo from "../components/Logo";
import { SparkIcon } from "../components/Spark";
import { isValidPin } from "../lib/auth";
import type { BuddyId } from "../lib/family";
import { MAX_AGE, MIN_AGE } from "../lib/habits";
import { go } from "../lib/router";
import { DEMO, useStore } from "../lib/store";

function AuthLayout({ children, side }: { children: ReactNode; side: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__form">
        <Logo />
        {children}
      </div>
      <aside className="auth__side" aria-hidden="true">
        {side}
      </aside>
    </div>
  );
}

// ── Register ──────────────────────────────────────────────────────────────────

export function Register() {
  const { register } = useStore();
  const [form, setForm] = useState({
    parentName: "", email: "", password: "", pin: "", childName: "", childAge: 7, buddy: "fox" as BuddyId,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 6) return setError("Choose a password with at least 6 characters.");
    if (!isValidPin(form.pin)) return setError("Your parent PIN needs exactly 4 digits.");
    setBusy(true);
    const err = await register(form);
    setBusy(false);
    if (err) return setError(err);
    go("/setup");
  }

  return (
    <AuthLayout side={<SidePanel title="Calmer mornings start here" art="wake" />}>
      <div className="auth__head">
        <p className="eyebrow">Create your family account</p>
        <h1>Welcome to HabbitQuest</h1>
        <p className="muted">
          Already have an account? <a href="#/login">Sign in</a>
        </p>
      </div>

      <form className="form" onSubmit={submit}>
        <fieldset className="form__group">
          <legend><span className="legend-num">1</span> About you</legend>
          <label className="field">
            <span>Your first name</span>
            <input required value={form.parentName} onChange={(e) => set("parentName", e.target.value)} autoComplete="given-name" />
          </label>
          <label className="field">
            <span>Email</span>
            <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Password</span>
              <input required type="password" minLength={6} value={form.password}
                onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
            </label>
            <label className="field">
              <span>Parent PIN (4 digits)</span>
              <input required inputMode="numeric" maxLength={4} value={form.pin} placeholder="••••"
                onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} />
            </label>
          </div>
          <p className="hint">Your PIN protects approvals, so only a grown-up can award Sparks.</p>
        </fieldset>

        <fieldset className="form__group">
          <legend><span className="legend-num">2</span> Your child</legend>
          <div className="field-row">
            <label className="field">
              <span>Child's first name</span>
              <input required value={form.childName} onChange={(e) => set("childName", e.target.value)} />
            </label>
            <label className="field field--narrow">
              <span>Age</span>
              <select value={form.childAge} onChange={(e) => set("childAge", Number(e.target.value))}>
                {Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => i + MIN_AGE).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </div>
          <span className="field__label">Pick a buddy</span>
          <div className="buddy-picker" role="radiogroup" aria-label="Buddy">
            {BUDDIES.map((b) => (
              <button type="button" key={b.id} role="radio" aria-checked={form.buddy === b.id}
                className={`buddy-option ${form.buddy === b.id ? "is-on" : ""}`} onClick={() => set("buddy", b.id)}>
                <Buddy buddy={b.id} size={54} />
                <span>{b.name}</span>
              </button>
            ))}
          </div>
          <p className="hint">You can add more children from your dashboard.</p>
        </fieldset>

        {error && <p className="form-error">{error}</p>}
        <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
          {busy ? "Creating…" : "Continue to habits"}
        </button>
      </form>
    </AuthLayout>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────

export function Login() {
  const { login, startDemo } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (email.trim().toLowerCase() === DEMO.email && password === DEMO.password) {
      await startDemo();
      return go("/parent");
    }
    const err = await login(email, password);
    if (err) return setError(err);
    go("/parent");
  }

  return (
    <AuthLayout side={<SidePanel title="Welcome back, quest master" art="homework" />}>
      <div className="auth__head">
        <p className="eyebrow">Parent sign in</p>
        <h1>Good to see you again</h1>
        <p className="muted">
          New here? <a href="#/register">Create a family account</a>
        </p>
      </div>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn--primary btn--lg btn--block">Sign in</button>
        <p className="hint">Demo: {DEMO.email} / {DEMO.password}</p>
      </form>
    </AuthLayout>
  );
}

function SidePanel({ title, art }: { title: string; art: "wake" | "homework" }) {
  return (
    <div className="side-panel">
      <div className="side-panel__card">
        <HabitArt habit={art} />
        <div className="side-panel__sparks">
          <SparkIcon size={26} /> <SparkIcon size={18} /> <SparkIcon size={22} />
        </div>
      </div>
      <h2>{title}</h2>
      <p>Picture quests for kids. One-tap approvals for you. Sparks that unlock new worlds.</p>
      <div className="side-panel__buddies">
        {BUDDIES.map((b) => <Buddy key={b.id} buddy={b.id} size={48} />)}
      </div>
    </div>
  );
}
