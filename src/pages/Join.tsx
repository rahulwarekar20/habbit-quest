/**
 * Joining from a shared family QR code (#/join/:code) or a typed family code (#/join).
 * It first asks how you're joining:
 *   - I'm a kid: pick your buddy, then enter your own kid PIN. You stay signed in for 8 hours.
 *     On a device where a grown-up of this family is signed in, kid mode opens instead.
 *   - I'm a grown-up: sign in with Google, then join with the grown-up invite code.
 */
import { useEffect, useState, type FormEvent } from "react";
import Buddy from "../components/Buddy";
import { ApiError, errorText, findLoginFamily, type LoginFamily } from "../lib/api";
import { go } from "../lib/router";
import { getKidLogin } from "../lib/storage";
import { useStore } from "../lib/store";
import { AuthLayout, GrownUpSignIn, JoinFamily, SidePanel } from "./Auth";

type Who = null | "kid" | "grown-up";

export default function Join({ code }: { code?: string }) {
  const [found, setFound] = useState<LoginFamily | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<Who>(null);

  useEffect(() => {
    if (!code) return;
    let live = true;
    findLoginFamily(code)
      .then((f) => live && setFound(f))
      .catch((e) => live && setError(e instanceof ApiError && e.status === 404 ? "We don't know that family code. It's the 8-letter code on a grown-up's dashboard, not your PIN." : errorText(e)));
    return () => {
      live = false;
    };
  }, [code]);

  const side = <SidePanel title="Little habits. Big adventures." art="wake" />;
  if (!code || error) {
    return (
      <AuthLayout side={side}>
        <CodeForm error={error} />
      </AuthLayout>
    );
  }
  if (!found) {
    return (
      <AuthLayout side={side}>
        <p className="muted" role="status">Finding your family…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout side={side}>
      <div className="auth__head">
        <p className="eyebrow">{found.family.name}</p>
        <h1>{who === "kid" ? "Who are you?" : who === "grown-up" ? "Join as a grown-up" : "How are you joining?"}</h1>
      </div>
      {who === null && (
        <div className="join-choice">
          <button className="join-choice__card" onClick={() => setWho("kid")}>
            <span className="join-choice__buddies" aria-hidden="true">
              {found.children.slice(0, 3).map((c) => <Buddy key={c.id} buddy={c.buddy} size={44} />)}
            </span>
            <b>I'm a kid</b>
            <span className="muted">Use your own PIN</span>
          </button>
          <button className="join-choice__card" onClick={() => setWho("grown-up")}>
            <span className="join-choice__icon" aria-hidden="true">👤</span>
            <b>I'm a grown-up</b>
            <span className="muted">Sign in and use the invite code</span>
          </button>
        </div>
      )}
      {who === "kid" && <KidSignIn code={code} found={found} />}
      {who === "grown-up" && <GrownUpJoin found={found} />}
      {who !== null && <button className="btn btn--ghost btn--sm" onClick={() => setWho(null)}>&larr; Back</button>}
    </AuthLayout>
  );
}

function CodeForm({ error }: { error: string | null }) {
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/[\s-]/g, "").toUpperCase();
    // A kid's PIN is 4 digits; the family code is 8 letters and numbers. The PIN comes after picking a name.
    if (/^\d{4}$/.test(clean)) return setHint("That looks like your PIN. First enter your family code (8 letters and numbers). You'll enter your PIN next.");
    go(`/join/${clean}`);
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="auth__head">
        <p className="eyebrow">Join your family</p>
        <h1>Enter your family code</h1>
        <p className="muted">
          It's 8 letters and numbers, the same for everyone in your family. A grown-up can show it, or a QR code,
          from their dashboard. Your own PIN comes next.
        </p>
      </div>
      <label className="field">
        <span>Family code</span>
        <input required autoFocus maxLength={12} value={code} onChange={(e) => { setCode(e.target.value); setHint(null); }}
          autoCapitalize="characters" autoComplete="off" placeholder="ABCD 2345" />
      </label>
      {(hint ?? error) && <p className="form-error" role="alert">{hint ?? error}</p>}
      <button className="btn btn--primary btn--lg btn--block">Continue</button>
      <p className="hint">Grown-ups: <a href="#/login">sign in here</a>.</p>
    </form>
  );
}

function KidSignIn({ code, found }: { code: string; found: LoginFamily }) {
  const { phase, server, signInKid, enterKidMode } = useStore();
  const [picked, setPicked] = useState<LoginFamily["children"][number] | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A grown-up of this family is signed in here: hand over the device in kid mode instead.
  if (phase === "ready" && server?.id === found.family.id && !getKidLogin()) {
    return (
      <div className="form">
        <p className="muted">A grown-up from your family is signed in on this device, so open kid mode here.</p>
        <button className="btn btn--gold btn--lg btn--block" onClick={() => { enterKidMode(); go("/kid"); }}>Open kid mode</button>
      </div>
    );
  }
  if (found.children.length === 0) return <p className="muted">There are no kids in this family yet. Ask a grown-up to add you.</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signInKid(code, picked!.id, pin);
    setBusy(false);
    if (err) {
      setError(err);
      setPin("");
    } else {
      go(`/kid/${picked!.id}`);
    }
  }

  if (!picked) {
    return (
      <div className="kid-picker__grid join-kids">
        {found.children.map((c) => (
          <button key={c.id} className="kid-picker__card" onClick={() => setPicked(c)} disabled={!c.has_pin}>
            <Buddy buddy={c.buddy} size={72} />
            <b>{c.name}</b>
            {!c.has_pin && <span className="muted">Ask a grown-up to set your PIN</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <form className="form join-pin" onSubmit={submit}>
      <Buddy buddy={picked.buddy} size={80} />
      <p className="muted">Hi, {picked.name}! Enter your PIN.</p>
      <input className={`pin-input ${error ? "pin-input--wrong" : ""}`} inputMode="numeric" pattern="\d{4}" maxLength={4} autoFocus
        value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(null); }}
        aria-label="Your 4-digit PIN" placeholder="••••" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={pin.length !== 4 || busy}>{busy ? "Checking…" : "Let's go!"}</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPicked(null); setPin(""); setError(null); }}>Not me</button>
    </form>
  );
}

function GrownUpJoin({ found }: { found: LoginFamily }) {
  const { phase, server, logout } = useStore();
  const signedIn = phase === "ready" || phase === "noFamily";

  if (!signedIn || getKidLogin()) {
    return (
      <>
        <p className="muted">First, sign in. Then enter the grown-up invite code to join {found.family.name}.</p>
        <GrownUpSignIn />
      </>
    );
  }
  if (server?.id === found.family.id) {
    return (
      <div className="form">
        <p className="muted">You're already a grown-up in this family.</p>
        <a className="btn btn--primary btn--lg btn--block" href="#/parent">Open the dashboard</a>
      </div>
    );
  }
  if (phase === "ready") {
    return (
      <div className="form">
        <p className="muted">You're signed in to another family. Sign out first to join {found.family.name}.</p>
        <button className="btn btn--ghost" onClick={logout}>Sign out</button>
      </div>
    );
  }
  return <JoinFamily />;
}
