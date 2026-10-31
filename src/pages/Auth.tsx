/**
 * Account pages. Login: Google sign-in, plus a development login when VITE_DEV_LOGIN=true.
 * Welcome: first-time setup, either create a family or join one with an invite code, then
 * add the first child. Both share a split layout with a friendly illustrated panel.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import Buddy, { BUDDIES } from "../components/Buddy";
import { ChildForm } from "../components/ChildForm";
import GoogleButton from "../components/GoogleButton";
import HabitArt from "../components/HabitArt";
import Logo from "../components/Logo";
import { SparkIcon } from "../components/Spark";
import { addChild, createFamily, errorText, joinFamily, type ChildInput, type Role } from "../lib/api";
import { isValidPin } from "../lib/auth";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

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

// ── Login ─────────────────────────────────────────────────────────────────────

export function Login() {
  const { signInGoogle, signInDev, notice } = useStore();
  const [username, setUsername] = useState("parent");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const devLogin = import.meta.env.VITE_DEV_LOGIN === "true";

  async function run(signIn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await signIn();
    setBusy(false);
    setPassword("");
    if (err) setError(err);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => signInDev(username.trim(), password));
  }

  return (
    <AuthLayout side={<SidePanel title="Welcome back, quest master" art="homework" />}>
      <div className="auth__head">
        <p className="eyebrow">Parent sign in</p>
        <h1>Good to see you</h1>
        <p className="muted">Sign in to set up your family or pick up where you left off.</p>
      </div>
      {notice && <p className="form-error">{notice}</p>}
      <GoogleButton onCredential={(credential) => void run(() => signInGoogle(credential))} />
      {busy && <p className="muted" role="status">Signing you in…</p>}
      {error && <p className="form-error">{error}</p>}

      {devLogin && (
        <form className="form dev-login" onSubmit={submit}>
          <p className="eyebrow">Development login</p>
          <label className="field">
            <span>Username</span>
            <input required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Shared password</span>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <p className="hint">Use parent, or parent:anything for a separate test parent.</p>
          <button className="btn btn--soft btn--block" disabled={busy}>Sign in for testing</button>
        </form>
      )}
    </AuthLayout>
  );
}

// ── First-time setup ──────────────────────────────────────────────────────────

const ROLES: { id: Role; label: string }[] = [
  { id: "mother", label: "Mother" }, { id: "father", label: "Father" }, { id: "guardian", label: "Guardian" }, { id: "other", label: "Other" },
];

const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Welcome() {
  const { server, reload } = useStore();
  const [mode, setMode] = useState<"create" | "join">("create");

  if (server) {
    async function add(input: ChildInput) {
      await addChild(server!.id, input);
      await reload();
      go("/parent");
    }
    return (
      <AuthLayout side={<SidePanel title="Calmer mornings start here" art="wake" />}>
        <div className="auth__head">
          <p className="eyebrow">Step 2 of 2</p>
          <h1>Who's going on quests?</h1>
          <p className="muted">Add your first child. You can add more from your dashboard.</p>
        </div>
        <ChildForm onSubmit={add} submitLabel="Add child" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout side={<SidePanel title="Calmer mornings start here" art="wake" />}>
      <div className="auth__head">
        <p className="eyebrow">Step 1 of 2</p>
        <h1>Set up your family</h1>
        <p className="muted">Start a new family, or join one with an invite code from another grown-up.</p>
      </div>
      <div className="about" role="tablist" aria-label="Family setup">
        <button role="tab" aria-selected={mode === "create"} className={`about__chip ${mode === "create" ? "is-on" : ""}`} onClick={() => setMode("create")}>Create a family</button>
        <button role="tab" aria-selected={mode === "join"} className={`about__chip ${mode === "join" ? "is-on" : ""}`} onClick={() => setMode("join")}>Join with a code</button>
      </div>
      {mode === "create" ? <CreateFamily /> : <JoinFamily />}
    </AuthLayout>
  );
}

function YouFields({ name, role, onName, onRole }: { name: string; role: Role; onName: (v: string) => void; onRole: (v: Role) => void }) {
  return (
    <div className="field-row">
      <label className="field">
        <span>Your name</span>
        <input required maxLength={40} value={name} onChange={(e) => onName(e.target.value)} autoComplete="given-name" />
      </label>
      <label className="field field--narrow">
        <span>You are</span>
        <select value={role} onChange={(e) => onRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
    </div>
  );
}

function CreateFamily() {
  const { reload } = useStore();
  const [name, setName] = useState("");
  const [you, setYou] = useState("");
  const [role, setRole] = useState<Role>("mother");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) return setError("Your parent PIN needs exactly 4 digits.");
    setBusy(true);
    setError(null);
    try {
      await createFamily({ name: name.trim(), timezone: timezone.trim(), pin, display_name: you.trim(), role });
      await reload();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span>Family name</span>
        <input required autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Rivera family" />
      </label>
      <YouFields name={you} role={role} onName={setYou} onRole={setRole} />
      <div className="field-row">
        <label className="field">
          <span>Time zone</span>
          <input required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Parent PIN</span>
          <input required inputMode="numeric" maxLength={4} value={pin} placeholder="••••"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="Parent PIN, 4 digits" />
        </label>
      </div>
      <p className="hint">Your PIN protects approvals, so only a grown-up can award Sparks.</p>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? "Creating…" : "Create family"}</button>
    </form>
  );
}

function JoinFamily() {
  const { reload } = useStore();
  const [code, setCode] = useState("");
  const [you, setYou] = useState("");
  const [role, setRole] = useState<Role>("father");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await joinFamily({ invite_code: code.trim(), display_name: you.trim(), role });
      await reload();
      go("/parent");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label className="field">
        <span>Invite code</span>
        <input required autoFocus maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <YouFields name={you} role={role} onName={setYou} onRole={setRole} />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? "Joining…" : "Join family"}</button>
    </form>
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
