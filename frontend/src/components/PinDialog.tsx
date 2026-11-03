/**
 * PIN prompt. The parent PIN protects approvals and grown-up pages from little fingers; a kid PIN
 * keeps siblings out of each other's quests.
 * `onSubmit(pin)` resolves true when the PIN is right, false when it is wrong, or a message when
 * it couldn't be checked; `onSubmit(null)` cancels. The backend checks the PIN.
 */
import { useState, type FormEvent } from "react";

interface Props {
  reason: string;
  onSubmit: (pin: string | null) => Promise<boolean | string>;
  eyebrow?: string; // the kid PIN prompt uses its own words
  title?: string;
}

export default function PinDialog({ reason, onSubmit, eyebrow = "Grown-ups only", title = "Enter your parent PIN" }: Props) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(pin);
    setBusy(false);
    if (ok !== true) {
      setWrong(ok === false ? "That PIN isn't right. Try again." : ok);
      setPin("");
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <form className="modal__card" onSubmit={submit}>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="pin-title">{title}</h2>
        <p className="muted">{reason}</p>
        <input
          className={`pin-input ${wrong ? "pin-input--wrong" : ""}`}
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setWrong(null);
          }}
          aria-label="4-digit PIN"
          placeholder="••••"
        />
        {wrong && <p className="form-error">{wrong}</p>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={pin.length !== 4 || busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
