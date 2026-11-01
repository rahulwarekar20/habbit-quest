import { describe, expect, it } from "vitest";
import type { JourneyWorld } from "./api";
import { landmarkState, positionAt, prints, readyLandmarks, trail } from "./journeyPath";

const mark = (id: string, sparks: number, x: number, y: number) => ({ id, name: id, emoji: "⭐", sparks, x, y });
const camp: JourneyWorld = {
  id: "camp", name: "Camp", sparks: 0, rank: "Sprout", tier: 1, blurb: "",
  landmarks: [mark("a", 10, 29, 86), mark("b", 20, 29, 46)],
};

describe("the world path", () => {
  it("places the buddy between stops, and stops it at each end", () => {
    expect(positionAt(camp, 0)).toEqual({ x: 9, y: 86 });
    expect(positionAt(camp, 5)).toEqual({ x: 19, y: 86 });
    expect(positionAt(camp, 15)).toEqual({ x: 29, y: 66 });
    expect(positionAt(camp, 99)).toEqual({ x: 29, y: 46 });
    expect(positionAt({ ...camp, sparks: 30, landmarks: [mark("c", 40, 50, 50)] }, 2)).toEqual({ x: 9, y: 86 });
  });

  it("gives each landmark its state", () => {
    const [first, second] = camp.landmarks;
    expect(landmarkState(camp, first, 10, ["camp:a"])).toBe("found");
    expect(landmarkState(camp, first, 10, [])).toBe("ready");
    expect(landmarkState(camp, second, 10, [])).toBe("hidden");
  });

  it("lists what is waiting to be opened", () => {
    expect(readyLandmarks([camp], 20, ["camp:a"]).map((r) => r.mark.id)).toEqual(["b"]);
    expect(readyLandmarks([camp], 5, [])).toEqual([]);
  });

  it("splits the trail into walked and waiting steps", () => {
    const parts = trail(camp, 5, 10);
    expect(parts.all).toBe("9,86 29,86 29,46");
    expect(parts.walked).toBe("9,86 19,86");
    expect(parts.waiting).toBe("19,86 29,86 29,66");
  });

  it("leaves prints only on the walked part", () => {
    expect(prints(camp, 7)).toHaveLength(2);
    expect(prints(camp, 999).length).toBeLessThan(7);
  });
});
