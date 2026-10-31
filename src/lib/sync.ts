/**
 * Mirrors the backend's day into the browser-side family, so the local rules (streaks, the
 * treasure chest, celebrations, golden quests) keep working on real data. The mirror is
 * overwritten on every fetch: the backend always wins.
 */
import type { HabitStatus, Progress, Today } from "./api";
import { boostFor, creditPoints, updateChild, type Family, type QuestStatus } from "./family";

const LOCAL_STATUS: Record<HabitStatus, QuestStatus> = { todo: "todo", submitted: "submitted", approved: "approved", rejected: "notyet" };

export const localStatus = (status: HabitStatus): QuestStatus => LOCAL_STATUS[status];

export function applyToday(family: Family, today: Today): Family {
  const childId = today.child.id;
  const statuses = Object.fromEntries(today.habits.map((h) => [h.habit_id, localStatus(h.status)]));
  const next = updateChild(family, childId, (c) => ({
    ...c,
    sparks: today.progress.sparks,
    balance: today.points,
    plan: today.habits.map((h) => ({ id: h.habit_id, kidTitle: h.kid_title, kidHint: h.kid_hint, tier: h.tier })),
  }));
  return { ...next, log: { ...next.log, [today.day]: { ...next.log[today.day], [childId]: statuses } } };
}

export function applyProgress(family: Family, childId: string, progress: Progress, points: number): Family {
  return updateChild(family, childId, (c) => ({ ...c, sparks: progress.sparks, balance: points }));
}

/**
 * The backend pays base points only, so a boost (golden quest, streak, double day) is paid here
 * as bonus points when the child sees the approval. Returns the extra points for this quest.
 */
export function boostExtra(family: Family, day: string, childId: string, habitId: string, basePoints: number): number {
  return (boostFor(family, day, childId, habitId).multiplier - 1) * basePoints;
}

export function creditBoost(family: Family, day: string, childId: string, habitId: string, title: string, basePoints: number): Family {
  const extra = boostExtra(family, day, childId, habitId, basePoints);
  if (extra <= 0) return family;
  return updateChild(family, childId, (c) => creditPoints(c, extra, `${title} boost`, "bonus", day, new Date(), habitId));
}
