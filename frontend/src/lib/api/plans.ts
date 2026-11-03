/** Each child's plan: pain points, goals, the catalog, custom habits and plan changes. */
import type { DayName, Goal, HabitText, Option, PainPointResult, Plan, PlanInput, RoutinePart } from "./types";
import { AI_TIMEOUT_MS, request } from "./client";

// ── Onboarding: pain points, goals, habits ────────────────────────────────────

/** Describe a problem: `POST /v1/children/{child_id}/pain-points`. */
export const addPainPoint = (childId: string, text: string) =>
  request<PainPointResult>("POST", `/v1/children/${childId}/pain-points`, { text }, { timeoutMs: AI_TIMEOUT_MS });
/** Read the plan: `GET /v1/children/{child_id}/plan`. */
export const getPlan = (childId: string) => request<Plan>("GET", `/v1/children/${childId}/plan`);
/** Set the plan: `PUT /v1/children/{child_id}/plan`. */
export const putPlan = (childId: string, input: PlanInput) => request<Plan>("PUT", `/v1/children/${childId}/plan`, input);
/** Adjust one habit: `PATCH /v1/child-habits/{child_habit_id}`. */
export const updateChildHabit = (id: string, changes: { cue_time?: string; days?: DayName[]; status?: "active" | "paused" | "removed" }) =>
  request<Plan>("PATCH", `/v1/child-habits/${id}`, changes);
/** List goals: `GET /v1/goals`. */
export const listGoals = () => request<Goal[]>("GET", "/v1/goals");

/** A catalog habit, or one of the family's own (ids starting "my-"), with its goal's title and age range. */
export interface CatalogHabit extends HabitText { id: string; goal_title: string; min_age: number; max_age: number }
export interface CustomHabitInput {
  goal_id: string;
  title: string;
  kid_title?: string;
  description?: string;
  kid_hint?: string;
  icon: string;
  anchor: RoutinePart;
}
/** The whole catalog: `GET /v1/catalog`. */
export const listCatalog = () => request<CatalogHabit[]>("GET", "/v1/catalog");
/** List custom habits: `GET /v1/families/{family_id}/habits`. */
export const listCustomHabits = (familyId: string) => request<CatalogHabit[]>("GET", `/v1/families/${familyId}/habits`);
/** Create a custom habit: `POST /v1/families/{family_id}/habits`. */
export const createCustomHabit = (familyId: string, input: CustomHabitInput) =>
  request<CatalogHabit>("POST", `/v1/families/${familyId}/habits`, input);
/** Edit a custom habit: `PUT /v1/habits/{habit_id}`. */
export const editCustomHabit = (habitId: string, input: CustomHabitInput) =>
  request<CatalogHabit>("PUT", `/v1/habits/${habitId}`, input);
/** Delete a custom habit: `DELETE /v1/habits/{habit_id}`. */
export const deleteCustomHabit = (habitId: string) => request<void>("DELETE", `/v1/habits/${habitId}`);
/** Habits for a goal: `GET /v1/goals/{goal_id}/habits`, optionally only those for an age and up to a tier. */
export const listGoalHabits = (goalId: string, age?: number, maxTier?: number) => {
  const query = new URLSearchParams();
  if (age !== undefined) query.set("age", String(age));
  if (maxTier !== undefined) query.set("max_tier", String(maxTier));
  const text = query.toString();
  return request<Option[]>("GET", `/v1/goals/${goalId}/habits${text ? `?${text}` : ""}`);
};
