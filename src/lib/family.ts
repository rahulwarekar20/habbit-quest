/**
 * Family data model and pure state transitions.
 *
 * Flow: a parent chooses routine habits (shared by every child) and can add bonus quests per
 * child -> the child submits ("I did it!") -> the parent approves -> the child earns one Spark
 * and some points for that quest that day.
 *
 *   Sparks  are lifetime progress: they raise the child's level (unlocking harder quest tiers)
 *           and unlock worlds. They are never taken away.
 *   Points  are the spendable currency for the reward shop (rewards.ts). A quest's points are
 *           its tier value times a multiplier: 1x normally, +1x for the day's golden quest,
 *           +1x on a 3-day streak, +1x on a parent's surprise double-points day (max 3x).
 *
 * Every function returns a new Family and never mutates its input, so the UI can store
 * the result directly and the rules are easy to test.
 */
import type { AiState } from "./agents";
import type { Feedback } from "./feedback";
import { HABITS, QUEST_BY_ID, fitsAge, type HabitId, type QuestDef, type Tier } from "./habits";
import type { Redemption, RewardItem, Surprise } from "./rewards";
import type { SafetyEvent } from "./guardrails";
import { formatMinutes, formatTime, lastDays } from "./time";

export type QuestStatus = "todo" | "submitted" | "approved" | "notyet";
export type BuddyId = "fox" | "owl" | "bear" | "bunny";

export interface HabitSetting {
  enabled: boolean;
  value?: string; // "07:00" for a time, "60" for minutes
}
export type HabitSettings = Record<HabitId, HabitSetting>;

export interface LedgerEntry {
  at: string; // ISO time
  day: string;
  points: number; // positive = earned, negative = spent
  label: string;
  kind: "earn" | "bonus" | "spend" | "refund";
  quest?: string; // the quest that earned it
}

export interface Child {
  id: string;
  name: string;
  age: number;
  buddy: BuddyId;
  sparks: number;
  celebrated: string[]; // "<day>:<quest>" keys the child has already seen celebrated
  discoveries: string[]; // "<world>:<item>" keys found while exploring
  points: number; // spendable balance
  pointsEarned: number; // lifetime points earned
  ledger: LedgerEntry[]; // most recent last, trimmed
  bonusQuests: string[]; // library quest ids for this child
  levelSeen: number; // highest level the child has seen celebrated
  accessories: string[]; // buddy accessories collected
  wearing: string | null;
  goal: string | null; // reward id the child is saving for
  chests: string[]; // days the mystery chest was opened
  appSeconds: Record<string, number>; // day -> seconds spent in kid mode
  appExtraMinutes: Record<string, number>; // day -> extra minutes a parent allowed
  screenBonus: Record<string, number>; // day -> extra screen-time minutes won in the shop
}

/** day -> child id -> quest id -> status */
export type QuestLog = Record<string, Record<string, Record<string, QuestStatus>>>;

export interface FamilySettings {
  /** Daily kid-mode time limit per child in minutes; 0 means no limit. */
  appLimit: number;
}

export interface Family {
  email: string;
  parentName: string;
  passwordHash: string;
  pinHash: string;
  children: Child[];
  habits: HabitSettings;
  habitsChosen: boolean;
  log: QuestLog;
  createdAt: string;
  settings: FamilySettings;
  rewards: RewardItem[];
  redemptions: Redemption[];
  feedback: Feedback[];
  surprises: Surprise[];
  doubleDays: string[]; // days with double points (a parent surprise)
  safety: SafetyEvent[];
  ai?: AiState; // agent proposals, reviews and chat (see agents.ts)
}

// ── Worlds ────────────────────────────────────────────────────────────────────

export type WorldId = "camp" | "mosswood" | "sky";

export interface World {
  id: WorldId;
  name: string;
  sparks: number; // lifetime Sparks needed to unlock
  blurb: string;
  discoveries: { id: string; name: string; x: number; y: number }[]; // x/y in % of the scene
}

export const WORLDS: World[] = [
  {
    id: "camp", name: "Starter Camp", sparks: 0, blurb: "A cosy campfire where every adventure begins.",
    discoveries: [
      { id: "lantern", name: "Glowing lantern", x: 20, y: 62 },
      { id: "owl", name: "Sleepy owl", x: 80, y: 30 },
      { id: "map", name: "Treasure map", x: 60, y: 82 },
    ],
  },
  {
    id: "mosswood", name: "Mosswood Forest", sparks: 5, blurb: "Giant trees, glowing mushrooms and a hidden portal.",
    discoveries: [
      { id: "mushroom", name: "Glow mushroom", x: 18, y: 80 },
      { id: "fox", name: "Friendly fox", x: 72, y: 78 },
      { id: "portal", name: "Purple portal", x: 50, y: 50 },
      { id: "nest", name: "Bird's nest", x: 86, y: 24 },
    ],
  },
  {
    id: "sky", name: "Sky Islands", sparks: 20, blurb: "Floating islands, waterfalls and a balloon airship.",
    discoveries: [
      { id: "balloon", name: "Balloon airship", x: 80, y: 22 },
      { id: "waterfall", name: "Cloud waterfall", x: 28, y: 66 },
      { id: "castle", name: "Tiny castle", x: 52, y: 36 },
      { id: "kite", name: "Rainbow kite", x: 14, y: 20 },
    ],
  },
];

export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w])) as Record<WorldId, World>;

export const isUnlocked = (world: World, sparks: number) => sparks >= world.sparks;

/** The next locked world, or null when everything is open. */
export function nextWorld(sparks: number): World | null {
  return WORLDS.find((w) => !isUnlocked(w, sparks)) ?? null;
}

// ── Levels (unlock harder quest tiers) ────────────────────────────────────────

export interface Level {
  level: number;
  name: string;
  sparks: number; // lifetime Sparks needed
  tier: Tier; // highest quest tier unlocked at this level
}

export const LEVELS: Level[] = [
  { level: 1, name: "Sprout", sparks: 0, tier: 1 },
  { level: 2, name: "Explorer", sparks: 5, tier: 2 },
  { level: 3, name: "Adventurer", sparks: 15, tier: 3 },
  { level: 4, name: "Hero", sparks: 30, tier: 3 },
  { level: 5, name: "Legend", sparks: 50, tier: 3 },
];

export function levelOf(sparks: number): Level {
  return [...LEVELS].reverse().find((l) => sparks >= l.sparks) ?? LEVELS[0];
}

export function nextLevel(sparks: number): Level | null {
  return LEVELS.find((l) => l.sparks > sparks) ?? null;
}

/** The level at which a quest tier unlocks. */
export const levelForTier = (tier: Tier): Level => LEVELS.find((l) => l.tier >= tier)!;

// ── Creating things ───────────────────────────────────────────────────────────

const DEFAULT_ON: HabitId[] = ["wake", "homework", "bedtime"];

export function defaultHabits(): HabitSettings {
  return Object.fromEntries(
    HABITS.map((h) => [
      h.id,
      { enabled: DEFAULT_ON.includes(h.id), value: h.setting.kind === "none" ? undefined : h.setting.default },
    ])
  ) as HabitSettings;
}

const CHILD_DEFAULTS: Omit<Child, "id" | "name" | "age" | "buddy"> = {
  sparks: 0, celebrated: [], discoveries: [], points: 0, pointsEarned: 0, ledger: [], bonusQuests: [], levelSeen: 1,
  accessories: [], wearing: null, goal: null, chests: [], appSeconds: {}, appExtraMinutes: {}, screenBonus: {},
};

export function newChild(name: string, age: number, buddy: BuddyId): Child {
  return {
    ...structuredClone(CHILD_DEFAULTS),
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    age,
    buddy,
  };
}

/** Child fields added after the first release, for filling in older saved data (see migrate.ts). */
export function childDefaults(): Omit<Child, "id" | "name" | "age" | "buddy"> {
  return structuredClone(CHILD_DEFAULTS);
}

export function addChild(family: Family, child: Child): Family {
  return { ...family, children: [...family.children, child] };
}

export function setHabits(family: Family, habits: HabitSettings): Family {
  return { ...family, habits, habitsChosen: true };
}

export function updateChild(family: Family, childId: string, fn: (c: Child) => Child): Family {
  return { ...family, children: family.children.map((c) => (c.id === childId ? fn(c) : c)) };
}

/** Adds (or with negative points, removes) points with a ledger line. Balance never goes below 0. */
export function creditPoints(child: Child, points: number, label: string, kind: LedgerEntry["kind"], day: string, now = new Date(), quest?: string): Child {
  const applied = Math.max(points, -child.points);
  return {
    ...child,
    points: child.points + applied,
    pointsEarned: child.pointsEarned + (applied > 0 && kind !== "refund" ? applied : 0),
    ledger: [...child.ledger, { at: now.toISOString(), day, points: applied, label, kind, ...(quest ? { quest } : {}) }].slice(-60),
  };
}

// ── Quests ────────────────────────────────────────────────────────────────────

/** Enabled routine habits in day order (shared by every child). */
export function activeQuests(family: Family): QuestDef[] {
  return HABITS.filter((h) => family.habits[h.id]?.enabled);
}

/** A child's quests for the day: the family routine, then their own bonus quests. */
export function questsFor(family: Family, childId: string): QuestDef[] {
  const child = family.children.find((c) => c.id === childId);
  if (!child) return [];
  return [...activeQuests(family), ...child.bonusQuests.map((id) => QUEST_BY_ID[id]).filter((q): q is QuestDef => !!q && !q.routine)];
}

export const MAX_BONUS_QUESTS = 4;

/** Why a bonus quest can't be added for this child, or null when it can. `ignoreCap` skips the 4-quest limit. */
export function bonusQuestBlocker(family: Family, childId: string, questId: string, ignoreCap = false): string | null {
  const child = family.children.find((c) => c.id === childId);
  const quest = QUEST_BY_ID[questId];
  if (!child) return "Unknown child.";
  if (!quest || quest.routine) return "That isn't a bonus quest.";
  if (child.bonusQuests.includes(questId)) return `${child.name} already has this quest.`;
  if (!fitsAge(quest, child.age)) return `Made for ages ${quest.ages[0]}-${quest.ages[1]}.`;
  const level = levelOf(child.sparks);
  if (quest.tier > level.tier) return `Unlocks when ${child.name} reaches level ${levelForTier(quest.tier).level} (${levelForTier(quest.tier).name}).`;
  if (!ignoreCap && child.bonusQuests.length >= MAX_BONUS_QUESTS) return `${child.name} already has ${MAX_BONUS_QUESTS} bonus quests. Remove one first.`;
  return null;
}

export function addBonusQuest(family: Family, childId: string, questId: string): Family {
  if (bonusQuestBlocker(family, childId, questId)) return family;
  return updateChild(family, childId, (c) => ({ ...c, bonusQuests: [...c.bonusQuests, questId] }));
}

export function removeBonusQuest(family: Family, childId: string, questId: string): Family {
  return updateChild(family, childId, (c) => ({ ...c, bonusQuests: c.bonusQuests.filter((q) => q !== questId) }));
}

export function statusOf(family: Family, day: string, childId: string, quest: string): QuestStatus {
  return family.log[day]?.[childId]?.[quest] ?? "todo";
}

function withStatus(family: Family, day: string, childId: string, quest: string, status: QuestStatus): Family {
  const dayLog = family.log[day] ?? {};
  return {
    ...family,
    log: { ...family.log, [day]: { ...dayLog, [childId]: { ...(dayLog[childId] ?? {}), [quest]: status } } },
  };
}

/** Child taps "I did it!". Approved quests stay approved. */
export function submitQuest(family: Family, day: string, childId: string, quest: string): Family {
  if (statusOf(family, day, childId, quest) === "approved") return family;
  return withStatus(family, day, childId, quest, "submitted");
}

// ── Points, streaks and the golden quest ──────────────────────────────────────

export const TIER_POINTS: Record<Tier, number> = { 1: 10, 2: 15, 3: 20 };
export const MAX_MULTIPLIER = 3;
export const STREAK_DAYS = 3;

export function approvedCount(family: Family, day: string, childId: string): number {
  return Object.values(family.log[day]?.[childId] ?? {}).filter((s) => s === "approved").length;
}

/** Days in a row ending exactly on `day` with at least one approved quest. */
function runEnding(family: Family, childId: string, day: string): number {
  const days = lastDays(60, dateOf(day)).reverse();
  let run = 0;
  while (run < days.length && approvedCount(family, days[run], childId) > 0) run++;
  return run;
}

/** The current streak: days in a row ending today, or yesterday if nothing is approved yet today. */
export function streakOf(family: Family, childId: string, day: string): number {
  return approvedCount(family, day, childId) > 0 ? runEnding(family, childId, day) : runEnding(family, childId, yesterday(day));
}

const yesterday = (day: string) => lastDays(2, dateOf(day))[0];

function dateOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Today's golden quest for a child (worth an extra 1x), picked fresh each day. */
export function goldenQuest(family: Family, day: string, childId: string): string | null {
  const quests = questsFor(family, childId);
  return quests.length ? quests[hash(`${day}:${childId}`) % quests.length].id : null;
}

export type BoostReason = "golden" | "streak" | "double";
export const BOOST_LABEL: Record<BoostReason, string> = {
  golden: "Golden quest", streak: `${STREAK_DAYS}-day streak`, double: "Surprise double day",
};

/** The multiplier a quest would earn if approved now (1x-3x) and why. */
export function boostFor(family: Family, day: string, childId: string, quest: string): { multiplier: number; reasons: BoostReason[] } {
  const reasons: BoostReason[] = [];
  if (goldenQuest(family, day, childId) === quest) reasons.push("golden");
  // Today is day 3+ of a streak when the days before it already form a run of 2+.
  if (runEnding(family, childId, yesterday(day)) >= STREAK_DAYS - 1) reasons.push("streak");
  if (family.doubleDays.includes(day)) reasons.push("double");
  return { multiplier: Math.min(MAX_MULTIPLIER, 1 + reasons.length), reasons };
}

export function pointsFor(family: Family, day: string, childId: string, quest: string): number {
  const tier = QUEST_BY_ID[quest]?.tier ?? 1;
  return TIER_POINTS[tier] * boostFor(family, day, childId, quest).multiplier;
}

/** Parent approves a submitted quest: +1 Spark and points, once per quest per day. */
export function approveQuest(family: Family, day: string, childId: string, quest: string, now = new Date()): Family {
  if (statusOf(family, day, childId, quest) !== "submitted") return family;
  const points = pointsFor(family, day, childId, quest);
  const { multiplier } = boostFor(family, day, childId, quest);
  const title = QUEST_BY_ID[quest]?.kidTitle ?? quest;
  const updated = withStatus(family, day, childId, quest, "approved");
  return updateChild(updated, childId, (c) =>
    creditPoints({ ...c, sparks: c.sparks + 1 }, points, `${title}${multiplier > 1 ? ` (${multiplier}x)` : ""}`, "earn", day, now, quest)
  );
}

/** Parent says "not yet": the child can try again and resubmit. */
export function declineQuest(family: Family, day: string, childId: string, quest: string): Family {
  if (statusOf(family, day, childId, quest) !== "submitted") return family;
  return withStatus(family, day, childId, quest, "notyet");
}

export interface PendingApproval {
  child: Child;
  habit: QuestDef;
}

export function pendingApprovals(family: Family, day: string): PendingApproval[] {
  return family.children.flatMap((child) =>
    questsFor(family, child.id)
      .filter((habit) => statusOf(family, day, child.id, habit.id) === "submitted")
      .map((habit) => ({ child, habit }))
  );
}

/** Approved quests the child hasn't seen celebrated yet. */
export function celebrationsDue(family: Family, day: string, childId: string): QuestDef[] {
  const child = family.children.find((c) => c.id === childId);
  if (!child) return [];
  return questsFor(family, childId).filter(
    (h) => statusOf(family, day, childId, h.id) === "approved" && !child.celebrated.includes(`${day}:${h.id}`)
  );
}

export function markCelebrated(family: Family, day: string, childId: string, quests: string[]): Family {
  return updateChild(family, childId, (c) => ({
    ...c,
    celebrated: [...new Set([...c.celebrated, ...quests.map((h) => `${day}:${h}`)])],
    levelSeen: Math.max(c.levelSeen, levelOf(c.sparks).level),
  }));
}

/** Every quest for the day approved (and there was at least one). */
/** Points a child earned today for these quests (for the celebration). */
export function pointsEarnedFor(child: Child, day: string, quests: string[]): number {
  return child.ledger.filter((e) => e.day === day && e.kind === "earn" && e.quest && quests.includes(e.quest)).reduce((n, e) => n + e.points, 0);
}

export function allDone(family: Family, day: string, childId: string): boolean {
  const quests = questsFor(family, childId);
  return quests.length > 0 && quests.every((q) => statusOf(family, day, childId, q.id) === "approved");
}

/** Records a discovery found while exploring a world (once). */
export function discover(family: Family, childId: string, key: string): Family {
  return updateChild(family, childId, (c) => (c.discoveries.includes(key) ? c : { ...c, discoveries: [...c.discoveries, key] }));
}

/** When a quest is due, for labels: "by 7:00 AM", "max 1 hour", or null for no time. */
export function questWhen(family: Family, habit: QuestDef, child?: Child, day?: string): string | null {
  if (!habit.routine) return null;
  const value = family.habits[habit.id as HabitId]?.value;
  if (habit.setting.kind === "time" && value) return `by ${formatTime(value)}`;
  if (habit.setting.kind === "minutes" && value) {
    const bonus = child && day ? child.screenBonus[day] ?? 0 : 0;
    return `max ${formatMinutes(Number(value) + bonus)}${bonus ? " (bonus!)" : ""}`;
  }
  return null;
}
