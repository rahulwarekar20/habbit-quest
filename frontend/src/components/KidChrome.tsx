/**
 * Pieces every kid screen shares: the top bar with the PIN-protected way back to the parent area,
 * the "time's up" screen, a not-found message and the lock icon.
 */
import { PointsPill } from "./KidExtras";
import Logo from "./Logo";
import { SparkCount } from "./Spark";
import { type Child } from "../lib/family";
import { go } from "../lib/router";
import { getKidLogin, setKidMode } from "../lib/storage";
import { useStore } from "../lib/store";

/**
 * Top bar shared by the kid screens, with the PIN-protected way back to the parent area. A child who
 * signed in on their own signs out instead: there is no grown-up session on this device.
 */
export function KidBar({ child }: { child?: Child }) {
  const { askPin, logout } = useStore();
  const own = getKidLogin();
  async function grownUps() {
    if (own) {
      // Back to the family's code page for the next child; reloading keeps the sign-in redirect out of the way.
      logout();
      window.location.hash = `#/join/${own.code}`;
      window.location.reload();
      return;
    }
    if (await askPin("Leave kid mode and open the parent dashboard.")) {
      setKidMode(false);
      go("/parent");
    }
  }
  return (
    <header className="kidbar">
      <div className="wrap kidbar__inner">
        <Logo href={child ? `#/kid/${child.id}` : "#/kid"} />
        <div className="kidbar__right">
          {child && <a href={`#/shop/${child.id}`} className="kidbar__points" aria-label="Reward shop"><PointsPill points={child.balance} /></a>}
          {child && <SparkCount count={child.sparks} />}
          <button className="btn btn--ghost btn--sm kidbar__lock" onClick={grownUps} aria-label={own ? "Sign out" : "Grown-ups"}>
            <LockIcon /> <span className="lock-label">{own ? "Sign out" : "Grown-ups"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Who's playing? ────────────────────────────────────────────────────────────

/** The kid session ran out: a grown-up starts it again with the PIN. */
export function KidLapsed({ onResume }: { onResume: () => void }) {
  const own = !!getKidLogin(); // a child who signed in on their own just signs in again
  return (
    <div className="page page--kid">
      <main className="wrap kid-main">
        <h1>Quest time paused</h1>
        <p className="lead">{own ? "Enter your PIN to keep going." : "Ask a grown-up to start your quests again."}</p>
        <button className="btn btn--gold btn--lg" onClick={onResume}>{own ? "Enter my PIN" : "Grown-ups: enter PIN"}</button>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page page--kid">
      <main className="wrap kid-main">
        <h1>Hmm, we couldn't find that.</h1>
        <a className="btn btn--primary" href="#/kid">Back to quests</a>
      </main>
    </div>
  );
}

export function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.5" fill="none" />
    </svg>
  );
}
