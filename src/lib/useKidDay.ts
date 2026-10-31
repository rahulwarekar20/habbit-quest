/**
 * The kid screens' link to the backend. Starts a kid session for the child with the caregiver
 * token when this tab has none, then reads today with the kid token and mirrors it locally.
 * When a kid session runs out, a grown-up restarts it with the parent PIN (`resume`).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, errorText, getKidToday, startKidSession, submitCompletion, type Today, type TodayHabit } from "./api";
import { getKidSession, kidSessionLapsed, saveKidSession } from "./storage";
import { useStore } from "./store";
import { applyToday } from "./sync";

const POLL_MS = 30_000;

export function useKidDay(childId: string, poll = false) {
  const { update, askPin, enterKidMode } = useStore();
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lapsed, setLapsed] = useState(false);

  const accept = useCallback((day: Today) => {
    setToday(day);
    setError(null);
    update((f) => applyToday(f, day));
  }, [update]);

  const start = useCallback(async () => {
    const session = await startKidSession(childId);
    saveKidSession(session.access_token, session.expires_in, childId, session.child.name);
  }, [childId]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setLapsed(true);
    else setError(errorText(e));
  }, []);

  const load = useCallback(async () => {
    try {
      if (kidSessionLapsed()) return setLapsed(true);
      if (getKidSession()?.childId !== childId) await start();
      accept(await getKidToday());
    } catch (e) {
      fail(e);
    }
  }, [accept, childId, fail, start]);

  useEffect(() => {
    setToday(null);
    void load();
    if (!poll) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && !kidSessionLapsed()) void load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, poll]);

  /** "I did it!". Returns true when it went through. */
  const submit = useCallback(async (habit: TodayHabit) => {
    try {
      accept(await submitCompletion(habit.child_habit_id));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) void load(); // a grown-up already approved it
      else fail(e);
      return false;
    }
  }, [accept, fail, load]);

  const resume = useCallback(async () => {
    if (!(await askPin("Kid mode timed out. Start it again."))) return;
    enterKidMode(); // the child has the device again, so this PIN shouldn't linger
    try {
      await start();
      setLapsed(false);
      accept(await getKidToday());
    } catch (e) {
      fail(e);
    }
  }, [accept, askPin, enterKidMode, fail, start]);

  return { today, error, lapsed, reload: load, submit, resume };
}
