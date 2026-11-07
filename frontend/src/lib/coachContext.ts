/** Private, account-scoped coach history in memory only; never persisted to browser storage. */
import { getCoachContext, resetCoachThread, type CoachThread } from "./api";
import { markCoachFresh } from "./storage";

let owner = "";
let epoch = 0;
const threads = new Map<string, { thread: CoachThread; loaded: number }>();
const resets = new Map<string, Promise<void>>();
const FRESH_MS = 30_000;

export function clearCoachContext() {
  owner = "";
  epoch += 1;
  threads.clear();
  resets.clear();
}

/** An account change invalidates every in-flight preload before it can restore old history. */
export function setCoachContextOwner(userId: string) {
  if (owner !== userId) {
    clearCoachContext();
    owner = userId;
  }
}

export function cachedCoachThread(childId: string): CoachThread | undefined {
  const cached = threads.get(childId);
  return cached && Date.now() - cached.loaded < FRESH_MS ? cached.thread : undefined;
}

export function rememberCoachThread(childId: string, thread: CoachThread) {
  threads.set(childId, { thread, loaded: Date.now() });
}

/** A preload cannot overwrite a child already loaded, reset or updated during the request. */
export async function preloadCoachContext(familyId: string) {
  const started = epoch;
  const result = await getCoachContext(familyId);
  if (started !== epoch || !owner) return;
  for (const [childId, thread] of Object.entries(result.children)) {
    if (!threads.has(childId)) rememberCoachThread(childId, thread);
  }
}

/** Share first-open reset work across StrictMode effects and component remounts. */
export function freshCoachThread(childId: string): Promise<void> {
  const existing = resets.get(childId);
  if (existing) return existing;
  const started = epoch;
  rememberCoachThread(childId, { messages: [], suggestions: [] });
  const pending = resetCoachThread(childId).then(() => {
    if (started === epoch) markCoachFresh(childId);
  }).finally(() => {
    if (resets.get(childId) === pending) resets.delete(childId);
  });
  resets.set(childId, pending);
  return pending;
}
