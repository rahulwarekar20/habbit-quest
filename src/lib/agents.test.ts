/** Rules for AI proposals: what agents can see, what they can propose, and that only approval applies it. */
import { describe, expect, it } from "vitest";
import { emptyFamily } from "./testing";
import {
  addProposals, aiState, applyChange, buildContext, describeChange, resolveProposal, validateChange, type HabitChange,
} from "./agents";
import { addChild, newChild, submitQuest, approveQuest, type Family } from "./family";

function family(): Family {
  const base = emptyFamily();
  return addChild(base, { ...newChild("Alex", 8, "fox"), id: "a" });
}

const bedtime = (value: string): HabitChange => ({ habit: "bedtime", enabled: true, value, reason: "More sleep" });

describe("context sent to agents", () => {
  it("leaves out the email, password hash and PIN hash", () => {
    const json = JSON.stringify(buildContext(family()));
    expect(json).not.toContain("p@example.com");
    expect(json).not.toContain("secret-hash");
    expect(json).not.toContain("pin-hash");
    expect(json).toContain("Alex");
  });

  it("includes 14 days of history for enabled habits", () => {
    const now = new Date(2026, 9, 27, 18, 5);
    let f = submitQuest(family(), "2026-10-27", "a", "wake");
    f = approveQuest(f, "2026-10-27", "a", "wake");
    const ctx = buildContext(f, 14, now);
    expect(Object.keys(ctx.history)).toHaveLength(14);
    expect(ctx.today).toBe("2026-10-27");
    expect(ctx.localTime).toBe("18:05");
    expect(ctx.history["2026-10-27"].a).toEqual({ wake: "approved", homework: "todo", bedtime: "todo" });
  });
});

describe("validating proposed changes", () => {
  it("accepts valid times and screen-time options", () => {
    expect(validateChange(bedtime("20:30"))).toBeNull();
    expect(validateChange({ habit: "screen", enabled: true, value: "45", reason: "" })).toBeNull();
    expect(validateChange({ habit: "homework", enabled: true, value: "", reason: "" })).toBeNull();
    expect(validateChange({ habit: "lunch", enabled: false, value: "", reason: "" })).toBeNull();
  });

  it("rejects bad times, odd minutes and unknown habits", () => {
    expect(validateChange(bedtime("8:30 PM"))).toMatch(/HH:MM/);
    expect(validateChange(bedtime("25:00"))).toMatch(/HH:MM/);
    expect(validateChange({ habit: "screen", enabled: true, value: "50", reason: "" })).toMatch(/30, 45/);
    expect(validateChange({ habit: "nap" as never, enabled: true, value: "", reason: "" })).toMatch(/Unknown/);
  });
});

describe("proposals", () => {
  it("are only suggestions until approved", () => {
    const f = addProposals(family(), [bedtime("20:30")], "assistant");
    expect(f.habits.bedtime.value).toBe("21:00");
    expect(aiState(f).proposals).toHaveLength(1);
  });

  it("skip changes that match current settings and replace older ones for the same habit", () => {
    let f = addProposals(family(), [bedtime("21:00")], "planner");
    expect(aiState(f).proposals).toHaveLength(0);
    f = addProposals(f, [bedtime("20:30")], "planner");
    f = addProposals(f, [bedtime("20:45")], "reviewer");
    expect(aiState(f).proposals.map((p) => [p.value, p.source])).toEqual([["20:45", "reviewer"]]);
  });

  it("approving applies the change; dismissing doesn't", () => {
    const f = addProposals(family(), [bedtime("20:30")], "assistant");
    const id = aiState(f).proposals[0].id;
    expect(resolveProposal(f, id, true).habits.bedtime).toEqual({ enabled: true, value: "20:30" });
    const dismissed = resolveProposal(f, id, false);
    expect(dismissed.habits.bedtime.value).toBe("21:00");
    expect(aiState(dismissed).proposals).toHaveLength(0);
  });

  it("tell the assistant what the parent decided, once a chat has started", () => {
    let f = addProposals(family(), [bedtime("20:30")], "assistant");
    f = { ...f, ai: { ...aiState(f), chat: [{ role: "user", content: "hi" }] } };
    f = resolveProposal(f, aiState(f).proposals[0].id, true);
    expect(aiState(f).notes).toEqual(["Approved: Get to bed early: 9:00 PM → 8:30 PM"]);
  });

  it("never change Sparks", () => {
    let f = submitQuest(family(), "2026-10-27", "a", "wake");
    f = approveQuest(f, "2026-10-27", "a", "wake");
    expect(applyChange(f, { habit: "wake", enabled: false, value: "", reason: "" }).children[0].sparks).toBe(1);
  });

  it("describe changes in parent terms", () => {
    const f = family();
    expect(describeChange(f, { habit: "screen", enabled: true, value: "45", reason: "" })).toBe('Turn on "Reduce screen time" (45 min)');
    expect(describeChange(f, { habit: "homework", enabled: false, value: "", reason: "" })).toBe('Turn off "Complete homework daily"');
  });
});
