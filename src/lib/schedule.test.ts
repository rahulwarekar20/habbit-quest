import { describe, expect, it } from "vitest";
import { DAY_PRESETS, presetFor, toggleDay } from "./schedule";

describe("quest days", () => {
  it("names the quick choices and leaves custom days unnamed", () => {
    expect(presetFor(DAY_PRESETS[0].days)).toBe("Every day");
    expect(presetFor(["sun", "sat"])).toBe("Weekends");
    expect(presetFor(["mon", "wed", "fri"])).toBeNull();
  });

  it("toggles a day and keeps week order", () => {
    expect(toggleDay(["fri"], "mon")).toEqual(["mon", "fri"]);
    expect(toggleDay(["mon", "fri"], "mon")).toEqual(["fri"]);
  });

  it("never leaves a quest with no days", () => {
    expect(toggleDay(["sat"], "sat")).toEqual(["sat"]);
  });
});
