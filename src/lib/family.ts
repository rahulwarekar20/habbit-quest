/**
 * Browser-side family model: a mirror of what the backend owns (see sync.ts), which the pages read
 * from, plus level and world definitions and which celebrations this device has shown.
 *
 *   Sparks  are lifetime progress: they raise the child's level (unlocking harder quest tiers)
 *           and unlock worlds. They are never taken away.
 *   Points  are the spendable currency for the reward shop. The backend pays a quest's tier value
 *           times a multiplier: 1x normally, +1x for the day's golden quest, +1x on a 3-day streak,
 *           +1x on a parent's surprise double-points day (max 3x).
 *
 * Every function returns a new Family and never mutates its input.
 */
import type { Boost } from "./api";
import { HABITS, QUEST_BY_ID, type HabitId, type QuestDef, type Tier } from "./habits";

export type QuestStatus = "todo" | "submitted" | "approved" | "notyet";
export type BuddyId = "fox" | "owl" | "bear" | "bunny";

export interface HabitSetting {
  enabled: boolean;
  value?: string; // "07:00" for a time, "60" for minutes
}
export type HabitSettings = Record<HabitId, HabitSetting>;

export interface Child {
  id: string;
  name: string;
  age: number;
  buddy: BuddyId;
  sparks: number; // mirrored from the backend
  balance: number; // spendable points on the backend (mirrored); only a parent can spend them
  plan?: PlanQuest[]; // today's quests from the backend (mirrored); absent means the family routine applies
  celebrated: string[]; // "<day>:<quest>" keys the child has already seen celebrated
  discoveries: string[]; // "<world>:<item>" keys found while exploring
  streak: number; // days in a row, from the backend
  week: Record<string, number>; // day -> approved quests, from the backend
  levelSeen: number; // highest level the child has seen celebrated
  accessories: string[]; // buddy accessories collected
  wearing: string | null;
  goal: string | null; // reward id the child is saving for
  chests: string[]; // days the mystery chest was opened
  appSeconds: Record<string, number>; // day -> seconds spent in kid mode
  appExtraMinutes: Record<string, number>; // day -> extra minutes a parent allowed
  screenBonus: Record<string, number>; // day -> extra screen-time minutes won in the shop
}

/** One of today's quests as the backend names it. */
export interface PlanQuest {
  id: string;
  kidTitle: string;
  kidHint: string;
  tier: number;
}

/** day -> child id -> quest id -> status */
export type QuestLog = Record<string, Record<string, Record<string, QuestStatus>>>;

export interface FamilySettings {
  /** Daily kid-mode time limit per child in minutes; 0 means no limit. */
  appLimit: number;
  /** Whether the kid's buddy may speak AI-written lines. Parents can turn this off. */
  buddyTalk: boolean;
}

export interface Family {
  email: string;
  parentName: string;
  children: Child[];
  habits: HabitSettings;
  habitsChosen: boolean;
  log: QuestLog;
  createdAt: string;
  settings: FamilySettings;
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
  sparks: 0, balance: 0, celebrated: [], discoveries: [], streak: 0, week: {}, levelSeen: 1,
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

export function updateChild(family: Family, childId: string, fn: (c: Child) => Child): Family {
  return { ...family, children: family.children.map((c) => (c.id === childId ? fn(c) : c)) };
}

// ── Quests ────────────────────────────────────────────────────────────────────

/** A child's quests for the day, as the backend last sent them. */
export function questsFor(family: Family, childId: string): QuestDef[] {
  return family.children.find((c) => c.id === childId)?.plan?.map(planQuestDef) ?? [];
}

/** A backend quest as a QuestDef: the library's entry when there is one, in the backend's words. */
function planQuestDef(q: PlanQuest): QuestDef {
  const known = QUEST_BY_ID[q.id];
  const base: QuestDef = known ?? {
    id: q.id, parentTitle: q.kidTitle, description: q.kidHint, kidTitle: q.kidTitle, kidHint: q.kidHint,
    setting: { kind: "none" }, tier: q.tier as Tier, category: "routine", emoji: "⭐", ages: [3, 13], routine: false,
  };
  return { ...base, kidTitle: q.kidTitle, kidHint: q.kidHint };
}


export function statusOf(family: Family, day: string, childId: string, quest: string): QuestStatus {
  return family.log[day]?.[childId]?.[quest] ?? "todo";
}

export const BOOST_LABEL: Record<Boost, string> = {
  golden: "Golden quest", streak: "3-day streak", double: "Surprise double day",
};

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

/** Records a discovery found while exploring a world (once). */
export function discover(family: Family, childId: string, key: string): Family {
  return updateChild(family, childId, (c) => (c.discoveries.includes(key) ? c : { ...c, discoveries: [...c.discoveries, key] }));
}

