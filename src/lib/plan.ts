/** Choosing habits for a child's plan: what starts ticked, and what a save sends. */
import { putPlan, updateChildHabit, type Option, type Plan, type PlanGoal, type PlanInput } from "./api";

export const MAX_HABITS = 6;

/** Current habits (paused ones too), then recommended options, up to the limit. */
export function initialPicks(plan: Plan): string[] {
  const picks = plan.habits.map((h) => h.habit_id);
  for (const goal of plan.goals) {
    for (const id of goal.recommended_habit_ids) {
      if (picks.length < MAX_HABITS && !picks.includes(id) && goal.options.some((o) => o.id === id)) picks.push(id);
    }
  }
  return picks;
}

/**
 * Builds the PUT body. The backend removes anything unlisted, so current habits keep their times
 * and days, and a goal is listed exactly when one of its habits is picked.
 */
export function planInput(plan: Plan, goals: PlanGoal[], picks: string[]): PlanInput {
  const options = new Map<string, Option>(goals.flatMap((g) => g.options.map((o) => [o.id, o] as const)));
  const current = new Map(plan.habits.map((h) => [h.habit_id, h]));
  const goalIds = picks.map((id) => current.get(id)?.goal_id ?? options.get(id)?.goal_id).filter((g): g is string => !!g);
  return {
    goals: [...new Set(goalIds)],
    habits: picks.map((habit_id) => {
      const h = current.get(habit_id);
      return h ? { habit_id, cue_time: h.cue_time, days: h.days } : { habit_id };
    }),
  };
}

/** Saves the plan. PUT re-activates every listed habit, so paused ones are paused again after it. */
export async function savePlan(childId: string, plan: Plan, input: PlanInput): Promise<Plan> {
  let saved = await putPlan(childId, input);
  const paused = new Set(plan.habits.filter((h) => h.status === "paused").map((h) => h.habit_id));
  for (const habit of saved.habits) {
    if (paused.has(habit.habit_id)) saved = await updateChildHabit(habit.id, { status: "paused" });
  }
  return saved;
}
