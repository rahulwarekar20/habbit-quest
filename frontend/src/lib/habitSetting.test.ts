import { describe, expect, it } from "vitest";
import { suggestHabitSetting } from "./habitSetting";

describe("local habit setting suggestions", () => {
  it.each([
    ["Bedtime is hard", "home"], ["Homework feels too big", "home"],
    ["Screen time is hard to stop", "online"], ["Homework in class is difficult", "school"],
    ["Screen time at home is difficult", "home"], ["We want to try outdoor play", "outdoors"],
    ["Waiting at the library is hard", "community"], ["After school homework", "home"],
  ])("suggests a setting from %s without a provider", (text, setting) => {
    expect(suggestHabitSetting(text).setting).toBe(setting);
  });
  it("uses category defaults only in supported source contexts", () => {
    expect(suggestHabitSetting("", "screen-balance").setting).toBe("online");
    expect(suggestHabitSetting("", "movement-play").setting).toBe("outdoors");
    expect(suggestHabitSetting("", "friendship-social-play").setting).toBe("community");
    expect(suggestHabitSetting("Screen time", "screen-balance", ["home", "school"]).setting).toBe("home");
    expect(suggestHabitSetting("", "learning-homework", ["school"]).setting).toBe("school");
  });
  it("keeps follow-ups in their existing setting but lets an explicit new topic change it", () => {
    expect(suggestHabitSetting("Something easier", "", undefined, "school").setting).toBe("school");
    expect(suggestHabitSetting("Now screen time", "", undefined, "school").setting).toBe("online");
  });
});
