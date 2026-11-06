/** Child details shared by first-time setup and the dashboard, plus the routine-time fields. */
import { useState, type FormEvent } from "react";
import { ApiError, ROUTINE_PARTS, errorText, type ApiChild, type ChildInput, type RoutinePart, type RoutineTimes } from "../lib/api";
import { defaultCatalogBuddy } from "../lib/buddyCatalog";
import { buddyCatalogEnabled, buddyChoice, buddyRevision, buddySelectionInput, type BuddyChoice, type BuddyIdentitySource } from "../lib/buddyIdentity";
import { MAX_AGE, MIN_AGE } from "../lib/habits";
import { CompactBuddyPicker, catalogChoice } from "./BuddyPicker";

/** Display names for the parts of a child's day. */
export const ROUTINE_LABEL: Record<RoutinePart, string> = {
  morning: "Morning", midday: "Midday", after_school: "After school", evening: "Evening", bedtime: "Bedtime",
};
/** Start times suggested for a new child's day. */
export const DEFAULT_ROUTINE: RoutineTimes = { morning: "07:00", midday: "12:30", after_school: "16:00", evening: "18:00", bedtime: "20:00" };

const TIER_CHOICES = [
  { value: 0, label: "Follow their world (recommended)" }, { value: 1, label: "Easy quests only" },
  { value: 2, label: "Up to medium quests" }, { value: 3, label: "All quests" },
];

/** One time box per part of the day; clearing a box removes that time. */
export function RoutineFields({ times, onChange }: { times: RoutineTimes; onChange: (times: RoutineTimes) => void }) {
  return (
    <div className="routine-times">
      {ROUTINE_PARTS.map((part) => {
        const value = times[part] ?? "";
        return (
          <label key={part} className="routine-time">
            <span>{ROUTINE_LABEL[part]}</span>
            <input id={`routine-${part}`} type="time" value={value} aria-label={`${ROUTINE_LABEL[part]} starts at`} onChange={(e) => {
              const { [part]: _gone, ...rest } = times;
              onChange(e.target.value ? { ...rest, [part]: e.target.value } : rest);
            }} />
          </label>
        );
      })}
    </div>
  );
}

/** Adds a child, or edits one when `initial` is given. */
/** `wide`: a full-width page form (Child details), not a card or a step of setup. */
export function ChildForm({ initial, onSubmit, onCancel, onEdit, onReload, submitLabel, wide = false }: {
  initial?: ChildInput & BuddyIdentitySource;
  onSubmit: (input: ChildInput) => Promise<ApiChild | void>;
  onCancel?: () => void;
  onEdit?: () => void;
  onReload?: () => Promise<ApiChild>;
  submitLabel: string;
  wide?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [age, setAge] = useState(initial?.age ?? 7);
  const defaultChoice = (forAge: number): BuddyChoice => {
    const suggested = buddyCatalogEnabled() ? defaultCatalogBuddy(forAge) : undefined;
    return suggested ? catalogChoice(suggested) : { mode: "legacy", buddy: "fox" };
  };
  const [buddy, setBuddy] = useState<BuddyChoice>(() => initial ? buddyChoice(initial) : defaultChoice(7));
  const [buddyChanged, setBuddyChanged] = useState(false);
  const [savedBuddyRevision, setSavedBuddyRevision] = useState(() => initial ? buddyRevision(initial) : undefined);
  const [tier, setTier] = useState(initial?.tier_override ?? 0);
  const [times, setTimes] = useState<RoutineTimes>(initial?.routine_times ?? DEFAULT_ROUTINE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function reload() {
    if (!onReload) return;
    setBusy(true); setError(null);
    try { await onReload(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSubmit({ name: name.trim(), age, routine_times: times, ...(initial ? { tier_override: tier } : {}),
        ...(!initial || buddyChanged ? { buddy_selection: buddySelectionInput(buddy, savedBuddyRevision) } : {}),
      });
      if (saved) {
        setBuddy(buddyChoice(saved));
        setSavedBuddyRevision(buddyRevision(saved));
        setBuddyChanged(false);
        setConflict(false);
      }
    } catch (err) {
      setError(errorText(err));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`form ${wide ? "form--wide" : ""}`} onSubmit={submit} onChange={onEdit}>
      <div className="field-row">
        <label className="field">
          <span>Child's first name</span>
          <input required autoFocus={!initial} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Age</span>
          <select value={age} onChange={(e) => {
            const nextAge = Number(e.target.value);
            setAge(nextAge);
            if (!initial && !buddyChanged) setBuddy(defaultChoice(nextAge));
          }}>
            {Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => i + MIN_AGE).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <span className="field__label">Pick a buddy</span>
      <CompactBuddyPicker age={age} value={buddy} count={initial ? 6 : 3} disabled={busy}
        onManualChoice={!initial ? () => setBuddyChanged(true) : undefined}
        onChange={choice => { setBuddy(choice); setBuddyChanged(true); onEdit?.(); }} />
      {initial && (
        <label className="field">
          <span>Hardest quests allowed</span>
          <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            {TIER_CHOICES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      )}
      <div className="routine-head">
        <span className="field__label">Daily routine</span>
        <span className="hint">Quests start at these times. You can change them later.</span>
      </div>
      <RoutineFields times={times} onChange={setTimes} />
      {error && <p className="form-error">{error}</p>}
      {conflict && onReload && <div className="buddy-save-error"><p>The saved buddy changed. Reload saved details to review the latest choice. This replaces your unsaved form edits.</p><button type="button" className="btn btn--soft btn--sm" disabled={busy} onClick={reload}>Reload saved details</button></div>}
      <div className="modal__actions">
        {onCancel && <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
