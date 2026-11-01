/**
 * Kid-mode pieces around the quest board:
 *   usePlaytime / BreakTime  count kid-mode time and pause the app when today's limit is used up
 *   SurpriseReveal           a gift box hiding a parent's surprise (a note, bonus points, double day)
 *   ChestCard                the treasure chest unlocked by finishing every quest today
 *   CheckIn                  "how did today go?", sent to the grown-ups (notes are safety-checked)
 *   LevelBadge, PointsPill   progress at a glance
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ApiError, errorText, extendAppTime, getTodayCheckin, openChest, openSurprise, reportAppTime, sendCheckin, updateKidExtras,
  type ChestPrize, type Mood, type Surprise, type Today,
} from "../lib/api";
import { WORLDS, updateChild, type Child, type Family } from "../lib/family";
import { MOODS, STICKERS } from "../lib/feedback";
import { appSecondsLeft, WARN_SECONDS } from "../lib/playtime";
import { ACCESSORIES } from "../lib/rewards";
import { go } from "../lib/router";
import { setKidMode } from "../lib/storage";
import { useStore } from "../lib/store";
import { applyExtras } from "../lib/sync";
import { dayKey } from "../lib/time";
import Buddy from "./Buddy";
import HabitArt from "./HabitArt";

// ── Playtime ──────────────────────────────────────────────────────────────────

const TICK_SECONDS = 30;

/** Counts kid-mode time while the page is visible. Returns seconds left today, or null with no limit. */
export function usePlaytime(child: Child | undefined): number | null {
  const { family, update } = useStore();
  const day = dayKey();
  const childId = child?.id;
  useEffect(() => {
    if (!childId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      reportAppTime(TICK_SECONDS).then((extras) => update((f) => applyExtras(f, childId, extras))).catch(() => {});
    }, TICK_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [childId, update]);
  return child && family ? appSecondsLeft(family, child, day) : null;
}

/** Shown on top of kid mode when today's time is used up. Only a grown-up can add more. */
export function BreakTime({ child, family }: { child: Child; family: Family }) {
  const { update, askPin, askPinValue } = useStore();
  const [error, setError] = useState<string | null>(null);
  const day = dayKey();
  async function more(minutes: number) {
    const pin = await askPinValue(`Give ${child.name} ${minutes} more minutes in the app today.`);
    if (!pin) return;
    try {
      const extras = await extendAppTime(child.id, minutes, pin);
      update((f) => applyExtras(f, child.id, extras));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function leave() {
    if (await askPin("Leave kid mode and open the parent dashboard.")) {
      setKidMode(false);
      go("/parent");
    }
  }
  return (
    <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Break time">
      <div className="kid-overlay__card">
        <Buddy buddy={child.buddy} accessory={child.wearing} size={110} />
        <h2>Time for a break, {child.name}!</h2>
        <p>You've used your {family.settings.appLimit + (child.appExtraMinutes[day] ?? 0)} minutes of quest time today. Go play, read a story or help at home. Your quests will wait for you!</p>
        <div className="kid-overlay__grown">
          <span>For grown-ups:</span>
          <button className="btn btn--ghost btn--sm" onClick={() => more(10)}>+10 min</button>
          <button className="btn btn--ghost btn--sm" onClick={() => more(20)}>+20 min</button>
          <button className="btn btn--soft btn--sm" onClick={leave}>Parent area</button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}

export function TimeWarning({ seconds }: { seconds: number | null }) {
  if (seconds === null || seconds <= 0 || seconds > WARN_SECONDS) return null;
  return <div className="time-warning" role="status">⏳ {Math.ceil(seconds / 60)} minute{seconds > 60 ? "s" : ""} of quest time left today</div>;
}

// ── Surprises ─────────────────────────────────────────────────────────────────

export function SurpriseReveal({ surprise, child, parentName, onDone }: { surprise: Surprise; child: Child; parentName: string; onDone: () => void }) {
  const { update } = useStore();
  const [open, setOpen] = useState(false);
  async function close() {
    try {
      const { points } = await openSurprise(surprise.id);
      update((f) => updateChild(f, child.id, (c) => ({ ...c, balance: points })));
    } catch {
      /* already opened on another device */
    }
    onDone();
  }
  return (
    <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="A surprise for you">
      <div className="kid-overlay__card">
        {!open ? (
          <>
            <p className="eyebrow">A surprise for you!</p>
            <button className="gift" onClick={() => setOpen(true)} aria-label="Open the surprise">
              <span className="gift__box">🎁</span>
            </button>
            <p className="muted">Tap the present to open it</p>
          </>
        ) : (
          <>
            <div className="gift__burst" aria-hidden="true">✨🎉✨</div>
            {surprise.kind === "double" ? (
              <>
                <h2>Double points day!</h2>
                <p>Every quest you finish today is worth <b>2x points</b>. Go go go!</p>
              </>
            ) : (
              <>
                <h2>From {parentName}</h2>
                {surprise.message && <p className="gift__message">“{surprise.message}”</p>}
                {surprise.points > 0 && <p className="celebrate__points">+{surprise.points} bonus points</p>}
              </>
            )}
            <button className="btn btn--gold btn--lg" onClick={close} autoFocus>Yay!</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Treasure chest ────────────────────────────────────────────────────────────

export function ChestCard({ child, today }: { child: Child; today: Today }) {
  const { update } = useStore();
  const [prize, setPrize] = useState<ChestPrize | null>(null);
  const opened = child.chests.includes(today.day);
  const ready = !opened && today.habits.length > 0 && today.habits.every((h) => h.status === "approved");
  if (!ready && !prize) {
    return opened ? null : (
      <div className="chest chest--locked">
        <span className="chest__icon" aria-hidden="true">🧰</span>
        <div><b>Treasure chest</b><span>Finish all of today's quests to open it!</span></div>
      </div>
    );
  }
  async function open() {
    try {
      const opened = await openChest();
      setPrize(opened.prize);
      update((f) => updateChild(applyExtras(f, child.id, opened.extras), child.id, (c) => ({ ...c, balance: opened.points })));
    } catch {
      /* already open: the next refresh hides this */
    }
  }
  return (
    <>
      {ready && (
        <button className="chest chest--ready" onClick={open}>
          <span className="chest__icon" aria-hidden="true">🧰</span>
          <div><b>You did every quest!</b><span>Tap to open your treasure chest</span></div>
        </button>
      )}
      {prize && (
        <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Treasure!" onClick={() => setPrize(null)}>
          <div className="kid-overlay__card" onClick={(e) => e.stopPropagation()}>
            <div className="gift__burst" aria-hidden="true">✨🧰✨</div>
            {prize.kind === "accessory" ? (
              <>
                <Buddy buddy={child.buddy} accessory={prize.id} size={120} />
                <h2>You found a {prize.name}!</h2>
                <p>Your buddy is wearing it now. Change it any time in the shop.</p>
              </>
            ) : (
              <>
                <h2>+{prize.points} bonus points!</h2>
                <p>Treasure for a super quest day. Spend them in the shop.</p>
              </>
            )}
            <button className="btn btn--gold btn--lg" onClick={() => setPrize(null)} autoFocus>Awesome!</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Check-in ──────────────────────────────────────────────────────────────────

export function CheckIn({ child, quests, onClose }: { child: Child; quests: { id: string; kidTitle: string }[]; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [mood, setMood] = useState<Mood | null>(null);
  const [hardest, setHardest] = useState<string | null>(null);
  const [favorite, setFavorite] = useState<string | null>(null);
  const [stickers, setStickers] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ safety: string | null } | null>(null);
  const canWrite = child.age >= 6;

  useEffect(() => {
    getTodayCheckin().then((previous) => {
      if (!previous) return;
      setMood(previous.mood);
      setHardest(previous.hardest);
      setFavorite(previous.favorite);
      setStickers(previous.stickers);
    }).catch(() => {});
  }, []);

  async function send() {
    if (!mood) return;
    setBusy(true);
    setProblem(null);
    try {
      const { message } = await sendCheckin({ mood, hardest, favorite, stickers, note: note.trim() || null });
      setDone({ safety: message });
    } catch (e) {
      // The server screens the note and answers with a message written for the child.
      setProblem(e instanceof ApiError ? e.detail : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setStickers((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  let body: ReactNode;
  if (done) {
    body = (
      <>
        <Buddy buddy={child.buddy} accessory={child.wearing} size={96} />
        <h2>{done.safety ? "Thank you for telling us" : "Sent to your grown-ups! 💌"}</h2>
        <p>{done.safety ?? "Thanks for sharing how today went."}</p>
        <button className="btn btn--gold btn--lg" onClick={onClose} autoFocus>OK</button>
      </>
    );
  } else if (step === 0) {
    body = (
      <>
        <h2>How did today feel?</h2>
        <div className="mood-grid">
          {MOODS.map((m) => (
            <button key={m.id} className={`mood ${mood === m.id ? "is-on" : ""}`} onClick={() => { setMood(m.id); setStep(1); }}>
              <span aria-hidden="true">{m.emoji}</span>{m.label}
            </button>
          ))}
        </div>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <h2>Which quest was tricky?</h2>
        <QuestPicker quests={quests} value={hardest} onChange={setHardest} />
        <h2 className="checkin__sub">Which was your favourite?</h2>
        <QuestPicker quests={quests} value={favorite} onChange={setFavorite} />
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={() => setStep(0)}>Back</button>
          <button className="btn btn--gold" onClick={() => setStep(2)}>Next</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h2>Tell your grown-ups</h2>
        <div className="sticker-grid">
          {STICKERS.map((s) => (
            <button key={s.id} className={`sticker ${stickers.includes(s.id) ? "is-on" : ""}`} aria-pressed={stickers.includes(s.id)} onClick={() => toggle(s.id)}>
              <span aria-hidden="true">{s.emoji}</span>{s.text}
            </button>
          ))}
        </div>
        {canWrite && (
          <label className="field">
            <span>Or write a short note (optional)</span>
            <input value={note} maxLength={200} onChange={(e) => { setNote(e.target.value); setProblem(null); }} placeholder="Today I…" />
          </label>
        )}
        {problem && <p className="form-error">{problem}</p>}
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={() => setStep(1)}>Back</button>
          <button className="btn btn--gold" onClick={send} disabled={busy}>{busy ? "Checking…" : "Send 💌"}</button>
        </div>
      </>
    );
  }

  return (
    <div className="kid-overlay" role="dialog" aria-modal="true" aria-label="Check in with your grown-ups">
      <div className="kid-overlay__card kid-overlay__card--wide">
        {!done && <button className="kid-overlay__close" onClick={onClose} aria-label="Close">×</button>}
        {body}
      </div>
    </div>
  );
}

function QuestPicker({ quests, value, onChange }: { quests: { id: string; kidTitle: string }[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="quest-picker">
      {quests.map((q) => (
        <button key={q.id} className={`quest-pick ${value === q.id ? "is-on" : ""}`} aria-pressed={value === q.id} onClick={() => onChange(value === q.id ? null : q.id)}>
          <HabitArt habit={q.id} />
          <span>{q.kidTitle}</span>
        </button>
      ))}
    </div>
  );
}

// ── Progress badges ───────────────────────────────────────────────────────────

export function LevelBadge({ child }: { child: Child }) {
  const progress = child.progress;
  if (!progress) return null;
  const start = WORLDS[progress.level - 1].sparks;
  const next = WORLDS[progress.level];
  const pct = next ? ((child.sparks - start) / (next.sparks - start)) * 100 : 100;
  return (
    <div className="level-badge" aria-label={`Level ${progress.level}, ${progress.level_name}`}>
      <span className="level-badge__num">{progress.level}</span>
      <div>
        <b>{progress.level_name}</b>
        <div className="level-badge__bar"><span style={{ width: `${pct}%` }} /></div>
        <small>{next ? `${next.sparks - child.sparks} Sparks to ${next.name}` : "Top level!"}</small>
      </div>
    </div>
  );
}

export function PointsPill({ points }: { points: number }) {
  return <span className="points-pill"><span aria-hidden="true">🪙</span><b>{points}</b> pts</span>;
}

/** Collected accessories, with the ones still to find shown as mystery slots. */
export function Wardrobe({ child }: { child: Child }) {
  const { update } = useStore();
  const wear = (id: string | null) => {
    update((f) => updateChild(f, child.id, (c) => ({ ...c, wearing: id })));
    updateKidExtras({ wearing: id ?? "" }).catch(() => {}); // the next refresh shows the saved outfit
  };
  return (
    <div className="wardrobe">
      <button className={`wardrobe__item ${!child.wearing ? "is-on" : ""}`} onClick={() => wear(null)}>
        <Buddy buddy={child.buddy} size={64} />
        <span>Nothing</span>
      </button>
      {ACCESSORIES.map((a) => {
        const owned = child.accessories.includes(a.id);
        return owned ? (
          <button key={a.id} className={`wardrobe__item ${child.wearing === a.id ? "is-on" : ""}`}
            onClick={() => wear(a.id)}>
            <Buddy buddy={child.buddy} accessory={a.id} size={64} />
            <span>{a.name}</span>
          </button>
        ) : (
          <div key={a.id} className="wardrobe__item is-locked" aria-label="Not found yet">
            <span className="wardrobe__mystery" aria-hidden="true">?</span>
            <span>Find in a chest</span>
          </div>
        );
      })}
    </div>
  );
}
