/** What the browser still decides: celebrations, discoveries, worlds and display formats. */
import { describe, expect, it } from "vitest";
import { addChild, celebrationsDue, discover, markCelebrated, newChild, nextWorld, WORLDS, type Family } from "./family";
import { emptyFamily } from "./testing";
import { formatMinutes, formatTime } from "./time";

const DAY = "2026-10-27";

function family(): Family {
  const child = { ...newChild("Alex", 8, "fox"), id: "a", plan: [{ id: "wake", kidTitle: "Rise", kidHint: "Up!", tier: 1 }] };
  return { ...addChild(emptyFamily(), child), log: { [DAY]: { a: { wake: "approved" } } } };
}

describe("celebrations and discoveries", () => {
  it("each approval is celebrated once", () => {
    let f = family();
    expect(celebrationsDue(f, DAY, "a").map((h) => h.id)).toEqual(["wake"]);
    f = markCelebrated(f, DAY, "a", ["wake"]);
    f = markCelebrated(f, DAY, "a", ["wake"]);
    expect(celebrationsDue(f, DAY, "a")).toEqual([]);
    expect(f.children[0].celebrated).toEqual([`${DAY}:wake`]);
  });

  it("a discovery is recorded once", () => {
    const f = discover(discover(family(), "a", "camp:tent"), "a", "camp:tent");
    expect(f.children[0].discoveries).toEqual(["camp:tent"]);
  });
});

describe("worlds and formats", () => {
  it("unlocks Mosswood at 30 Sparks and Star Harbour at 450", () => {
    expect(nextWorld(29)?.id).toBe("mosswood");
    expect(nextWorld(30)?.id).toBe("sky");
    expect(nextWorld(449)?.id).toBe("star");
    expect(nextWorld(450)).toBeNull();
    expect(WORLDS[0].sparks).toBe(0);
  });

  it("formats times and limits for people", () => {
    expect(formatTime("21:00")).toBe("9:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 hours");
  });
});