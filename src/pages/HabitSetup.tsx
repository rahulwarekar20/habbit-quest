/**
 * A child's details and routine times: when each part of the day starts. New quests default to
 * these times. Quests already in the plan keep theirs; change those in the quest library.
 */
import { useEffect, useState } from "react";
import Buddy from "../components/Buddy";
import { ChildForm } from "../components/ChildForm";
import { Footer, ParentHeader } from "../components/Headers";
import { errorText, getChild, updateChild, type ApiChild, type ChildInput } from "../lib/api";
import { go } from "../lib/router";
import { useStore } from "../lib/store";

export default function HabitSetup({ childId }: { childId?: string }) {
  const { family, reload } = useStore();
  const fam = family!;
  const child = fam.children.find((c) => c.id === childId) ?? fam.children[0];
  const [loaded, setLoaded] = useState<ApiChild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
  }

  return (
    <div className="page page--app">
      <ParentHeader active="habits" />
      <main className="wrap app-main">
        <div className="page-head">
          <div>
            <p className="eyebrow">Child details</p>
            <h1>{child.name}'s day</h1>
            <p className="lead">New quests start at the routine times below. Quests already in the plan keep theirs, and you can change those in the quest library.</p>
          </div>
        </div>
        {fam.children.length > 1 && (
          <div className="about" role="tablist" aria-label="Child">
            {fam.children.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === child.id} className={`about__chip ${c.id === child.id ? "is-on" : ""}`}
                onClick={() => go(`/setup/${c.id}`)}>
                <Buddy buddy={c.buddy} accessory={c.wearing} size={24} /> {c.name}
              </button>
            ))}
          </div>
        )}
        <section className="panel">
          {error && <p className="form-error">{error}</p>}
          {loaded
            ? <ChildForm key={loaded.id} initial={loaded} onSubmit={save} onCancel={() => go("/parent")} onEdit={() => setSaved(false)} submitLabel="Save changes" />
            : !error && <p className="empty">Loading…</p>}
          {saved && <p className="form-ok" role="status">Saved.</p>}
        </section>
      </main>
      <Footer />
    </div>
  );
}
