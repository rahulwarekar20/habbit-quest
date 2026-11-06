import type { ProgressListener } from "./generationProgress";
/** Source-backed goals and explicit, parent-approved habit generation. */
import { AI, KID, request, withPin } from "./client";
import type { DayName, HabitSetting, Plan, RoutinePart, SourceReference } from "./types";

export interface GoalSource {
  goal_id: string;
  title: string;
  description: string;
  source_ref: SourceReference;
  age_min: number;
  age_max: number;
  contexts: string[];
  parent: {
    selection_guidance: string; setup: string; steps: string[]; say: string;
    avoid: string[]; adaptations: string[]; review_guidance: string;
  };
  kid: { title: string; description: string; instructions: string[]; help_phrase: string; delivery_options: string[] };
  practice: {
    form: string; schedule: string; completion: string; minimum_seconds: number;
    typical_seconds: number; timing_note: string; support_level: string; adult_role: string;
    easier_version: string; stretch_version: string; allowed_outcomes: string[]; observation_rule: string;
  };
  safety: { flags: string[]; not_for: string[]; care_and_help_unconditional: boolean };
  research: {
    insight: string;
    evidence: { source_id: string; relationship: string; supports: string; does_not_establish: string; age_transfer: string; source_url: string }[];
    product_efficacy: string;
  };
  readiness_note: string;
  support_targets: string[];
  mechanisms: string[];
  clinical_review_status: string;
  status: string;
}

export interface GeneratedHabitDraft {
  emoji_key?: string;
  title: string;
  description: string;
  kid_title: string;
  kid_hint: string;
  instruction: string;
  why: string;
  parent_setup: string;
  strategy: string;
  estimated_seconds: number;
  steps: string[];
  materials: string[];
  help_text: string;
  cue: string;
  completion: string;
  parent_guidance: { prepare: string; coach: string; if_hard: string; observe: string };
  recurrence: "daily" | "weekly";
}

export interface HabitDraftItem {
  id: string;
  draft: GeneratedHabitDraft;
  accepted_habit_id: string | null;
  child_habit_id: string | null;
}
export interface HabitDraftBatch {
  tokenomics?: import("./tokenomics").GenerationAccounting;
  id: string;
  child_id: string;
  goal_id: string;
  status: string;
  outcome: string;
  message?: string;
  source: SourceReference;
  items: HabitDraftItem[];
  expires_at: string;
  timings?: Record<string, number>;
  logical_calls?: number;
  provider_attempts?: Record<string, number>;
  validation_mode?: string;
  failure_code?: string | null;
  validation_failures?: { attempt: number; stage: string; code: string; fields?: string[]; error_types?: string[] }[];
}
export interface AcceptedGeneratedHabit { habit_id: string; child_habit_id: string; goal_id: string }
export interface KidHabitDetails {
  habit_id: string; goal_id: string; title: string; instruction: string; steps: string[];
  materials: string[]; help_text: string; cue: string; completion: string;
}

/** Reads the pinned source card; this operation makes no model call. */
export const getGoalSource = (childId: string, goalId: string, setting: HabitSetting) =>
  request<GoalSource>("GET", `/v1/children/${childId}/goals/${goalId}/source?setting=${setting}`);
/** Reopens saved, locally validated proposals without generating another batch. */
export const getHabitDrafts = (childId: string, goalId: string) =>
  request<{ batches: HabitDraftBatch[] }>("GET", `/v1/children/${childId}/goals/${goalId}/habit-drafts`);
export const generateHabitDrafts = (childId: string, goalId: string, body: {
  request_id: string; setting: HabitSetting; parent_instruction: string; count: number; parent_operation_id?: string;
}, onProgress?: ProgressListener) => request<HabitDraftBatch>("POST", `/v1/children/${childId}/goals/${goalId}/habit-drafts${onProgress ? "?stream=true" : ""}`, body, { ...AI, retryWrites: false, onProgress });
export const acceptHabitDraft = (batchId: string, draftId: string, pin: string, schedule: {
  cue_time: string; days: DayName[]; anchor: RoutinePart;
}) => request<AcceptedGeneratedHabit>("POST", `/v1/habit-drafts/${batchId}/items/${draftId}/accept`, { ...schedule, ...withPin(pin) }, { retryWrites: false });
export const getGeneratedHabitDetails = (childId: string, habitId: string) =>
  request<{ habit_id: string; goal_id: string; source: SourceReference; draft: GeneratedHabitDraft }>("GET", `/v1/children/${childId}/habits/${habitId}/details`);
export const getKidHabitDetails = (habitId: string) => request<KidHabitDetails>("GET", `/v1/kid/habits/${habitId}/details`, undefined, KID);

/** Save or remove a child goal; removing it also removes its live assignments, preserving history. */
export const updatePlanGoal = (childId: string, goalId: string, status: "active" | "dropped", setting: HabitSetting) =>
  request<Plan>("PATCH", `/v1/children/${childId}/goals/${goalId}`, { status, setting }, { retryWrites: false });
/** Add or restore an approved/catalog habit while preserving the rest of the plan; omitted scheduling uses server defaults. */
export const restorePlanHabit = (childId: string, habitId: string, pin: string, schedule: { cue_time?: string; days?: DayName[] } = {}) =>
  request<Plan>("POST", `/v1/children/${childId}/habits`, { habit_id: habitId, ...schedule, ...withPin(pin) }, { retryWrites: false });
