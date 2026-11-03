/**
 * Family settings (parent): things set up once and visited rarely, kept off the dashboard.
 * Connect a kid's device (QR code and family code), the grown-ups and their invite code,
 * the optional parent PIN, and the family's data (privacy, export, delete).
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Footer, ParentHeader } from "../components/Headers";
import ShareFamily from "../components/ShareFamily";
import { deleteFamily, errorText, exportFamily, getFamily, newInviteCode, removePin, setPin } from "../lib/api";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export default function FamilySettings() {
  const { server } = useStore();
  const fam = server!;
  return (
    <div className="page page--app">
      <ParentHeader active="family" />
      <main className="wrap app-main settings">
        <div className="page-head">
          <div>
            <p className="eyebrow">Family settings</p>
            <h1>{fam.name}</h1>
            <p className="lead">Connect devices, invite another grown-up, and choose how approvals are protected.</p>
          </div>
        </div>

        <div className="settings__grid">
          <Section title="Connect a kid's device" note="On a child's own tablet or phone: scan the QR code, or open the app and enter the family code. Each child then signs in with their own PIN.">
            <ShareFamily family={fam} />
          </Section>
          <GrownUps />
          <ParentPin />
          <YourData />
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="panel settings__section" aria-label={title}>
      <div className="settings__head">
        <h2>{title}</h2>
        {note && <p className="muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function GrownUps() {
  const { server, setServer } = useStore();
  const fam = server!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshCode() {
    setBusy(true);
    setError(null);
    try {
      setServer(await newInviteCode(fam.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Grown-ups" note="Everyone here can approve quests and change plans.">
      <ul className="mini-list">
        {fam.caregivers.map((c) => <li key={c.user_id}><span>{c.display_name}</span><span className="muted">{c.role}</span></li>)}
      </ul>
      <div className="invite">
        <div>
          <span className="muted">Invite code for another grown-up. Share it only with grown-ups.</span>
          <code className="invite__code">{fam.invite_code}</code>
        </div>
        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={refreshCode}>New code</button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Section>
  );
}

/** The parent PIN is optional: on, it guards approvals and grown-up screens; off, nothing asks for it. */
function ParentPin() {
  const { server, setServer, askPinValue, forgetPin } = useStore();
  const fam = server!;
  const [pin, setPinText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      forgetPin();
      setServer(await getFamily(fam.id));
      setPinText("");
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (fam.has_pin && (await askPinValue("Change the parent PIN.")) === null) return;
    await run(() => setPin(fam.id, pin));
  }

  async function turnOff() {
    const current = await askPinValue("Turn off the parent PIN.");
    if (current === null) return;
    await run(() => removePin(fam.id, current));
  }

  return (
    <Section title="Parent PIN">
      <div className="parent-pin__head">
        <span className={`status-pill ${fam.has_pin ? "is-on" : ""}`}>{fam.has_pin ? "On" : "Off"}</span>
        {!editing && (
          <span className="share__actions">
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setEditing(true)}>
              {fam.has_pin ? "Change" : "Turn on"}
            </button>
            {fam.has_pin && <button className="btn btn--ghost btn--sm" disabled={busy} onClick={turnOff}>Turn off</button>}
          </span>
        )}
      </div>
      <p className="muted">
        {fam.has_pin
          ? "Approvals, rewards and grown-up screens ask for it, so kids can't approve their own quests."
          : "Nothing asks for a PIN. Turn it on if kids use a device where a grown-up is signed in."}
      </p>
      {editing && (
        <form className="form kid-pin" onSubmit={save}>
          <label className="field field--narrow">
            <span>{fam.has_pin ? "New PIN" : "PIN"}</span>
            <input id="parent-pin" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} placeholder="••••" autoComplete="off" autoFocus
              onChange={(e) => setPinText(e.target.value.replace(/\D/g, ""))} aria-label="Parent PIN, 4 digits" />
          </label>
          <div className="share__actions">
            <button className="btn btn--primary btn--sm" disabled={busy || pin.length !== 4}>Save PIN</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditing(false); setPinText(""); }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </Section>
  );
}

function YourData() {
  const { server, askPinValue, logout } = useStore();
  const fam = server!;
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setError(null);
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(await exportFamily(fam.id), null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "habitquest-family.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${fam.name} and all its data? This cannot be undone.`)) return;
    const pin = await askPinValue("Delete your family and all its data.");
    if (pin === null) return;
    try {
      await deleteFamily(fam.id, pin);
      logout();
      go("/");
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Section title="Your data" note={`Time zone: ${fam.timezone}. See what we store and what reaches the AI provider on the privacy page.`}>
      <div className="share__actions">
        <a className="btn btn--ghost btn--sm" href="#/privacy">Privacy</a>
        <button className="btn btn--ghost btn--sm" onClick={download}>Export data</button>
        <button className="btn btn--ghost btn--sm settings__danger" onClick={remove}>Delete family</button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </Section>
  );
}
