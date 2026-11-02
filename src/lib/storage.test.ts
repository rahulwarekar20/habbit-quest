/** Browser persistence: the habit coach starts fresh once per sign-in; a child's own sign-in. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearCaregiverToken, clearKidLogin, coachFreshThisSignIn, expireKidSession, getKidLogin, getKidMode, getKidSession,
  kidSessionLapsed, markCoachFresh, saveCaregiverToken, saveKidLogin, type Snapshot,
} from "./storage";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("remembers fresh coach chats until the next sign-in", () => {
  saveCaregiverToken("one", 3600);
  expect(coachFreshThisSignIn("c1")).toBe(false);
  markCoachFresh("c1");
  expect(coachFreshThisSignIn("c1")).toBe(true);
  expect(coachFreshThisSignIn("c2")).toBe(false);

  vi.advanceTimersByTime(1000);
  saveCaregiverToken("two", 3600);
  expect(coachFreshThisSignIn("c1")).toBe(false);
});

it("a child's own sign-in is kid mode until it runs out, then asks for the PIN again", () => {
  expect(getKidMode()).toBe(false);
  saveKidLogin({ token: "kid", expiresAt: Date.now() + 1000, childId: "c1", childName: "Alex", code: "ABCD2345", snapshot: {} as Snapshot });
  expect(getKidMode()).toBe(true);
  expect(getKidSession()?.token).toBe("kid");
  expect(kidSessionLapsed()).toBe(false);

  expireKidSession(); // the server refused the token
  expect(getKidSession()).toBeNull();
  expect(kidSessionLapsed()).toBe(true);
  expect(getKidLogin()?.code).toBe("ABCD2345"); // kept, so the child can sign in again

  clearKidLogin();
  expect(getKidMode()).toBe(false);
});

it("never counts as fresh when signed out", () => {
  clearCaregiverToken();
  markCoachFresh("c1");
  expect(coachFreshThisSignIn("c1")).toBe(false);
});
