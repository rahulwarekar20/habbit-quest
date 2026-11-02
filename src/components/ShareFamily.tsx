/**
 * The family's QR code and login code, for a child's own device or another grown-up's. Scanning it
 * opens #/join/<code>, which asks "I'm a kid" (kid PIN) or "I'm a grown-up" (the invite code).
 */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { errorText, newLoginCode, type ApiFamily } from "../lib/api";
import { useStore } from "../lib/store";

export const joinLink = (code: string) => `${window.location.origin}${window.location.pathname}#/join/${code}`;
const spaced = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

export default function ShareFamily({ family }: { family: ApiFamily }) {
  const { setServer } = useStore();
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const code = family.login_code;

  useEffect(() => {
    setQr(null);
    if (code) QRCode.toDataURL(joinLink(code), { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [code]);

  async function makeCode() {
    if (code && !window.confirm("Make a new code? The old QR code and code stop working, and kids sign in with the new one.")) return;
    setBusy(true);
    setError(null);
    try {
      setServer(await newLoginCode(family.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const link = joinLink(code!);
    try {
      if (navigator.share) await navigator.share({ title: `Join ${family.name} on HabitQuest`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      /* the share sheet was closed */
    }
  }

  return (
    <div className="share">
      <div className="share__text">
        <b>Sign in on another device</b>
        <span className="muted">
          Scan the QR code, or open HabitQuest and enter the family code. Kids pick themselves and enter their own PIN;
          grown-ups sign in and use the invite code below.
        </span>
        {code ? (
          <>
            <span className="share__code" aria-label={`Family code ${code.split("").join(" ")}`}>{spaced(code)}</span>
            <div className="share__actions">
              <button className="btn btn--soft btn--sm" onClick={share}>{copied ? "Link copied" : "Share link"}</button>
              <button className="btn btn--ghost btn--sm" disabled={busy} onClick={makeCode}>New code</button>
            </div>
          </>
        ) : (
          <div className="share__actions">
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={makeCode}>Make a QR code</button>
          </div>
        )}
        <span className="hint">Kids need their own PIN first. Set it in Child details.</span>
        {error && <p className="form-error">{error}</p>}
      </div>
      {code && qr && <img className="share__qr" src={qr} width={180} height={180} alt={`QR code to join ${family.name}`} />}
    </div>
  );
}
