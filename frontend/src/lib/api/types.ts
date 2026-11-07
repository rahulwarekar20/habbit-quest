/** Response and input types shared by the endpoint modules, matching the backend's JSON. */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = "father" | "mother" | "guardian" | "other";
export type Buddy = "fox" | "owl" | "bear" | "bunny";
export type BuddySelectionMode = "legacy" | "catalog";
/** Optional for old cached responses; current server responses include all four fields. */
export interface BuddySelectionFields {
  buddy_selection_mode?: BuddySelectionMode;
  catalog_buddy_id?: string | null;
  buddy_catalog_version?: string | null;
  buddy_selection_revision?: number;
}
export type BuddySelectionInput = (
  | { mode: "legacy"; buddy: Buddy; catalog_buddy_id?: never; buddy_catalog_version?: never }
  | { mode: "catalog"; catalog_buddy_id: string; buddy_catalog_version: string; buddy?: never }
) & { expected_revision?: number };
export type ThemeWorld = "camp" | "mosswood" | "sky" | "coral" | "crystal" | "star";
export type DayName = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * The parts of a child's day a habit can belong to, in order; each has a start time in the child's details.
 */
export const ROUTINE_PARTS = ["morning", "midday", "after_school", "evening", "bedtime"] as const;
export type RoutinePart = (typeof ROUTINE_PARTS)[number];
export type RoutineTimes = Partial<Record<RoutinePart, string>>;

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface FamilyLink { id: string; name: string; display_name: string; role: Role }
export interface Me { id: string; name: string | null; email: string | null; families: FamilyLink[] }

export interface Caregiver { user_id: string; display_name: string; role: Role }
export interface ApiFamily {
  id: string;
  name: string;
  timezone: string;
  invite_code: string;
  login_code: string | null; // shared as a QR code; null until a caregiver makes one
  has_pin: boolean;
  created_at: string;
  caregivers: Caregiver[];
}

export interface ApiChild extends BuddySelectionFields {
  id: string;
  family_id: string;
  name: string;
  age: number;
  buddy: Buddy;
  world: ThemeWorld;
  tier_override: number; // highest quest tier to allow; 0 follows the child's world
  routine_times: RoutineTimes;
  has_pin: boolean; // the child has their own kid PIN
  created_at: string;
}
export type ChildInput = Pick<ApiChild, "name" | "age" | "routine_times"> & { buddy?: Buddy; buddy_selection?: BuddySelectionInput; tier_override?: number };

export interface Landmark { id: string; name: string; emoji: string; sparks: number; x: number; y: number }
export interface JourneyWorld {
  id: ThemeWorld;
  name: string;
  sparks: number;
  rank: string;
  tier: number;
  blurb: string;
  landmarks: Landmark[];
}
export interface Progress {
  sparks: number;
  pending_sparks: number; // waiting for a grown-up
  level: number;
  level_name: string;
  world: ThemeWorld;
  unlocked_tier: number;
  next_level_at: number | null;
  next_landmark: (Landmark & { world: ThemeWorld }) | null;
}
export interface QuestStars { habit_id: string; kid_title: string; icon: string; approvals: number; stars: number; targets: number[] }
export interface Journey { progress: Progress; worlds: JourneyWorld[]; discoveries: string[]; quest_stars: QuestStars[] }

export interface HabitText {
  goal_id: string;
  title: string;
  description: string;
  kid_title: string;
  kid_hint: string;
  icon: string;
  anchor: RoutinePart;
  tier: number;
  points: number;
}
export interface Option extends HabitText { id: string; recommended?: boolean }

export interface PlanGoal {
  goal_id: string;
  title: string;
  status: "suggested" | "active";
  reason: string | null;
  recommended_habit_ids: string[];
  options: Option[];
}
export interface PlanHabit extends HabitText {
  id: string; // the child-habit id
  habit_id: string;
  cue_time: string;
  days: DayName[];
  status: "active" | "paused";
  started_on: string;
}
export interface Plan { child_id: string; progress: Progress; goals: PlanGoal[]; habits: PlanHabit[]; capacity?: { limit: number; used: number; remaining: number } }
export interface PlanInput {
  goals: string[];
  habits: { habit_id: string; cue_time?: string; days?: DayName[] }[];
}

export interface PainPoint { id: string; text: string; mapped_by: "ai" | "keywords" | "manual"; created_at: string }
export interface PainPointResult {
  pain_point: PainPoint | null;
  safety: { guidance: string } | null;
  plan: Plan | null;
}

export interface Goal { id: string; title: string; description: string }

export type HabitStatus = "todo" | "submitted" | "approved" | "rejected";
export type Boost = "golden" | "streak" | "double" | "welcome";
export interface TodayHabit {
  child_habit_id: string;
  habit_id: string;
  kid_title: string;
  kid_hint: string;
  icon: string;
  anchor: RoutinePart;
  tier: number;
  points: number;
  cue_time: string;
  status: HabitStatus;
  completion_id: string | null;
  boosts: Boost[];
  multiplier: number;
  stars: number;
}
export interface Today {
  upcoming_habits?: { habit_id: string; kid_title: string; kid_hint: string; icon: string; cue_time: string; days: DayName[] }[];
  child: { id: string; name: string; age?: number; buddy: Buddy; world: ThemeWorld } & BuddySelectionFields;
  day: string;
  welcome_back: boolean;
  rest_day: boolean; // the child has a plan, but no quests today
  next_quest_day: string | null;
  progress: Progress;
  points: number;
  habits: TodayHabit[];
  streak: number;
  week: Record<string, number>; // day -> approved habits, oldest first
}

export interface Approval {
  completion_id: string;
  child_id: string;
  child_name: string;
  habit_id: string;
  title: string;
  kid_title: string;
  icon: string;
  points: number;
  day: string;
  submitted_at: string;
}
export interface Decision {
  completion: { id: string; status: "approved" | "rejected"; day: string; submitted_at: string; decided_at: string };
  child_id: string;
  progress: Progress;
  points: number;
}

export interface PointsEntry {
  id: number | string;
  amount: number;
  reason: "earned" | "redeemed" | "adjusted" | "bonus" | "spent" | "refund";
  note: string | null;
  created_at: string;
  habit_id: string | null;
  kid_title: string | null;
  icon: string | null;
  completion_day: string | null;
  by?: string | null;
}
export interface PointsHistory { points: number; earned: number; spent: number; entries: PointsEntry[] }

export type RewardKind = "screen" | "privilege" | "outing" | "toy" | "mystery";
export interface Reward { id: string; title: string; emoji: string; cost: number; kind: RewardKind; minutes: number | null }
export interface RewardRequest {
  id: string;
  child_id: string;
  title: string;
  emoji: string;
  cost: number;
  minutes: number | null;
  mystery: boolean;
  status: "pending" | "approved" | "declined";
  day: string;
  created_at: string;
}
export interface FamilyRewardRequest extends RewardRequest { child_name: string }

export type Mood = "great" | "good" | "okay" | "hard";
export interface CheckinInput { mood: Mood; hardest: string | null; favorite: string | null; stickers: string[]; note: string | null }
export interface OwnCheckin extends CheckinInput { id: string; day: string; flagged: string | null; read_at: string | null; created_at: string }
export interface Checkin extends OwnCheckin { child_id: string; child_name: string }

export interface Surprise {
  id: string;
  child_id: string | null;
  kind: "note" | "double";
  message: string;
  points: number;
  day: string;
  created_at: string;
}

export interface FamilySettings { app_limit: number; buddy_talk: boolean }
export interface Extras extends FamilySettings, BuddySelectionFields {
  buddy?: Buddy;
  discoveries: string[];
  accessories: string[];
  wearing: string | null;
  goal: string | null;
  chests: string[];
  level_seen: number;
  app_seconds: Record<string, number>;
  app_extra_minutes: Record<string, number>;
  screen_bonus: Record<string, number>;
}
export type ChestPrize = { kind: "points"; points: number } | { kind: "accessory"; id: string; name: string };

export interface Suggestion {
  id: string;
  child_id: string;
  child_name: string;
  source: "coach" | "planner" | "reviewer" | "mastery";
  kind: "add" | "retime" | "pause" | "resume" | "remove";
  habit_id: string;
  title: string;
  icon: string;
  tier: number;
  cue_time: string | null;
  reason: string;
  created_at: string;
}
export interface CoachMessage {
  id: number;
  role: "parent" | "coach";
  content: string;
  sources: { ref: string; title: string }[];
  no_habit_match: boolean;
  created_at: string;
}
export type HabitSetting = "home" | "school" | "community" | "outdoors" | "online";
export interface SourceReference {
  source_id: string;
  concept_id: string;
  category_id: string;
  catalog_version: string;
  record_sha256: string;
  snapshot_id?: string;
}
export interface GoalRecommendation {
  id: string;
  child_id: string;
  goal_id: string;
  title: string;
  description: string;
  reason: string;
  source_ref: SourceReference;
  setting: HabitSetting;
  created_at: string;
}
export interface CoachThread { messages: CoachMessage[]; suggestions: Suggestion[]; goal_recommendations?: GoalRecommendation[]; tokenomics?: import("./tokenomics").GenerationAccounting }
export interface CoachContext { children: Record<string, CoachThread>; history_limit: number }
export interface CoachReply extends CoachThread {
  tokenomics?: import("./tokenomics").GenerationAccounting;
  reply: string;
  response_goal_ids?: string[];
  safety: { guidance: string } | null;
  mapped_by: "ai" | "keywords" | "manual";
  outcome?: string;
  timings?: Record<string, number>;
  logical_calls?: number | null;
  generation_passes?: number | null;
  safety_revision?: boolean | null;
  provider_attempts?: Record<string, number>;
  risk_status?: "risk" | "no_risk" | "unavailable" | "local_risk" | "local_only" | "not_checked";
}
export interface PlanReport { summary: string; tips: string[] }
export interface ReviewReport {
  headline: string;
  children: { child: string; wins: string; watch: string }[];
  patterns: string[];
}
export interface Report<T> { id: string; kind: "plan" | "review"; result: T; created_at: string; tokenomics?: import("./tokenomics").GenerationAccounting }
