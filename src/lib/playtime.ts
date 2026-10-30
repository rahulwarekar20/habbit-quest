/**
 * Kid-mode time limit: a parent picks how many minutes a day each child may spend in the app.
 * Kid mode counts the time while it's on screen; when time is up the child sees a break
 * screen, and only a parent (with the PIN) can add more minutes for that day.
 */
import { updateChild, type Child, type Family } from "./family";
import { lastDays } from "./time";

export const APP_LIMIT_OPTIONS = [0, 15, 20, 30, 45, 60]; // 0 = no limit
export const WARN_SECONDS = 120;

export function setAppLimit(family: Family, minutes: number): Family {
  return { ...family, settings: { ...family.settings, appLimit: Math.max(0, Math.round(minutes)) } };
}

/** Adds seconds of kid-mode use for a day, keeping two weeks of history. */
export function addAppTime(family: Family, childId: string, day: string, seconds: number): Family {
  const keep = new Set(lastDays(14));
  keep.add(day);
  return updateChild(family, childId, (c) => ({
    ...c,
    appSeconds: Object.fromEntries(
      Object.entries({ ...c.appSeconds, [day]: (c.appSeconds[day] ?? 0) + seconds }).filter(([d]) => keep.has(d))
    ),
  }));
}

export const appUsedSeconds = (child: Child, day: string) => child.appSeconds[day] ?? 0;

/** Today's allowance in minutes (limit plus any parent extension), or null when there is no limit. */
export function appAllowance(family: Family, child: Child, day: string): number | null {
  if (!family.settings.appLimit) return null;
  return family.settings.appLimit + (child.appExtraMinutes[day] ?? 0);
}

/** Seconds left today, or null when there is no limit. Never below 0. */
export function appSecondsLeft(family: Family, child: Child, day: string): number | null {
  const allowance = appAllowance(family, child, day);
  return allowance === null ? null : Math.max(0, allowance * 60 - appUsedSeconds(child, day));
}

/** Parent grants extra minutes for today (PIN-checked by the caller). */
export function extendAppTime(family: Family, childId: string, day: string, minutes: number): Family {
  return updateChild(family, childId, (c) => ({
    ...c,
    appExtraMinutes: { ...c.appExtraMinutes, [day]: (c.appExtraMinutes[day] ?? 0) + minutes },
  }));
}
