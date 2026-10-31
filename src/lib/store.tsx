/**
 * App state provider: the signed-in caregiver, their family and children from the backend, the
 * browser-only extras for that family, and the parent-PIN prompt.
 *
 * `family` is the browser-side model (family.ts) with the backend's children merged in. Pages call
 * the API for anything the backend owns and `update` for browser-only extras, which saves locally.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PinDialog from "../components/PinDialog";
import * as api from "./api";
import { childDefaults, defaultHabits, type Family } from "./family";
import { normalizeFamily } from "./migrate";
import { go } from "./router";
import {
  clearCaregiverToken, getCaregiverToken, getKidMode, getKidSession, loadSaved, persist, saveCaregiverToken, setKidMode,
  type Saved, type Snapshot,
} from "./storage";

/** booting: first load | signedOut | noFamily: needs family setup | ready | failed: couldn't load */
export type Phase = "booting" | "signedOut" | "noFamily" | "ready" | "failed";

interface Store {
  phase: Phase;
  loadError: string | null;
  waking: boolean; // the server is taking a while to wake up
  notice: string | null; // shown on the sign-in page
  me: api.Me | null;
  server: api.ApiFamily | null;
  family: Family | null;
  /** Changes browser-only extras (and the local mirror). */
  update: (fn: (f: Family) => Family) => void;
  signInGoogle: (credential: string) => Promise<string | null>; // error message or null
  signInDev: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  retry: () => void;
  /** Reloads the account, family and children from the backend. */
  reload: () => Promise<void>;
  setServer: (family: api.ApiFamily) => void;
  /** Asks for the parent PIN (remembered for 5 minutes). Resolves true when correct. */
  askPin: (reason: string) => Promise<boolean>;
  /** The same prompt, for actions the server checks itself: resolves with the PIN, or null if cancelled. */
  askPinValue: (reason: string) => Promise<string | null>;
  /** Hands the device over: kid mode on, and a recent PIN no longer counts. */
  enterKidMode: () => void;
}

const StoreContext = createContext<Store | null>(null);
const PIN_GRACE_MS = 5 * 60 * 1000;

/** The browser-side family: saved extras with the backend's account and children merged in. */
export function reconcile(saved: Family | undefined, { me, server, children }: Snapshot): Family {
  const base = normalizeFamily(saved ?? { email: "", parentName: "", children: [], habits: defaultHabits(), habitsChosen: true, log: {}, createdAt: server.created_at });
  const link = me.families.find((f) => f.id === server.id);
  const known = new Map(base.children.map((c) => [c.id, c]));
  return {
    ...base,
    email: me.email ?? "",
    parentName: link?.display_name ?? server.caregivers.find((c) => c.user_id === me.id)?.display_name ?? me.name ?? "there",
    children: children.map((c) => ({ ...childDefaults(), ...known.get(c.id), id: c.id, name: c.name, age: c.age, buddy: c.buddy })),
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const saved = useRef<Saved>(loadSaved());
  const [phase, setPhase] = useState<Phase>("booting");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [pinPrompt, setPinPrompt] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);
  const pinOkUntil = useRef(0);
  const lastPin = useRef<string | null>(null); // kept in memory only, for the same 5 minutes
  const familyId = snapshot?.server.id;

  const adopt = useCallback((next: Snapshot) => {
    saved.current = { ...saved.current, snapshot: next };
    persist(saved.current);
    setSnapshot(next);
    setFamily((prev) => reconcile(saved.current.families[next.server.id] ?? prev ?? undefined, next));
    setPhase("ready");
  }, []);

  const update = useCallback(
    (fn: (f: Family) => Family) => {
      setFamily((prev) => {
        if (!prev || !familyId) return prev;
        const next = fn(prev);
        saved.current = { ...saved.current, families: { ...saved.current.families, [familyId]: next } };
        persist(saved.current);
        return next;
      });
    },
    [familyId]
  );

  const load = useCallback(async () => {
    const me = await api.getMe();
    const link = me.families[0];
    if (!link) {
      setSnapshot(null);
      setFamily(null);
      setPhase("noFamily");
      return;
    }
    const [server, kids] = await Promise.all([api.getFamily(link.id), api.listChildren(link.id)]);
    adopt({ me, server, children: kids });
  }, [adopt]);

  const boot = useCallback(async () => {
    setLoadError(null);
    if (!getCaregiverToken()) {
      // Kid mode keeps working on its own token after the caregiver token runs out.
      const cached = saved.current.snapshot;
      if (cached && getKidMode() && getKidSession()) adopt(cached);
      else setPhase("signedOut");
      return;
    }
    setPhase("booting");
    try {
      await load();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) return; // the expiry listener took over
      setLoadError(api.errorText(e));
      setPhase("failed");
    }
  }, [adopt, load]);

  const endSession = useCallback(() => {
    clearCaregiverToken();
    setKidMode(false);
    pinOkUntil.current = 0;
    lastPin.current = null;
    saved.current = { ...saved.current, snapshot: null };
    persist(saved.current);
    setSnapshot(null);
    setFamily(null);
    setPhase("signedOut");
  }, []);

  const started = useRef(false);
  useEffect(() => {
    api.setWakingListener(setWaking);
    api.setExpiredListener(() => {
      endSession();
      setNotice("Your session ended. Please sign in again.");
      go("/login");
    });
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    void boot();
  }, [boot, endSession]);

  const afterToken = useCallback(
    async (token: api.TokenResponse) => {
      saveCaregiverToken(token.access_token, token.expires_in);
      setKidMode(false);
      setNotice(null);
      await load();
    },
    [load]
  );

  const signInGoogle = useCallback(
    async (credential: string) => {
      try {
        await afterToken(await api.signInWithGoogle(credential));
        return null;
      } catch (e) {
        return api.errorText(e);
      }
    },
    [afterToken]
  );

  const signInDev = useCallback(
    async (username: string, password: string) => {
      try {
        await afterToken(await api.signInDev(username, password));
        return null;
      } catch (e) {
        return api.errorText(e);
      }
    },
    [afterToken]
  );

  const setServer = useCallback(
    (server: api.ApiFamily) => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const next = { ...prev, server };
        saved.current = { ...saved.current, snapshot: next };
        persist(saved.current);
        return next;
      });
    },
    []
  );

  const askPin = useCallback((reason: string) => {
    if (Date.now() < pinOkUntil.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setPinPrompt({ reason, resolve }));
  }, []);

  const askPinValue = useCallback(async (reason: string) => {
    if (Date.now() >= pinOkUntil.current) lastPin.current = null;
    return (await askPin(reason)) ? lastPin.current : null;
  }, [askPin]);

  const enterKidMode = useCallback(() => {
    pinOkUntil.current = 0;
    lastPin.current = null;
    setKidMode(true);
  }, []);

  const onPin = useCallback(
    async (pin: string | null): Promise<boolean | string> => {
      if (!pinPrompt) return true;
      if (pin === null) {
        pinPrompt.resolve(false);
        setPinPrompt(null);
        return true;
      }
      if (!familyId) return false;
      try {
        const { valid } = await api.verifyPin(familyId, pin);
        if (!valid) return false;
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 401) {
          pinPrompt.resolve(false);
          setPinPrompt(null);
          return true; // on the way to sign-in
        }
        return api.errorText(e);
      }
      pinOkUntil.current = Date.now() + PIN_GRACE_MS;
      lastPin.current = pin;
      pinPrompt.resolve(true);
      setPinPrompt(null);
      return true;
    },
    [pinPrompt, familyId]
  );

  const value = useMemo<Store>(
    () => ({
      phase, loadError, waking, notice, me: snapshot?.me ?? null, server: snapshot?.server ?? null, family, update,
      signInGoogle, signInDev, logout: endSession, retry: boot, reload: load, setServer, askPin, askPinValue, enterKidMode,
    }),
    [phase, loadError, waking, notice, snapshot, family, update, signInGoogle, signInDev, endSession, boot, load, setServer, askPin, askPinValue, enterKidMode]
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      {waking && <div className="waking" role="status"><span className="thinking__dots" aria-hidden="true"><i /><i /><i /></span>Waking up the server… this can take up to a minute.</div>}
      {pinPrompt && <PinDialog reason={pinPrompt.reason} onSubmit={onPin} />}
    </StoreContext.Provider>
  );
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}
