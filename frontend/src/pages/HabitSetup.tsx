import { buddyDisplayProps } from "../lib/buddyIdentity";
/**
 * A child's details and routine times: when each part of the day starts. New quests default to
 * these times. Quests already in the plan keep theirs; change those in the quest library.
 * Also the child's own kid PIN, for signing in on their own device.
 */
import { useEffect, useState, type FormEvent } from "react";
import Buddy from "../components/Buddy";
import { ChildForm } from "../components/ChildForm";
import { Footer, ParentHeader } from "../components/Headers";
import { errorText, getChild, removeKidPin, setKidPin, updateChild, type ApiChild, type ChildInput } from "../lib/api";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

/** The Child details page (#/setup[/:child]). */
export default function HabitSetup({ childId }: { childId?: string }) {
  const { family, reload } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  const [loaded, setLoaded] = useState<ApiChild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const id = child?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setLoaded(null);
    setSaved(false);
    getChild(id)
      .then((c) => live && setLoaded(c))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [id]);

  if (!child) return null;

  async function save(input: ChildInput) {
    setSaved(false);
    const updated = await updateChild(child!.id, input);
    setLoaded(updated);
    await reload();
    setSaved(true);
    return updated;
  }

  async function reloadDetails() {
    const fresh = await getChild(child!.id);
    setLoaded(fresh); setSaved(false); setFormVersion(value => value + 1);
    await reload();
    return fresh;
  }

  return (
    <div className="page page--app">
      <ParentHeader active="habits" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <h1>{child.name}'s day</h1>
            <p className="lead">New quests start at the routine times below. Quests already in the plan keep theirs, and you can change those in the quest library.</p>
          </div>
        </div>
        {fam.children.length > 1 && (
          <div className="about" role="tablist" aria-label="Child">
            {fam.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} className={`about__chip ${c.id === child.id ? "is-on" : ""}`}
                onClick={() => go(`/setup/${c.id}`)}>
                <Buddy {...buddyDisplayProps(c)} accessory={c.wearing} size={24} /> {c.name}
              </button>
            ))}
          </div>
        )}
        <section className="panel">
          {error && <p className="form-error">{error}</p>}
          {loaded
            ? <ChildForm key={`${loaded.id}:${formVersion}`} initial={loaded} onSubmit={save} onReload={reloadDetails} onCancel={() => go("/parent")} onEdit={() => setSaved(false)} submitLabel="Save changes" wide />
            : !error && <p className="empty">Loading…</p>}
          {saved && <p className="form-ok" role="status">Saved.</p>}
        </section>
        {loaded && <KidPin key={loaded.id} child={loaded} onChange={async () => { setLoaded(await getChild(loaded.id)); await reload(); }} />}
      </main>
      <Footer />
    </div>
  );
}

/** The child's own PIN: for signing in on their own device, and for "Who's playing?" on a shared one. */
function KidPin({ child, onChange }: { child: ApiChild; onChange: () => Promise<void> }) {
  const { askPin, server } = useStore();
  const loginCode = server?.login_code;
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, message: string) {
    if (!(await askPin(`Change ${child.name}'s kid PIN.`))) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await action();
      await onChange();
      setPin("");
      setDone(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => setKidPin(child.id, pin), `${child.name} can now sign in with this PIN.`);
  }

  return (
    <section className="panel" aria-labelledby="kid-pin-title">
      <div className="panel__head">
        <h2 id="kid-pin-title">{child.name}'s PIN</h2>
        <span className="muted">{child.has_pin ? "Set" : "Not set"}</span>
      </div>
      <p className="muted">
        With their own 4-digit PIN, {child.name} can sign in on their own device, and "Who's playing?" asks for it
        so siblings can't open each other's quests.
      </p>
      <ol className="kid-pin__steps">
        <li>
          {loginCode
            ? <>Open HabitQuest, tap <b>I'm a kid</b> and enter the family code <b className="kid-pin__code">{loginCode.slice(0, 4)} {loginCode.slice(4)}</b>, or scan the family QR code.</>
            : <>Make the family QR code in <a href="#/family">Family settings</a>. Its family code is what {child.name} enters first.</>}
        </li>
        <li>Pick their name.</li>
        <li>Enter this PIN.</li>
      </ol>
      <form className="form kid-pin" onSubmit={submit}>
        <label className="field field--narrow">
          <span>{child.has_pin ? "New PIN" : "PIN"}</span>
          <input inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} placeholder="••••" autoComplete="off"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label={`${child.name}'s 4-digit PIN`} />
        </label>
        <div className="share__actions">
          <button className="btn btn--primary btn--sm" disabled={busy || pin.length !== 4}>{child.has_pin ? "Change PIN" : "Set PIN"}</button>
          {child.has_pin && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
              onClick={() => run(() => removeKidPin(child.id), `${child.name}'s PIN is removed.`)}>Remove PIN</button>
          )}
        </div>
      </form>
      {error && <p className="form-error">{error}</p>}
      {done && <p className="form-ok" role="status">{done}</p>}
    </section>
  );
}
