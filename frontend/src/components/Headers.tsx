/**
 * Page headers: SiteHeader for the public home page, ParentHeader for the grown-up area.
 * (The kid screen has its own playful header inside KidQuests.)
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { go } from "../lib/router";
import { useStore } from "../lib/store";
import Logo from "./Logo";

/** The public site's header: logo, section links and Get started (or Open dashboard when signed in). */
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
            <a className="btn btn--primary" href="#/login">Get started</a>
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

/**
 * The grown-up area's header: the page tabs, Kid mode, and the account menu. `active` underlines one tab.
 */
export function ParentHeader({ active }: { active: "dashboard" | "coach" | "habits" | "quests" | "rewards" | "family" }) {
  const { family, logout, enterKidMode } = useStore();
  return (
    <header className="topbar topbar--app">
      <div className="wrap topbar__inner">
        <Logo href="#/parent" />
        <nav className="topbar__nav topbar__nav--app" aria-label="Parent">
          <a href="#/parent" className={active === "dashboard" ? "is-active" : ""}>Dashboard</a>
          <a href="#/coach" className={active === "coach" ? "is-active" : ""}>Habit coach</a>
          <a href="#/setup" className={active === "habits" ? "is-active" : ""}>Child details</a>
          <a href="#/quests" className={active === "quests" ? "is-active" : ""}>Quest library</a>
          <a href="#/rewards" className={active === "rewards" ? "is-active" : ""}>Rewards &amp; limits</a>
          <a
            href="#/kid"
            onClick={(e) => {
              e.preventDefault();
              enterKidMode();
              go("/kid");
            }}
          >
            Kid mode
          </a>
        </nav>
        <div className="topbar__actions">
          <AccountMenu name={family?.parentName ?? ""} active={active === "family"} onSignOut={() => { logout(); go("/"); }} />
        </div>
      </div>
    </header>
  );
}

/** "Hi, Sam" opens Family settings and Sign out. Closes on outside click or Escape. */
function AccountMenu({ name, active, onSignOut }: { name: string; active: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="account" ref={box}>
      <button type="button" className={`account__button ${active ? "is-active" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="account__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase() || "?"}</span>
        <span className="account__name">Hi, {name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="account__menu" role="menu">
          <a role="menuitem" href="#/family" onClick={() => setOpen(false)}>Family settings</a>
          <button role="menuitem" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

/** The footer on public and grown-up pages, with the privacy link. */
export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <Logo />
        <p>Real-world habits. New worlds to explore. <a href="#/privacy">Privacy</a></p>
      </div>
    </footer>
  );
}
