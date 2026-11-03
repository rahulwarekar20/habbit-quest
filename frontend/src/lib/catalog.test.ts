import { describe, expect, it } from "vitest";
import { standing } from "../components/HabitCatalog";
import type { CatalogHabit, Plan, PlanHabit } from "./api";
import { withHabit } from "./plan";

const child = { id: "c1", name: "Alex", age: 7 };

function habit(overrides: Partial<CatalogHabit> = {}): CatalogHabit {
  return {
    id: "veggie", goal_id: "meals", goal_title: "Happier mealtimes", title: "Try a veggie", description: "",
    kid_title: "Veggie bite", kid_hint: "", icon: "🥦", anchor: "evening", tier: 1, points: 10,
    min_age: 3, max_age: 13, ...overrides,
  };
}

function plan(habits: Partial<PlanHabit>[] = [], unlocked = 1): Plan {
  return {
    child_id: "c1",
    progress: { unlocked_tier: unlocked } as Plan["progress"],
    goals: [],
    habits: habits.map((h, i) => ({ id: `ch${i}`, habit_id: `h${i}`, goal_id: "bedtime", cue_time: "19:00", days: ["mon"], status: "active", started_on: "", ...h }) as PlanHabit),
  };
}

describe("standing", () => {
  it("says what stops a habit joining the plan, in order", () => {
    expect(standing(habit(), child, plan([{ habit_id: "veggie" }])).kind).toBe("in");
    expect(standing(habit({ min_age: 9 }), child, plan()).text).toBe("For ages 9–13");
    expect(standing(habit({ tier: 2 }), child, plan()).text).toBe("Unlocks at tier 2");
    expect(standing(habit({ tier: 2 }), child, plan([], 2)).kind).toBe("add");
    expect(standing(habit(), child, plan(Array.from({ length: 6 }, () => ({})))).kind).toBe("full");
  });
});

describe("withHabit", () => {
  it("keeps every current habit with its time and days, and lists the new habit's goal", () => {
    const input = withHabit(plan([{ habit_id: "bedtime", goal_id: "bedtime", cue_time: "19:30", days: ["mon", "tue"] }]), habit());
    expect(input.goals).toEqual(["bedtime", "meals"]);
    expect(input.habits).toEqual([{ habit_id: "bedtime", cue_time: "19:30", days: ["mon", "tue"] }, { habit_id: "veggie" }]);
  });
});
