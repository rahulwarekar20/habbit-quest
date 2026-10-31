/** Google sign-in: loads Google's script and draws its button. The credential goes to our API. */
import { useEffect, useRef, useState } from "react";

const SCRIPT = "https://accounts.google.com/gsi/client";

interface GoogleId {
  initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

function loadScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const script = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT, async: true });
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("blocked")));
    if (!existing) document.head.appendChild(script);
  });
}

export default function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    loadScript()
      .then(() => {
        if (!live || !box.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential) });
        window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: Math.min(300, box.current.clientWidth) });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!clientId) return <p className="hint">Google sign-in isn't set up here (VITE_GOOGLE_CLIENT_ID is missing).</p>;
  if (failed) return <p className="form-error">Google sign-in couldn't load. Check your connection or ad blocker.</p>;
  return <div ref={box} className="google-button" />;
}
