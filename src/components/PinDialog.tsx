/**
 * Parent PIN prompt. Protects approvals and grown-up pages from little fingers.
 * `onSubmit(pin)` resolves true when the PIN is right; `onSubmit(null)` cancels.
 */
import { useState, type FormEvent } from "react";

interface Props {
  reason: string;
  onSubmit: (pin: string | null) => Promise<boolean>;
}

export default function PinDialog({ reason, onSubmit }: Props) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await onSubmit(pin);
    if (!ok) {
      setWrong(true);
      setPin("");
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <form className="modal__card" onSubmit={submit}>
        <p className="eyebrow">Grown-ups only</p>
        <h2 id="pin-title">Enter your parent PIN</h2>
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
            setWrong(false);
          }}
          aria-label="4-digit PIN"
          placeholder="••••"
        />
        {wrong && <p className="form-error">That PIN isn't right. Try again.</p>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onSubmit(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={pin.length !== 4}>
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
