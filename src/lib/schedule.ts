/** Which days a quest runs on: the parent's quick choices, and how they read in the app. */
import type { DayName } from "./api";

export const WEEK: { id: DayName; short: string }[] = [
  { id: "mon", short: "Mon" }, { id: "tue", short: "Tue" }, { id: "wed", short: "Wed" }, { id: "thu", short: "Thu" },
  { id: "fri", short: "Fri" }, { id: "sat", short: "Sat" }, { id: "sun", short: "Sun" },
];

const SCHOOL_DAYS: DayName[] = ["mon", "tue", "wed", "thu", "fri"];
const WEEKEND: DayName[] = ["sat", "sun"];

export const DAY_PRESETS: { label: string; days: DayName[] }[] = [
  { label: "Every day", days: WEEK.map((d) => d.id) },
  { label: "School days", days: SCHOOL_DAYS },
  { label: "Weekends", days: WEEKEND },
];

const sameDays = (a: DayName[], b: DayName[]) => a.length === b.length && a.every((d) => b.includes(d));

export const presetFor = (days: DayName[]) => DAY_PRESETS.find((p) => sameDays(p.days, days))?.label ?? null;

/** Turns one day on or off, in week order. A quest always keeps at least one day. */
export function toggleDay(days: DayName[], day: DayName): DayName[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return next.length ? WEEK.map((d) => d.id).filter((d) => next.includes(d)) : days;
}

/** "Saturday" for a "YYYY-MM-DD" day, read as a calendar date in any time zone. */
export function weekdayName(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
}
