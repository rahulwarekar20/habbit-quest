/**
 * Page headers: SiteHeader for the public home page, ParentHeader for the grown-up area.
 * (The kid screen has its own playful header inside KidQuests.)
 */
import type { MouseEvent } from "react";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import { setKidMode } from "../lib/storage";
import Logo from "./Logo";

export function SiteHeader() {
  const { family } = useStore();
  return (
    <header className="topbar">
      <div className="wrap topbar__inner">
        <Logo />
        <nav className="topbar__nav" aria-label="Sections">
          <a href="#how" onClick={scrollTo("how")}>How it works</a>
          <a href="#habits" onClick={scrollTo("habits")}>Habits</a>
          <a href="#worlds" onClick={scrollTo("worlds")}>Worlds</a>
          <a href="#parents" onClick={scrollTo("parents")}>For parents</a>
        </nav>
        <div className="topbar__actions">
          {family ? (
            <a className="btn btn--primary" href="#/parent">Open dashboard</a>
          ) : (
            <>
              <a className="btn btn--ghost" href="#/login">Sign in</a>
              <a className="btn btn--primary" href="#/register">Get started</a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** In-page section links that don't fight the hash router. */
function scrollTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };
}

export function ParentHeader({ active }: { active: "dashboard" | "habits" | "quests" | "rewards" }) {
  const { family, logout } = useStore();
  return (
    <header className="topbar topbar--app">
      <div className="wrap topbar__inner">
        <Logo href="#/parent" />
        <nav className="topbar__nav topbar__nav--app" aria-label="Parent">
          <a href="#/parent" className={active === "dashboard" ? "is-active" : ""}>Dashboard</a>
          <a href="#/setup" className={active === "habits" ? "is-active" : ""}>Habits &amp; times</a>
          <a href="#/quests" className={active === "quests" ? "is-active" : ""}>Quest library</a>
          <a href="#/rewards" className={active === "rewards" ? "is-active" : ""}>Rewards &amp; limits</a>
          <a
            href="#/kid"
            onClick={(e) => {
              e.preventDefault();
              setKidMode(true);
              go("/kid");
            }}
          >
            Kid mode
          </a>
        </nav>
        <div className="topbar__actions">
          <span className="topbar__hello">Hi, {family?.parentName}</span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              logout();
              go("/");
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <Logo />
        <p>Real-world habits. New worlds to explore. Prototype: your family's data stays in this browser.</p>
      </div>
    </footer>
  );
}
