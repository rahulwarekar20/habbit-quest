/** The mirror of the backend's data, and building a plan. */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { addChild, newChild, questsFor, statusOf, type Family } from "./family";
import { initialPicks, planInput, savePlan } from "./plan";
import { applyExtras, applyToday } from "./sync";
import { emptyFamily } from "./testing";

const DAY = "2026-10-27";
const progress = {
  sparks: 7, pending_sparks: 0, level: 2, level_name: "Forest Explorer", world: "mosswood" as const, unlocked_tier: 2,
  next_level_at: 90, next_landmark: null,
};
const habit = (habit_id: string, status: api.HabitStatus): api.TodayHabit => ({
  child_habit_id: `ch-${habit_id}`, habit_id, kid_title: `Kid ${habit_id}`, kid_hint: "Hint", icon: "x", anchor: "morning",
  tier: 1, points: 10, cue_time: "07:00", status, completion_id: null, boosts: [], multiplier: 1, stars: 0,
});
const today = (habits: api.TodayHabit[], day = DAY): api.Today => ({
  child: { id: "a", name: "Alex", buddy: "fox", world: "camp" }, day, welcome_back: false, rest_day: false, next_quest_day: null, progress, points: 40, habits, streak: 3, week: { [DAY]: 1 },
});
const family = (): Family => addChild(emptyFamily(), { ...newChild("Alex", 8, "fox"), id: "a" });

afterEach(() => void vi.restoreAllMocks());

describe("mirroring the backend's day", () => {
  it("copies Sparks, balance, quests and statuses, with rejected as not yet", () => {
    const f = applyToday(family(), today([habit("wake", "approved"), habit("new-from-server", "rejected")]));
    expect(f.children[0]).toMatchObject({ sparks: 7, balance: 40 });
    expect(questsFor(f, "a").map((q) => q.id)).toEqual(["wake", "new-from-server"]);
    expect(questsFor(f, "a")[1].kidTitle).toBe("Kid new-from-server");
    expect(statusOf(f, DAY, "a", "new-from-server")).toBe("notyet");
  });

  it("keeps the backend's streak and week", () => {
    expect(applyToday(family(), today([])).children[0]).toMatchObject({ streak: 3, week: { [DAY]: 1 } });
  });

  it("copies kid extras and the family's settings", () => {
    const extras: api.Extras = {
      app_limit: 30, buddy_talk: false, discoveries: ["camp:tent"], accessories: ["crown"], wearing: "crown", goal: null, chests: [DAY],
      level_seen: 2, app_seconds: { [DAY]: 60 }, app_extra_minutes: {}, screen_bonus: {},
    };
    const f = applyExtras(family(), "a", extras);
    expect(f.settings).toEqual({ appLimit: 30, buddyTalk: false });
    expect(f.children[0]).toMatchObject({ wearing: "crown", chests: [DAY], levelSeen: 2, appSeconds: { [DAY]: 60 } });
  });
});

const option = (id: string, goal_id: string): api.Option => ({
  id, goal_id, title: id, description: "", kid_title: id, kid_hint: "", icon: "", anchor: "morning", tier: 1, points: 10,
});
const goal = (goal_id: string, recommended: string[], ids: string[]): api.PlanGoal => ({
  goal_id, title: goal_id, status: "suggested", reason: "why", recommended_habit_ids: recommended, options: ids.map((i) => option(i, goal_id)),
});
const planHabit = (habit_id: string, goal_id: string, status: "active" | "paused" = "active"): api.PlanHabit => ({
  ...option(habit_id, goal_id), id: `ch-${habit_id}`, habit_id, cue_time: "19:30", days: ["mon"], status, started_on: DAY,
});
const plan = (goals: api.PlanGoal[], habits: api.PlanHabit[]): api.Plan => ({ child_id: "a", progress, goals, habits });

describe("building a plan", () => {
  it("ticks current habits, then recommendations, up to six", () => {
    const current = ["a", "b", "c", "d", "e"].map((h) => planHabit(h, "g1"));
    expect(initialPicks(plan([goal("g2", ["x", "y"], ["x", "y"])], current))).toEqual(["a", "b", "c", "d", "e", "x"]);
  });

  it("ignores a recommendation the child has no option for", () => {
    expect(initialPicks(plan([goal("g", ["gone"], [])], []))).toEqual([]);
  });

  it("keeps current times and days, and lists only goals with a picked habit", () => {
    const p = plan([goal("g1", [], ["old"]), goal("g2", [], ["new"]), goal("g3", [], ["no"])], [planHabit("old", "g1")]);
    expect(planInput(p, p.goals, ["old", "new"])).toEqual({
      goals: ["g1", "g2"],
      habits: [{ habit_id: "old", cue_time: "19:30", days: ["mon"] }, { habit_id: "new" }],
    });
  });

  it("pauses a paused habit again after saving, because PUT re-activates it", async () => {
    const before = plan([], [planHabit("rest", "g", "paused"), planHabit("run", "g")]);
    const afterPut = plan([], [planHabit("rest", "g"), planHabit("run", "g")]);
    vi.stubGlobal("fetch", vi.fn());
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      calls.push(`${init?.method} ${String(url).replace(/^.*\/v1/, "")} ${init?.body ?? ""}`);
      return new Response(JSON.stringify(init?.method === "PUT" ? afterPut : before), { status: 200 });
    });
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ token: "t", expiresAt: Date.now() + 9999 }) });
    await expect(savePlan("a", before, { goals: ["g"], habits: [] })).resolves.toEqual(before);
    expect(calls).toEqual(['PUT /children/a/plan {"goals":["g"],"habits":[]}', 'PATCH /child-habits/ch-rest {"status":"paused"}']);
    vi.unstubAllGlobals();
  });
});
