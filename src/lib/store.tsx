/**
 * App state provider: the signed-in family, account actions (register, sign in, demo),
 * and the parent-PIN prompt that protects approvals and grown-up pages.
 *
 * Pages call `useStore()`; every change goes through `update`, which saves to the browser.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import PinDialog from "../components/PinDialog";
import { hashSecret } from "./auth";
import {
  addChild, approveQuest, defaultHabits, newChild, setHabits, submitQuest, type BuddyId, type Family, type HabitSettings,
} from "./family";
import { submitFeedback } from "./feedback";
import { HABITS } from "./habits";
import { normalizeFamily } from "./migrate";
import { plantSurprise, requestReward } from "./rewards";
import { loadSaved, persist, setKidMode, type Saved } from "./storage";
import { dayKey, lastDays } from "./time";

export interface RegisterInput {
  parentName: string;
  email: string;
  password: string;
  pin: string;
  childName: string;
  childAge: number;
  buddy: BuddyId;
}

interface Store {
  family: Family | null;
  update: (fn: (f: Family) => Family) => void;
  register: (input: RegisterInput) => Promise<string | null>; // error message or null
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => void;
  startDemo: () => Promise<void>;
  /** Asks for the parent PIN (remembered for 5 minutes). Resolves true when correct. */
  askPin: (reason: string) => Promise<boolean>;
}

const StoreContext = createContext<Store | null>(null);
const PIN_GRACE_MS = 5 * 60 * 1000;

export const DEMO = { email: "demo@habbitquest.app", password: "demo1234", pin: "1234" };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [pinPrompt, setPinPrompt] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);
  const pinOkUntil = useRef(0);

  const stored = saved.session ? saved.families[saved.session] ?? null : null;
  const family = useMemo(() => (stored ? normalizeFamily(stored) : null), [stored]);

  const commit = useCallback((next: Saved) => {
    persist(next);
    setSaved(next);
  }, []);

  const update = useCallback(
    (fn: (f: Family) => Family) => {
      setSaved((prev) => {
        if (!prev.session || !prev.families[prev.session]) return prev;
        const current = normalizeFamily(prev.families[prev.session]);
        const next = { ...prev, families: { ...prev.families, [prev.session]: fn(current) } };
        persist(next);
        return next;
      });
    },
    []
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const email = input.email.trim().toLowerCase();
      if (saved.families[email]) return "An account with this email already exists. Try signing in.";
      const base = normalizeFamily({
        email,
        parentName: input.parentName.trim(),
        passwordHash: await hashSecret(input.password),
        pinHash: await hashSecret(input.pin),
        children: [],
        habits: defaultHabits(),
        habitsChosen: false,
        log: {},
        createdAt: new Date().toISOString(),
      });
      const fam = addChild(base, newChild(input.childName, input.childAge, input.buddy));
      setKidMode(false);
      commit({ families: { ...saved.families, [email]: fam }, session: email });
      return null;
    },
    [saved, commit]
  );

  const login = useCallback(
    async (emailRaw: string, password: string) => {
      const email = emailRaw.trim().toLowerCase();
      const fam = saved.families[email];
      if (!fam || fam.passwordHash !== (await hashSecret(password))) return "Email or password doesn't match.";
      setKidMode(false);
      commit({ ...saved, session: email });
      return null;
    },
    [saved, commit]
  );

  const logout = useCallback(() => {
    setKidMode(false);
    pinOkUntil.current = 0;
    commit({ ...saved, session: null });
  }, [saved, commit]);

  const startDemo = useCallback(async () => {
    const fam = await buildDemoFamily();
    setKidMode(false);
    commit({ families: { ...saved.families, [fam.email]: fam }, session: fam.email });
  }, [saved, commit]);

  const askPin = useCallback(
    (reason: string) => {
      if (Date.now() < pinOkUntil.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => setPinPrompt({ reason, resolve }));
    },
    []
  );

  const onPin = useCallback(
    async (pin: string | null) => {
      if (!pinPrompt) return true;
      if (pin === null) {
        pinPrompt.resolve(false);
        setPinPrompt(null);
        return true;
      }
      const ok = !!family && (await hashSecret(pin)) === family.pinHash;
      if (ok) {
        pinOkUntil.current = Date.now() + PIN_GRACE_MS;
        pinPrompt.resolve(true);
        setPinPrompt(null);
      }
      return ok;
    },
    [pinPrompt, family]
  );

  const value = useMemo(
    () => ({ family, update, register, login, logout, startDemo, askPin }),
    [family, update, register, login, logout, startDemo, askPin]
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      {pinPrompt && <PinDialog reason={pinPrompt.reason} onSubmit={onPin} />}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

/**
 * Demo family: two children with a week of history, built through the real rules so points,
 * streaks and levels add up.
 *   Alex (8): a quest approved today but not yet celebrated (opens with a sparkle), one waiting
 *             for the parent, a bonus quest, a surprise note waiting, and a check-in asking for help.
 *   Maya (6): level 2 with tier-2 quests, a crown for her buddy, and a reward request waiting.
 * Kid-mode time is limited to 30 minutes a day.
 */
async function buildDemoFamily(): Promise<Family> {
  const habits: HabitSettings = {
    ...defaultHabits(),
    screen: { enabled: true, value: "60" },
    dinner: { enabled: true, value: "20:00" },
  };
  const enabled = HABITS.filter((h) => habits[h.id].enabled).map((h) => h.id);

  let fam: Family = normalizeFamily({
    email: DEMO.email,
    parentName: "Sam",
    passwordHash: await hashSecret(DEMO.password),
    pinHash: await hashSecret(DEMO.pin),
    children: [],
    habits,
    habitsChosen: true,
    log: {},
    createdAt: new Date().toISOString(),
  });
  fam = setHabits(fam, habits);
  fam = { ...fam, settings: { appLimit: 30 } };
  fam = addChild(fam, { ...newChild("Alex", 8, "fox"), id: "alex", bonusQuests: ["brush-teeth"] });
  fam = addChild(fam, { ...newChild("Maya", 6, "bunny"), id: "maya", bonusQuests: ["story-time", "make-bed"],
    accessories: ["crown"], wearing: "crown", discoveries: ["mosswood:mushroom"] });

  const approve = (f: Family, day: string, child: string, quest: string) => approveQuest(submitQuest(f, day, child, quest), day, child, quest);
  const past = lastDays(7).slice(0, -1);
  past.forEach((day, i) => {
    enabled.filter((_, j) => (i + j) % 3 !== 0).slice(0, i % 2 === 0 ? 1 : 0).forEach((q) => (fam = approve(fam, day, "alex", q)));
    [...enabled, "story-time"].filter((_, j) => (i + j) % 2 === 0).forEach((q) => (fam = approve(fam, day, "maya", q)));
  });
  const today = dayKey();
  fam = approve(fam, today, "alex", "wake");
  fam = submitQuest(fam, today, "alex", "homework");
  fam = approve(fam, today, "maya", "wake");
  fam = {
    ...fam,
    children: fam.children.map((c) => (c.id === "maya" ? { ...c, celebrated: [`${today}:wake`], levelSeen: 2 } : { ...c, levelSeen: 1 })),
  };

  fam = requestReward(fam, "maya", "pick-dinner", today, () => 0.5).family;
  fam = plantSurprise(fam, { childId: "alex", kind: "note", message: "You've been working so hard on your homework. We're proud of you!", points: 20, day: today });
  fam = submitFeedback(fam, { childId: "alex", day: lastDays(2)[0], mood: "okay", hardest: "homework", favorite: "wake", stickers: ["help"], note: null, flagged: null });
  return fam;
}
