/** Child details shared by first-time setup and the dashboard, plus the routine-time fields. */
import { useState, type FormEvent } from "react";
import { ROUTINE_PARTS, errorText, type ApiChild, type Buddy as BuddyName, type ChildInput, type RoutinePart, type RoutineTimes, type ThemeWorld } from "../lib/api";
import { MAX_AGE, MIN_AGE } from "../lib/habits";
import { formatTime } from "../lib/time";
import Buddy, { BUDDIES } from "./Buddy";

export const ROUTINE_LABEL: Record<RoutinePart, string> = {
  morning: "Morning", midday: "Midday", after_school: "After school", evening: "Evening", bedtime: "Bedtime",
};
export const DEFAULT_ROUTINE: RoutineTimes = { morning: "07:00", midday: "12:30", after_school: "16:00", evening: "18:00", bedtime: "20:00" };

const THEMES: { id: ThemeWorld; label: string }[] = [
  { id: "space", label: "Space" }, { id: "forest", label: "Forest" }, { id: "city", label: "City" },
];

export function RoutineFields({ times, onChange }: { times: RoutineTimes; onChange: (times: RoutineTimes) => void }) {
  return (
    <div className="routine-times">
      {ROUTINE_PARTS.map((part) => {
        const value = times[part] ?? "";
        return (
          <label key={part} className="setting">
            <span>{ROUTINE_LABEL[part]}</span>
            <input type="time" value={value} onChange={(e) => {
              const { [part]: _gone, ...rest } = times;
              onChange(e.target.value ? { ...rest, [part]: e.target.value } : rest);
            }} />
            <em>{value ? formatTime(value) : "Not set"}</em>
          </label>
        );
      })}
    </div>
  );
}

/** Adds a child, or edits one when `initial` is given. */
export function ChildForm({ initial, onSubmit, onCancel, onEdit, submitLabel }: {
  initial?: ChildInput;
  onSubmit: (input: ChildInput) => Promise<ApiChild | void>;
  onCancel?: () => void;
  onEdit?: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [age, setAge] = useState(initial?.age ?? 7);
  const [buddy, setBuddy] = useState<BuddyName>(initial?.buddy ?? "fox");
  const [world, setWorld] = useState<ThemeWorld>(initial?.world ?? "forest");
  const [times, setTimes] = useState<RoutineTimes>(initial?.routine_times ?? DEFAULT_ROUTINE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), age, buddy, world, routine_times: times });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} onChange={onEdit}>
      <div className="field-row">
        <label className="field">
          <span>Child's first name</span>
          <input required autoFocus={!initial} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field field--narrow">
          <span>Age</span>
          <select value={age} onChange={(e) => setAge(Number(e.target.value))}>
            {Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => i + MIN_AGE).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="field field--narrow">
          <span>Theme</span>
          <select value={world} onChange={(e) => setWorld(e.target.value as ThemeWorld)}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <span className="field__label">Pick a buddy</span>
      <div className="buddy-picker buddy-picker--sm" role="radiogroup" aria-label="Buddy">
        {BUDDIES.map((b) => (
          <button type="button" key={b.id} role="radio" aria-checked={buddy === b.id}
            className={`buddy-option ${buddy === b.id ? "is-on" : ""}`} onClick={() => { setBuddy(b.id); onEdit?.(); }}>
            <Buddy buddy={b.id} size={42} />
            <span>{b.name}</span>
          </button>
        ))}
      </div>
      <span className="field__label">Daily routine</span>
      <RoutineFields times={times} onChange={setTimes} />
      <p className="hint">Quests start at these times. You can change them later.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal__actions">
        {onCancel && <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>}
        <button className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}
