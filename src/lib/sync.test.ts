/** The mirror of the backend's day, boosts paid locally, reward requests, and building a plan. */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { addChild, allDone, newChild, questsFor, statusOf, streakOf, type Family } from "./family";
import { initialPicks, planInput, savePlan } from "./plan";
import { askForReward, plantSurprise, resolveRedemption } from "./rewards";
import { applyToday, boostExtra, creditBoost } from "./sync";
import { emptyFamily } from "./testing";

const DAY = "2026-10-27";
const progress = { sparks: 7, level: 2, level_name: "Explorer", unlocked_tier: 2, next_level_at: 15 };
const habit = (habit_id: string, status: api.HabitStatus): api.TodayHabit => ({
  child_habit_id: `ch-${habit_id}`, habit_id, kid_title: `Kid ${habit_id}`, kid_hint: "Hint", icon: "x", anchor: "morning",
  tier: 1, points: 10, cue_time: "07:00", status, completion_id: null,
});
const today = (habits: api.TodayHabit[], day = DAY): api.Today => ({
  child: { id: "a", name: "Alex", buddy: "fox", world: "space" }, day, progress, points: 40, habits,
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

  it("drives the chest: every server quest approved means all done", () => {
    expect(allDone(applyToday(family(), today([habit("wake", "approved"), habit("bedtime", "submitted")])), DAY, "a")).toBe(false);
    expect(allDone(applyToday(family(), today([habit("wake", "approved")])), DAY, "a")).toBe(true);
  });

  it("builds a streak from the days this browser saw", () => {
    let f = family();
    for (const d of ["2026-10-25", "2026-10-26", DAY]) f = applyToday(f, today([habit("wake", "approved")], d));
    expect(streakOf(f, "a", DAY)).toBe(3);
  });

  it("keeps browser-only bonus points when the balance changes", () => {
    const f = family();
    const rich = { ...f, children: f.children.map((c) => ({ ...c, points: 15 })) };
    expect(applyToday(rich, today([])).children[0]).toMatchObject({ points: 15, balance: 40 });
  });
});

describe("boosts paid in the browser", () => {
  it("pays the extra as bonus points, leaving the backend balance alone", () => {
    const f = plantSurprise(applyToday(family(), today([habit("wake", "approved")])), { childId: "all", kind: "double", message: "", points: 0, day: DAY });
    // A lone quest is always the golden quest, and the double day adds another 1x.
    expect(boostExtra(f, DAY, "a", "wake", 10)).toBe(20);
    expect(creditBoost(f, DAY, "a", "wake", "Rise", 10).children[0]).toMatchObject({ points: 20, balance: 40 });
  });
});

describe("asking for a reward", () => {
  const rich = () => applyToday(family(), today([]));

  it("holds nothing, and saying no refunds nothing", () => {
    const { family: f, redemption } = askForReward(rich(), "a", "mystery", DAY);
    expect(redemption).toMatchObject({ status: "pending", asked: true });
    const declined = resolveRedemption(f, redemption!.id, false);
    expect(declined.children[0]).toMatchObject({ points: 0, balance: 40 });
    expect(declined.redemptions[0].status).toBe("declined");
  });

  it("refuses a reward the balance can't cover", () => {
    expect(askForReward(rich(), "a", "small-toy", DAY).error).toBe("You need 360 more points.");
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
