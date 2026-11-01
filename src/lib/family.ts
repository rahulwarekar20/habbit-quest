/**
 * Browser-side family model: a mirror of what the backend owns (see sync.ts), which the pages read
 * from, plus the list of worlds and which celebrations this device has shown.
 *
 *   Sparks  are steps on the child's journey. A quest earns its tier in Sparks, up to 6 a day. Each
 *           world brings a new level and rank and may open harder quests. Sparks are never lost.
 *   Points  are the spendable currency for the reward shop. The backend pays a quest's tier value
 *           times a multiplier: 1x normally, +1x for the day's golden quest, +1x on a 3-day streak,
 *           +1x on a parent's surprise double-points day, +1x on the day back after a break (max 3x).
 *
 * Every function returns a new Family and never mutates its input.
 */
import type { Boost, Progress, ThemeWorld } from "./api";
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
  progress: Progress | null; // the journey as the backend last sent it
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

export type WorldId = ThemeWorld;

/** The summary shown before sign-in and to parents. The landmarks come from the backend (see Journey). */
export interface World {
  id: WorldId;
  name: string;
  sparks: number; // lifetime Sparks needed to unlock
  tier: Tier; // highest quest tier this world opens
  blurb: string;
}

export const WORLDS: World[] = [
  { id: "camp", name: "Starter Camp", sparks: 0, tier: 1, blurb: "A cosy campfire where every adventure begins." },
  { id: "mosswood", name: "Mosswood Forest", sparks: 30, tier: 2, blurb: "Giant trees, glowing mushrooms and a hidden portal." },
  { id: "sky", name: "Sky Islands", sparks: 90, tier: 3, blurb: "Floating islands, waterfalls and a balloon airship." },
  { id: "coral", name: "Coral Cove", sparks: 180, tier: 3, blurb: "Bright reefs, friendly turtles and a sunken ship." },
  { id: "crystal", name: "Crystal Caves", sparks: 300, tier: 3, blurb: "Glittering tunnels, gentle dragons and hidden gems." },
  { id: "star", name: "Star Harbour", sparks: 450, tier: 3, blurb: "A harbour in the night sky, with new trails to chart." },
];

export const isUnlocked = (world: World, sparks: number) => sparks >= world.sparks;

/** The next locked world, or null when everything is open. */
export function nextWorld(sparks: number): World | null {
  return WORLDS.find((w) => !isUnlocked(w, sparks)) ?? null;
}

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
  sparks: 0, progress: null, balance: 0, celebrated: [], discoveries: [], streak: 0, week: {}, levelSeen: 1,
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
  golden: "Golden quest", streak: "3-day streak", double: "Surprise double day", welcome: "Welcome back",
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
    levelSeen: Math.max(c.levelSeen, c.progress?.level ?? 1),
  }));
}

/** Records a discovery found while exploring a world (once). */
export function discover(family: Family, childId: string, key: string): Family {
  return updateChild(family, childId, (c) => (c.discoveries.includes(key) ? c : { ...c, discoveries: [...c.discoveries, key] }));
}

