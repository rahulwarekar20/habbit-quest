/**
 * Browser persistence. Reads and writes never throw, so blocked storage just means a fresh start.
 *
 *   localStorage    the caregiver token, a snapshot of the account (so kid mode survives a reload
 *                   after the caregiver token runs out) and the browser-only extras per family
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

export interface Snapshot {
  me: Me;
  server: ApiFamily;
  children: ApiChild[];
}

export interface Saved {
  families: Record<string, Family>; // browser-only extras by backend family id
  snapshot: Snapshot | null;
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { families: {}, snapshot: null, ...JSON.parse(raw) };
  } catch {
    /* unreadable: start fresh */
  }
  return { families: {}, snapshot: null };
}

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

export function saveCaregiverToken(token: string, expiresInSeconds: number): void {
  write(local, CAREGIVER_TOKEN, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

export const clearCaregiverToken = () => write(local, CAREGIVER_TOKEN, null);

/** This tab's kid token, or null when there is none or it has expired. */
export const getKidSession = () => read<KidSession>(session, KID_SESSION);

export function saveKidSession(token: string, expiresInSeconds: number, childId: string, childName: string): void {
  write(session, KID_SESSION, { token, expiresAt: Date.now() + expiresInSeconds * 1000, childId, childName });
}

export const clearKidSession = () => write(session, KID_SESSION, null);

/** Marks this tab's kid session as run out (the server refused it). */
export function expireKidSession(): void {
  const raw = readRaw();
  if (raw) write(session, KID_SESSION, { ...raw, expiresAt: 0 });
}

/** True when this tab had a kid session and it ran out, as opposed to never having one. */
export function kidSessionLapsed(): boolean {
  const raw = readRaw();
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

/** Kid mode is per tab: while it is on, grown-up pages need the parent PIN. */
export function getKidMode(): boolean {
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
