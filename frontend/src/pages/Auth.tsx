/**
 * Account pages. Login: Google sign-in for grown-ups, or the family code for kids.
 * Welcome: first-time setup, either create a family or join one with an invite code, then
 * add the first child. Each is one centred card; the development login sits in the corner.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import Buddy from "../components/Buddy";
import { ChildForm } from "../components/ChildForm";
import GoogleButton from "../components/GoogleButton";
import Logo from "../components/Logo";
import { addChild, createFamily, errorText, joinFamily, type ChildInput, type Role } from "../lib/api";
import { isValidPin } from "../lib/auth";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export function AuthLayout({ children, corner, wide = false }: { children: ReactNode; corner?: ReactNode; wide?: boolean }) {
  return (
    <div className="auth">
      <header className="auth__bar">
        <Logo />
        {corner}
      </header>
      <main className={`auth__card ${wide ? "auth__card--wide" : ""}`}>{children}</main>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────

export function Login() {
  const { notice } = useStore();
  return (
    <AuthLayout corner={<DevLogin />}>
      <div className="auth__head">
        <h1>Welcome to HabbitQuest</h1>
        <p className="muted">Sign in to set up your family or pick up where you left off.</p>
      </div>
      {notice && <p className="form-error">{notice}</p>}
      <div className="auth__choices">
        <GrownUpSignIn />
        <div className="auth__divider" role="presentation"><span>or</span></div>
        <a className="auth-choice" href="#/join">
          <span className="auth-choice__buddies" aria-hidden="true"><Buddy buddy="fox" size={24} /><Buddy buddy="bunny" size={24} /></span>
          I'm a kid
        </a>
      </div>
    </AuthLayout>
  );
}

/** Google sign-in for grown-ups. */
export function GrownUpSignIn() {
  const { signInGoogle } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(credential: string) {
    setBusy(true);
    setError(null);
    const err = await signInGoogle(credential);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <>
      <GoogleButton onCredential={(credential) => void signIn(credential)} />
      {busy && <p className="muted" role="status">Signing you in…</p>}
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

/** The development login (VITE_DEV_LOGIN=true): a small button in the corner that opens a sign-in panel. */
export function DevLogin() {
  const { signInDev } = useStore();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("parent");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (import.meta.env.VITE_DEV_LOGIN !== "true") return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signInDev(username.trim(), password);
    setBusy(false);
    setPassword("");
    if (err) setError(err);
  }

  return (
    <div className="dev-login">
      <button type="button" className="dev-login__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Developer login
      </button>
      {open && (
        <form className="dev-login__panel" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input id="dev-username" required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field">
            <span>Shared password</span>
            <input id="dev-password" required autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <p className="hint">parent, or parent:anything for a separate test parent.</p>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn--primary btn--sm btn--block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      )}
    </div>
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
      <AuthLayout wide>
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
    <AuthLayout wide>
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
    if (pin && !isValidPin(pin)) return setError("A parent PIN needs exactly 4 digits, or leave it empty.");
    setBusy(true);
    setError(null);
    try {
      await createFamily({ name: name.trim(), timezone: timezone.trim(), pin: pin || undefined, display_name: you.trim(), role });
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
          <span>Parent PIN (optional)</span>
          <input inputMode="numeric" maxLength={4} value={pin} placeholder="••••"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="Parent PIN, 4 digits, optional" />
        </label>
      </div>
      <p className="hint">
        A PIN stops kids approving their own quests on a shared device. Leave it empty if you don't need one; you can
        add one later on the dashboard.
      </p>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? "Creating…" : "Create family"}</button>
    </form>
  );
}

export function JoinFamily() {
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
        <span>Grown-up invite code</span>
        <input required autoFocus maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <p className="hint">Ask the grown-up who invited you. It's on their dashboard, and only grown-ups should have it.</p>
      <YouFields name={you} role={role} onName={setYou} onRole={setRole} />
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? "Joining…" : "Join family"}</button>
    </form>
  );
}
