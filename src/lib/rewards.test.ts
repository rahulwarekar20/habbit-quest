/** Points, levels, the shop, chests, surprises, playtime and guardrails. */
import { describe, expect, it } from "vitest";
import { acceptRecommendations, addRecommendations, aiState } from "./agents";
import {
  addBonusQuest, addChild, approveQuest, bonusQuestBlocker, boostFor, goldenQuest, levelOf, newChild, pointsFor, questsFor,
  streakOf, submitQuest, type Family,
} from "./family";
import { feedbackFor, submitFeedback } from "./feedback";
import { screenText } from "./guardrails";
import { addAppTime, appSecondsLeft, extendAppTime, setAppLimit } from "./playtime";
import { canOpenChest, dueSurprises, openChest, plantSurprise, requestReward, resolveRedemption, revealSurprise } from "./rewards";
import { emptyFamily } from "./testing";
import { lastDays } from "./time";

const DAY = "2026-10-27";
const at = (day: string) => new Date(`${day}T12:00:00`);

function family(age = 8): Family {
  return addChild(emptyFamily(), { ...newChild("Alex", age, "fox"), id: "a" });
}

const approve = (f: Family, day: string, quest: string) => approveQuest(submitQuest(f, day, "a", quest), day, "a", quest, at(day));
const child = (f: Family) => f.children[0];
const notGolden = (f: Family, day: string) => questsFor(f, "a").find((q) => q.id !== goldenQuest(f, day, "a"))!.id;

describe("points and multipliers", () => {
  it("pays 10 points for a tier-1 quest, 2x for the golden quest", () => {
    const f = family();
    const golden = goldenQuest(f, DAY, "a")!;
    expect(pointsFor(f, DAY, "a", notGolden(f, DAY))).toBe(10);
    expect(pointsFor(f, DAY, "a", golden)).toBe(20);
    const after = approve(f, DAY, golden);
    expect(child(after).points).toBe(20);
    expect(child(after).ledger.at(-1)).toMatchObject({ points: 20, kind: "earn", quest: golden });
  });

  it("adds 1x on day 3 of a streak and on a surprise double day, capped at 3x", () => {
    let f = family();
    const [d1, d2, d3] = lastDays(3, at(DAY));
    f = approve(f, d1, notGolden(f, d1));
    f = approve(f, d2, notGolden(f, d2));
    expect(streakOf(f, "a", d3)).toBe(2);
    const plain = notGolden(f, d3);
    expect(boostFor(f, d3, "a", plain)).toEqual({ multiplier: 2, reasons: ["streak"] });
    f = { ...f, doubleDays: [d3] };
    expect(boostFor(f, d3, "a", goldenQuest(f, d3, "a")!).multiplier).toBe(3);
  });

  it("the golden quest is stable for a day", () => {
    const f = family();
    expect(goldenQuest(f, DAY, "a")).toBe(goldenQuest(f, DAY, "a"));
  });
});

describe("levels and quest tiers", () => {
  it("levels up with Sparks", () => {
    expect(levelOf(0).name).toBe("Sprout");
    expect(levelOf(5)).toMatchObject({ level: 2, tier: 2 });
    expect(levelOf(15)).toMatchObject({ level: 3, tier: 3 });
  });

  it("locks higher tiers until the child reaches the level", () => {
    let f = family();
    expect(bonusQuestBlocker(f, "a", "make-bed")).toMatch(/level 2/);
    f = { ...f, children: [{ ...child(f), sparks: 5 }] };
    expect(bonusQuestBlocker(f, "a", "make-bed")).toBeNull();
  });

  it("respects age ranges and the 4-quest cap", () => {
    let f = family(4);
    expect(bonusQuestBlocker(f, "a", "read-20")).toMatch(/ages 6-13/);
    for (const q of ["brush-teeth", "water", "veggie", "toys-away"]) f = addBonusQuest(f, "a", q);
    expect(child(f).bonusQuests).toHaveLength(4);
    expect(bonusQuestBlocker(f, "a", "story-time")).toMatch(/4 bonus quests/);
  });

  it("bonus quests join the child's daily quests and pay by tier", () => {
    let f = { ...family(), children: [{ ...family().children[0], sparks: 15 }] };
    f = addBonusQuest(f, "a", "homework-start");
    expect(questsFor(f, "a").map((q) => q.id)).toContain("homework-start");
    expect([20, 40]).toContain(pointsFor(f, DAY, "a", "homework-start"));
  });

  it("coach recommendations are added only when accepted", () => {
    let f = addRecommendations(family(), [
      { childId: "a", questId: "brush-teeth", reason: "Gentle start" },
      { childId: "a", questId: "make-bed", reason: "Locked tier" },
    ]);
    expect(aiState(f).recommendations.map((r) => r.questId)).toEqual(["brush-teeth"]);
    expect(child(f).bonusQuests).toEqual([]);
    f = acceptRecommendations(f, [aiState(f).recommendations[0].id]);
    expect(child(f).bonusQuests).toEqual(["brush-teeth"]);
    expect(aiState(f).recommendations).toEqual([]);
  });
});

describe("reward shop", () => {
  const rich = () => ({ ...family(), children: [{ ...child(family()), points: 200 }] });

  it("holds points on request and refunds them when declined", () => {
    const { family: f, redemption } = requestReward(rich(), "a", "pick-dinner", DAY);
    expect(child(f).points).toBe(120);
    expect(redemption?.status).toBe("pending");
    const declined = resolveRedemption(f, redemption!.id, false);
    expect(child(declined).points).toBe(200);
    expect(declined.redemptions[0].status).toBe("declined");
  });

  it("adds screen-time minutes to the day when approved", () => {
    const { family: f, redemption } = requestReward(rich(), "a", "screen-15", DAY);
    const approved = resolveRedemption(f, redemption!.id, true);
    expect(child(approved).screenBonus[DAY]).toBe(15);
  });

  it("refuses when the child can't afford it", () => {
    const { error } = requestReward(family(), "a", "small-toy", DAY);
    expect(error).toMatch(/400 more points/);
  });

  it("mystery box jackpots pay out straight away", () => {
    const { family: f, redemption } = requestReward(rich(), "a", "mystery", DAY, () => 0.999);
    expect(redemption).toMatchObject({ title: "Jackpot! 100 points", status: "approved" });
    expect(child(f).points).toBe(200 - 40 + 100);
  });
});

describe("chest and surprises", () => {
  it("opens once, only after every quest is approved", () => {
    let f = family();
    expect(canOpenChest(f, "a", DAY)).toBe(false);
    for (const q of questsFor(f, "a")) f = approve(f, DAY, q.id);
    expect(canOpenChest(f, "a", DAY)).toBe(true);
    const { family: opened, prize } = openChest(f, "a", DAY, () => 0.1);
    expect(prize?.kind).toBe("accessory");
    expect(child(opened).wearing).toBe(child(opened).accessories[0]);
    expect(canOpenChest(opened, "a", DAY)).toBe(false);
  });

  it("delivers a surprise note with bonus points once", () => {
    let f = plantSurprise(family(), { childId: "all", kind: "note", message: "Proud of you!", points: 25, day: DAY });
    const [s] = dueSurprises(f, "a", DAY);
    f = revealSurprise(f, s.id, "a", DAY);
    f = revealSurprise(f, s.id, "a", DAY);
    expect(child(f).points).toBe(25);
    expect(dueSurprises(f, "a", DAY)).toEqual([]);
  });

  it("a double day shows up only on its day and boosts points", () => {
    const tomorrow = "2026-10-28";
    const f = plantSurprise(family(), { childId: "a", kind: "double", message: "", points: 50, day: tomorrow });
    expect(dueSurprises(f, "a", DAY)).toEqual([]);
    expect(dueSurprises(f, "a", tomorrow)).toHaveLength(1);
    expect(f.surprises[0].points).toBe(0);
    expect(boostFor(f, tomorrow, "a", notGolden(f, tomorrow)).reasons).toContain("double");
  });
});

describe("kid-mode time limit", () => {
  it("counts down and can be extended by a parent", () => {
    let f = setAppLimit(family(), 20);
    f = addAppTime(f, "a", DAY, 19 * 60);
    expect(appSecondsLeft(f, child(f), DAY)).toBe(60);
    f = addAppTime(f, "a", DAY, 120);
    expect(appSecondsLeft(f, child(f), DAY)).toBe(0);
    f = extendAppTime(f, "a", DAY, 10);
    expect(appSecondsLeft(f, child(f), DAY)).toBe(9 * 60);
  });

  it("has no limit by default", () => {
    expect(appSecondsLeft(family(), child(family()), DAY)).toBeNull();
  });
});

describe("guardrails and check-ins", () => {
  it("lets ordinary feelings through", () => {
    for (const t of ["I hate homework", "Bedtime is boring", "I was sad today", "We shot hoops after school", "football matches are fun"]) {
      expect(screenText(t).ok).toBe(true);
    }
  });

  it("blocks personal info and explicit words", () => {
    expect(screenText("call me on 07700 900123").category).toBe("personal-info");
    expect(screenText("my email is kid@example.com").category).toBe("personal-info");
    expect(screenText("I live at 12 Oak Street").category).toBe("personal-info");
    expect(screenText("that's shit").category).toBe("explicit");
  });

  it("flags risk instead of just blocking", () => {
    expect(screenText("I want to die")).toMatchObject({ category: "self-harm", risk: true });
    expect(screenText("he hits me when mum is out")).toMatchObject({ category: "abuse", risk: true });
  });

  it("keeps one check-in per child per day", () => {
    let f = submitFeedback(family(), { childId: "a", day: DAY, mood: "okay", hardest: "homework", favorite: null, stickers: ["help", "bogus"], note: null, flagged: null });
    f = submitFeedback(f, { childId: "a", day: DAY, mood: "great", hardest: null, favorite: "wake", stickers: [], note: "  Fun day!  ", flagged: null });
    expect(f.feedback).toHaveLength(1);
    expect(feedbackFor(f, "a", DAY)).toMatchObject({ mood: "great", note: "Fun day!" });
  });
});
