/**
 * Mirrors the backend's data into the browser-side family, which the pages read from. The mirror
 * is overwritten on every fetch: the backend always wins.
 */
import type { Extras, HabitStatus, Progress, Today } from "./api";
import { updateChild, type Family, type QuestStatus } from "./family";

const LOCAL_STATUS: Record<HabitStatus, QuestStatus> = { todo: "todo", submitted: "submitted", approved: "approved", rejected: "notyet" };

export const localStatus = (status: HabitStatus): QuestStatus => LOCAL_STATUS[status];

export function applyToday(family: Family, today: Today): Family {
  const childId = today.child.id;
  const statuses = Object.fromEntries(today.habits.map((h) => [h.habit_id, localStatus(h.status)]));
  const next = updateChild(family, childId, (c) => ({
    ...c,
    buddy: today.child.buddy,
    sparks: today.progress.sparks,
    progress: today.progress,
    balance: today.points,
    plan: today.habits.map((h) => ({ id: h.habit_id, kidTitle: h.kid_title, kidHint: h.kid_hint, tier: h.tier })),
    streak: today.streak,
    week: today.week,
  }));
  return { ...next, log: { ...next.log, [today.day]: { ...next.log[today.day], [childId]: statuses } } };
}

export function applyProgress(family: Family, childId: string, progress: Progress, points: number): Family {
  return updateChild(family, childId, (c) => ({ ...c, sparks: progress.sparks, progress, balance: points }));
}

export function applyExtras(family: Family, childId: string, extras: Extras): Family {
  const next = updateChild(family, childId, (c) => ({
    ...c,
    discoveries: extras.discoveries,
    accessories: extras.accessories,
    wearing: extras.wearing,
    goal: extras.goal,
    chests: extras.chests,
    levelSeen: Math.max(c.levelSeen, extras.level_seen),
    appSeconds: extras.app_seconds,
    appExtraMinutes: extras.app_extra_minutes,
    screenBonus: extras.screen_bonus,
  }));
  return { ...next, settings: { appLimit: extras.app_limit, buddyTalk: extras.buddy_talk } };
}