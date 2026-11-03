/**
 * Browser persistence. Reads and writes never throw, so blocked storage just means a fresh start.
 *
 *   localStorage    the caregiver token, a snapshot of the account (so kid mode survives a reload
 *                   after the caregiver token runs out), the browser-only extras per family, and
 *                   which coach chats were already started fresh in this sign-in
 *                   and a child's own sign-in (family code and kid PIN), which lasts its 8 hours
 *   sessionStorage  kid mode and the kid token: per tab, like a device handed to a child
 *
 * Families, children, habits, approvals and points live on the backend. The old local accounts
 * under "habbit-quest.v1" are not read any more.
 */
import type { ApiChild, ApiFamily, Me } from "./api";
import type { Family } from "./family";

const KEY = "habbit-quest.v2";
const CAREGIVER_TOKEN = "habbit-quest.token";
const KID_MODE = "habbit-quest.kidMode";
const KID_SESSION = "habbit-quest.kidSession";
const COACH_FRESH = "habbit-quest.coachFresh";
const KID_LOGIN = "habbit-quest.kidLogin";

export interface Snapshot {
  me: Me;
  server: ApiFamily;
  children: ApiChild[];
}

export interface Saved {
  families: Record<string, Family>; // browser-only extras by backend family id
  snapshot: Snapshot | null;
}

/**
 * Reads the saved account snapshot and browser-only family extras; a fresh start when nothing (or nothing readable) is saved.
 */
export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { families: {}, snapshot: null, ...JSON.parse(raw) };
  } catch {
    /* unreadable: start fresh */
  }
  return { families: {}, snapshot: null };
}

/** Saves the account snapshot and browser-only extras. Blocked or full storage is ignored. */
export function persist(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

export interface StoredToken {
  token: string;
  expiresAt: number; // ms since the epoch
}

export interface KidSession extends StoredToken {
  childId: string;
  childName: string;
}

function read<T extends StoredToken>(store: () => Storage, key: string): T | null {
  try {
    const raw = store().getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    return value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: unknown): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, JSON.stringify(value));
  } catch {
    /* blocked: the token lasts until the next reload at most */
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

/** The caregiver token, or null when there is none or it has expired. */
export const getCaregiverToken = () => read<StoredToken>(local, CAREGIVER_TOKEN);

/** Keeps the grown-up's token and when it expires. */
export function saveCaregiverToken(token: string, expiresInSeconds: number): void {
  write(local, CAREGIVER_TOKEN, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

/** Forgets the grown-up's token (signing out). */
export const clearCaregiverToken = () => write(local, CAREGIVER_TOKEN, null);

/** This tab's kid token, or a child's own sign-in; null when there is none or it has expired. */
export const getKidSession = (): KidSession | null => read<KidSession>(session, KID_SESSION) ?? read<KidLogin>(local, KID_LOGIN);

/** A child signed in on their own with the family code: no grown-up is signed in on this device. */
export interface KidLogin extends KidSession {
  code: string; // the family login code, to sign in again
  snapshot: Snapshot; // just enough family for the kid screens
}

/** The child's own sign-in, even when it has run out (so the app can ask for the PIN again). */
export function getKidLogin(): KidLogin | null {
  try {
    const raw = localStorage.getItem(KID_LOGIN);
    return raw ? (JSON.parse(raw) as KidLogin) : null;
  } catch {
    return null;
  }
}

/** Keeps a child's own sign-in on their device (family code and kid token), which lasts its 8 hours. */
export const saveKidLogin = (login: KidLogin) => write(local, KID_LOGIN, login);
/** Forgets a child's own sign-in. */
export const clearKidLogin = () => write(local, KID_LOGIN, null);

/** Keeps this tab's kid token and which child it is for, when a grown-up starts kid mode. */
export function saveKidSession(token: string, expiresInSeconds: number, childId: string, childName: string): void {
  write(session, KID_SESSION, { token, expiresAt: Date.now() + expiresInSeconds * 1000, childId, childName });
}

/** Forgets this tab's kid token. */
export const clearKidSession = () => write(session, KID_SESSION, null);

/** Marks this tab's kid session as run out (the server refused it). */
export function expireKidSession(): void {
  const raw = readRaw();
  if (raw) write(session, KID_SESSION, { ...raw, expiresAt: 0 });
  const login = getKidLogin();
  if (login) saveKidLogin({ ...login, expiresAt: 0 });
}

/** True when this tab had a kid session and it ran out, as opposed to never having one. */
export function kidSessionLapsed(): boolean {
  const raw = readRaw() ?? getKidLogin();
  return !!raw && raw.expiresAt <= Date.now();
}

function readRaw(): KidSession | null {
  try {
    const raw = sessionStorage.getItem(KID_SESSION);
    return raw ? (JSON.parse(raw) as KidSession) : null;
  } catch {
    return null;
  }
}

// ── Kid mode ──────────────────────────────────────────────────────────────────

/** Kid mode is per tab, or lasts while a child is signed in on their own: grown-up pages are locked. */
export function getKidMode(): boolean {
  if (getKidLogin()) return true;
  try {
    return sessionStorage.getItem(KID_MODE) === "1";
  } catch {
    return false;
  }
}

/** Turning kid mode off also ends the kid session in this tab. */
export function setKidMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KID_MODE, "1");
    else sessionStorage.removeItem(KID_MODE);
  } catch {
    /* ignore */
  }
  if (!on) clearKidSession();
}

// ── Habit coach ───────────────────────────────────────────────────────────────

interface CoachFresh {
  signIn: number; // the caregiver token's expiry identifies the sign-in
  children: string[];
}

/** True when this child's coach chat was already started fresh in the current sign-in. */
export function coachFreshThisSignIn(childId: string): boolean {
  const signIn = getCaregiverToken()?.expiresAt;
  if (!signIn) return false;
  try {
    const raw = localStorage.getItem(COACH_FRESH);
    const fresh = raw ? (JSON.parse(raw) as CoachFresh) : null;
    return fresh?.signIn === signIn && fresh.children.includes(childId);
  } catch {
    return false;
  }
}

/**
 * Records that this child's coach chat was started fresh in the current sign-in (see coachFreshThisSignIn).
 */
export function markCoachFresh(childId: string): void {
  const signIn = getCaregiverToken()?.expiresAt;
  if (!signIn) return;
  try {
    const raw = localStorage.getItem(COACH_FRESH);
    const fresh = raw ? (JSON.parse(raw) as CoachFresh) : null;
    const children = fresh?.signIn === signIn ? fresh.children : [];
    write(local, COACH_FRESH, { signIn, children: [...new Set([...children, childId])] });
  } catch {
    /* ignore */
  }
}
