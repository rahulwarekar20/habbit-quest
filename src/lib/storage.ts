/**
 * Browser persistence for the prototype: every family account lives in localStorage
 * under one key. Reads and writes never throw, so blocked storage just means a fresh start.
 */
import type { Family } from "./family";

const KEY = "habbit-quest.v1";

export interface Saved {
  families: Record<string, Family>; // by lower-case email
  session: string | null; // signed-in email
}

export function loadSaved(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { families: {}, session: null, ...JSON.parse(raw) };
  } catch {
    /* unreadable: start fresh */
  }
  return { families: {}, session: null };
}

export function persist(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

/** Kid mode is per tab: while it is on, grown-up pages need the parent PIN. */
const KID_MODE = "habbit-quest.kidMode";

export function getKidMode(): boolean {
  try {
    return sessionStorage.getItem(KID_MODE) === "1";
  } catch {
    return false;
  }
}

export function setKidMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KID_MODE, "1");
    else sessionStorage.removeItem(KID_MODE);
  } catch {
    /* ignore */
  }
}
