/** Rules for quests and Sparks: submit, approve once, "not yet", celebrations, worlds. */
import { describe, expect, it } from "vitest";
import { emptyFamily } from "./testing";
import {
  activeQuests, addChild, approveQuest, celebrationsDue, declineQuest, defaultHabits, markCelebrated, newChild,
  nextWorld, pendingApprovals, questWhen, setHabits, statusOf, submitQuest, WORLDS, type Family,
} from "./family";
import { HABIT_BY_ID } from "./habits";
import { formatMinutes, formatTime } from "./time";

const DAY = "2026-10-27";

function family(): Family {
  const base = emptyFamily();
  return addChild(base, { ...newChild("Alex", 8, "fox"), id: "a" });
}

describe("quests", () => {
  it("lists enabled habits in day order", () => {
    expect(activeQuests(family()).map((h) => h.id)).toEqual(["wake", "homework", "bedtime"]);
  });

  it("approving a submitted quest gives exactly one Spark", () => {
    let f = submitQuest(family(), DAY, "a", "wake");
    expect(pendingApprovals(f, DAY)).toHaveLength(1);
    f = approveQuest(f, DAY, "a", "wake");
    f = approveQuest(f, DAY, "a", "wake"); // double tap
    expect(f.children[0].sparks).toBe(1);
    expect(statusOf(f, DAY, "a", "wake")).toBe("approved");
    expect(pendingApprovals(f, DAY)).toHaveLength(0);
  });

  it("can't approve a quest the child hasn't submitted", () => {
    const f = approveQuest(family(), DAY, "a", "wake");
    expect(f.children[0].sparks).toBe(0);
  });

  it("resubmitting an approved quest changes nothing", () => {
    let f = approveQuest(submitQuest(family(), DAY, "a", "wake"), DAY, "a", "wake");
    f = submitQuest(f, DAY, "a", "wake");
    expect(statusOf(f, DAY, "a", "wake")).toBe("approved");
  });

  it("'not yet' lets the child try again without a Spark", () => {
    let f = declineQuest(submitQuest(family(), DAY, "a", "homework"), DAY, "a", "homework");
    expect(statusOf(f, DAY, "a", "homework")).toBe("notyet");
    expect(f.children[0].sparks).toBe(0);
    f = approveQuest(submitQuest(f, DAY, "a", "homework"), DAY, "a", "homework");
    expect(f.children[0].sparks).toBe(1);
  });

  it("each approval is celebrated once", () => {
    let f = approveQuest(submitQuest(family(), DAY, "a", "wake"), DAY, "a", "wake");
    expect(celebrationsDue(f, DAY, "a").map((h) => h.id)).toEqual(["wake"]);
    f = markCelebrated(f, DAY, "a", ["wake"]);
    f = markCelebrated(f, DAY, "a", ["wake"]);
    expect(celebrationsDue(f, DAY, "a")).toEqual([]);
    expect(f.children[0].celebrated).toEqual([`${DAY}:wake`]);
  });

  it("does not mutate the family it was given", () => {
    const f = family();
    submitQuest(f, DAY, "a", "wake");
    expect(f.log).toEqual({});
  });
});

describe("settings and worlds", () => {
  it("shows the parent's chosen time or limit", () => {
    const f = setHabits(family(), { ...defaultHabits(), wake: { enabled: true, value: "06:45" }, screen: { enabled: true, value: "90" } });
    expect(questWhen(f, HABIT_BY_ID.wake)).toBe("by 6:45 AM");
    expect(questWhen(f, HABIT_BY_ID.screen)).toBe("max 1 hr 30 min");
    expect(questWhen(f, HABIT_BY_ID.homework)).toBeNull();
  });

  it("unlocks Mosswood at 5 Sparks and Sky Islands at 20", () => {
    expect(nextWorld(4)?.id).toBe("mosswood");
    expect(nextWorld(5)?.id).toBe("sky");
    expect(nextWorld(20)).toBeNull();
    expect(WORLDS[0].sparks).toBe(0);
  });

  it("formats times and limits for people", () => {
    expect(formatTime("21:00")).toBe("9:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 hours");
  });
});
