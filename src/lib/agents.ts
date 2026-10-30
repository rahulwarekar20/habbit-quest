/**
 * Shared between the browser and the agent server: what the agents are allowed to see
 * about a family, and the two kinds of change they may suggest:
 *   - a routine habit setting (HabitChange -> Proposal), and
 *   - a bonus quest from the library for one child (HabitRecommendation -> Recommendation).
 *
 * Agents never write to the family. They return suggestions; a parent approves them with
 * the PIN, and only then does the app apply them. Agents have no way to award or remove
 * Sparks or points.
 */
import { HABITS, HABIT_BY_ID, QUEST_BY_ID, type HabitId } from "./habits";
import {
  addBonusQuest, bonusQuestBlocker, levelOf, questsFor, setHabits, statusOf, type BuddyId, type Family, type QuestStatus,
} from "./family";
import { MOODS, STICKERS } from "./feedback";
import { formatMinutes, formatTime, lastDays } from "./time";

export const HABIT_IDS = HABITS.map((h) => h.id) as [HabitId, ...HabitId[]];

// ── What agents can see ───────────────────────────────────────────────────────

/** A privacy-trimmed snapshot: first names, ages and quest history only (no email, hashes or PIN). */
export interface FamilyContext {
  today: string; // YYYY-MM-DD
  weekday: string; // "Tuesday"
  localTime: string; // "17:42"
  parentName: string;
  children: {
    id: string; name: string; age: number; sparks: number; level: number; levelName: string;
    /** Highest bonus-quest tier this child has unlocked (1-3). */
    unlockedTier: number;
    bonusQuests: { id: string; title: string; tier: number }[];
  }[];
  habits: { id: HabitId; title: string; enabled: boolean; setting: string; value: string }[];
  /** day -> child id -> quest id -> status, for each child's quests, oldest day first */
  history: Record<string, Record<string, Record<string, QuestStatus>>>;
  /** The children's own check-ins from the last 14 days (mood, trickiest quest, stickers, safe notes). */
  checkins: { childId: string; day: string; mood: string; hardest: string | null; favorite: string | null; said: string[] }[];
}

export function buildContext(family: Family, days = 14, now = new Date()): FamilyContext {
  const range = lastDays(days, now);
  const history: FamilyContext["history"] = {};
  for (const day of range) {
    history[day] = Object.fromEntries(
      family.children.map((c) => [c.id, Object.fromEntries(questsFor(family, c.id).map((q) => [q.id, statusOf(family, day, c.id, q.id)]))])
    );
  }
  const title = (id: string | null) => (id ? QUEST_BY_ID[id]?.parentTitle ?? id : null);
  return {
    today: lastDays(1, now)[0],
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    localTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    parentName: family.parentName,
    children: family.children.map((c) => {
      const level = levelOf(c.sparks);
      return {
        id: c.id, name: c.name, age: c.age, sparks: c.sparks, level: level.level, levelName: level.name, unlockedTier: level.tier,
        bonusQuests: c.bonusQuests.map((id) => ({ id, title: QUEST_BY_ID[id]?.parentTitle ?? id, tier: QUEST_BY_ID[id]?.tier ?? 1 })),
      };
    }),
    habits: HABITS.map((h) => ({
      id: h.id,
      title: h.parentTitle,
      enabled: !!family.habits[h.id]?.enabled,
      setting:
        h.setting.kind === "time" ? `${h.setting.label} (HH:MM, 24-hour)`
        : h.setting.kind === "minutes" ? `${h.setting.label} in minutes, one of ${h.setting.options.join(", ")}`
        : "no setting",
      value: family.habits[h.id]?.value ?? "",
    })),
    history,
    // Notes are included only when they passed the safety checks; flagged ones go to the parent, not the AI.
    checkins: family.feedback.filter((f) => range.includes(f.day) && family.children.some((c) => c.id === f.childId)).map((f) => ({
      childId: f.childId,
      day: f.day,
      mood: MOODS.find((m) => m.id === f.mood)?.label ?? f.mood,
      hardest: title(f.hardest),
      favorite: title(f.favorite),
      said: [...f.stickers.map((id) => STICKERS.find((x) => x.id === id)?.text ?? id), ...(f.note && !f.flagged ? [f.note] : [])],
    })),
  };
}

// ── What agents can propose ───────────────────────────────────────────────────

/** Turn a habit on or off and/or change its time or minutes. `value` is "" when the habit has no setting. */
export interface HabitChange {
  habit: HabitId;
  enabled: boolean;
  value: string;
  reason: string;
}

export interface Proposal extends HabitChange {
  id: string;
  source: "planner" | "reviewer" | "assistant";
  createdAt: string;
}

/** Returns an error message, or null when the change is valid for the habit catalog. */
export function validateChange(change: HabitChange): string | null {
  const habit = HABIT_BY_ID[change.habit];
  if (!habit) return `Unknown habit "${change.habit}".`;
  const spec = habit.setting;
  if (spec.kind === "none") return null;
  if (!change.enabled && change.value === "") return null;
  if (spec.kind === "time") {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(change.value);
    if (!m) return `${habit.parentTitle} needs a time as HH:MM (24-hour), got "${change.value}".`;
    return null;
  }
  if (!spec.options.includes(Number(change.value))) {
    return `${habit.parentTitle} must be one of ${spec.options.join(", ")} minutes, got "${change.value}".`;
  }
  return null;
}

/** True when applying the change would leave the family's settings exactly as they are. */
export function isNoOp(family: Family, change: HabitChange): boolean {
  const current = family.habits[change.habit];
  const value = normalizedValue(family, change);
  return !!current && current.enabled === change.enabled && (current.value ?? undefined) === value;
}

/** Applies an approved change. Call only after the parent has confirmed with the PIN. */
export function applyChange(family: Family, change: HabitChange): Family {
  if (validateChange(change)) return family;
  return setHabits(family, {
    ...family.habits,
    [change.habit]: { enabled: change.enabled, value: normalizedValue(family, change) },
  });
}

function normalizedValue(family: Family, change: HabitChange): string | undefined {
  const habit = HABIT_BY_ID[change.habit];
  if (habit.setting.kind === "none") return undefined;
  return change.value === "" ? family.habits[change.habit]?.value : change.value;
}

/** Parent-facing one-liner: "Bedtime: 9:00 PM → 8:30 PM", "Turn on Reduce screen time (45 min)". */
export function describeChange(family: Family, change: HabitChange): string {
  const habit = HABIT_BY_ID[change.habit];
  const current = family.habits[change.habit];
  const fmt = (v?: string) =>
    !v ? "" : habit.setting.kind === "time" ? formatTime(v) : habit.setting.kind === "minutes" ? formatMinutes(Number(v)) : "";
  const next = fmt(normalizedValue(family, change));
  if (!change.enabled) return `Turn off "${habit.parentTitle}"`;
  if (!current?.enabled) return `Turn on "${habit.parentTitle}"${next ? ` (${next})` : ""}`;
  return `${habit.parentTitle}: ${fmt(current.value)} → ${next}`;
}

// ── Agent results ─────────────────────────────────────────────────────────────

export interface PlanResult {
  summary: string;
  tips: string[];
  changes: HabitChange[];
}

export interface ReviewResult {
  headline: string;
  children: { childId: string; wins: string; watch: string }[];
  patterns: string[];
  changes: HabitChange[];
}

// ── Bonus-quest recommendations (the habit coach) ─────────────────────────────

/** The coach's suggestion of a library quest for one child. */
export interface HabitRecommendation {
  childId: string;
  questId: string;
  reason: string;
}

export interface Recommendation extends HabitRecommendation {
  id: string;
  createdAt: string;
}

/** Why a recommendation can't be offered (unknown quest, wrong age, locked tier...), or null. The 4-quest cap doesn't block it: the parent can swap one out. */
export const recommendationBlocker = (family: Family, rec: HabitRecommendation) =>
  bonusQuestBlocker(family, rec.childId, rec.questId, true);

/** Replaces a child's earlier recommendations with a fresh set (the coach refines as the parent talks). */
export function addRecommendations(family: Family, recs: HabitRecommendation[], now = new Date()): Family {
  const valid = recs.filter((r) => !recommendationBlocker(family, r));
  if (valid.length === 0) return family;
  const children = new Set(valid.map((r) => r.childId));
  return withAi(family, (ai) => ({
    recommendations: [
      ...ai.recommendations.filter((r) => !children.has(r.childId)),
      ...valid.map((r, i) => ({ ...r, id: `h${now.getTime().toString(36)}${i}`, createdAt: now.toISOString() })),
    ],
  }));
}

/** Adds the chosen quests to each child's bonus quests. Must be PIN-checked by the caller. */
export function acceptRecommendations(family: Family, ids: string[]): Family {
  const chosen = aiState(family).recommendations.filter((r) => ids.includes(r.id));
  const next = chosen.reduce((f, r) => addBonusQuest(f, r.childId, r.questId), family);
  const added = chosen.filter((r) => next.children.find((c) => c.id === r.childId)?.bonusQuests.includes(r.questId));
  const notes = added.map((r) => `Added bonus quest "${QUEST_BY_ID[r.questId].parentTitle}" for ${family.children.find((c) => c.id === r.childId)?.name}`);
  return withAi(next, (ai) => ({
    recommendations: ai.recommendations.filter((r) => !added.some((x) => x.id === r.id)),
    notes: ai.chat.length > 0 ? [...ai.notes, ...notes] : ai.notes,
  }));
}

export function dismissRecommendation(family: Family, id: string): Family {
  return withAi(family, (ai) => ({ recommendations: ai.recommendations.filter((r) => r.id !== id) }));
}

export type BuddyEvent = "greet" | "submitted" | "celebrate";

export interface BuddyRequest {
  event: BuddyEvent;
  buddy: BuddyId;
  name: string;
  age: number;
  /** Kid-facing quest titles: today's remaining quests for "greet", the quest(s) involved otherwise. */
  quests: string[];
  sparks: number;
}

// ── AI state saved with the family ────────────────────────────────────────────

export interface AiState {
  proposals: Proposal[];
  recommendations: Recommendation[];
  plan?: { at: string; result: PlanResult };
  review?: { at: string; result: ReviewResult };
  /** The assistant conversation exactly as the API returned it. Append-only; sent back each turn. */
  chat: unknown[];
  /** Approvals and dismissals since the last chat turn, told to the assistant with the next message. */
  notes: string[];
  /** Whether the kid's buddy may speak AI-written lines. Parents can turn this off. */
  buddyTalk: boolean;
}

export function aiState(family: Family): AiState {
  return { proposals: [], recommendations: [], chat: [], notes: [], buddyTalk: true, ...family.ai };
}

export function withAi(family: Family, fn: (ai: AiState) => Partial<AiState>): Family {
  const ai = aiState(family);
  return { ...family, ai: { ...ai, ...fn(ai) } };
}

/** Adds proposals, replacing any pending one for the same habit and skipping ones that change nothing. */
export function addProposals(family: Family, changes: HabitChange[], source: Proposal["source"], now = new Date()): Family {
  const fresh = changes.filter((c) => !validateChange(c) && !isNoOp(family, c));
  if (fresh.length === 0) return family;
  return withAi(family, (ai) => ({
    proposals: [
      ...ai.proposals.filter((p) => !fresh.some((c) => c.habit === p.habit)),
      ...fresh.map((c, i) => ({ ...c, source, createdAt: now.toISOString(), id: `p${now.getTime().toString(36)}${i}` })),
    ],
  }));
}

/** Approve (apply) or dismiss a proposal. Approval must already be PIN-checked by the caller. */
export function resolveProposal(family: Family, id: string, approve: boolean): Family {
  const proposal = aiState(family).proposals.find((p) => p.id === id);
  if (!proposal) return family;
  const note = `${approve ? "Approved" : "Dismissed"}: ${describeChange(family, proposal)}`;
  const next = approve ? applyChange(family, proposal) : family;
  return withAi(next, (ai) => ({
    proposals: ai.proposals.filter((p) => p.id !== id),
    notes: ai.chat.length > 0 ? [...ai.notes, note] : ai.notes,
  }));
}
