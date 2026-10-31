/**
 * Points and surprises: the reward shop, redemptions, the mystery chest, buddy accessories
 * and the surprises a parent can plant.
 *
 *   Shop        Parents price real-world rewards (extra screen time, picking dinner, a toy...).
 *               A child spends points to request one; the points are held, and a parent
 *               approves (with the PIN) or declines (points refunded). Approved screen-time
 *               rewards add minutes to that day's screen-time quest.
 *   Mystery box A cheap shop item with a random prize, sometimes a points jackpot.
 *   Chest       Finishing every quest in a day opens a chest: bonus points or a new buddy accessory.
 *   Surprises   A parent plants a note (with optional bonus points) or a double-points day;
 *               the child discovers it the next time they open kid mode.
 *
 * Randomness is passed in (`rng`) so tests can pin it down.
 */
import { allDone, creditPoints, updateChild, type Family } from "./family";

export type RewardKind = "screen" | "privilege" | "outing" | "toy" | "mystery";

export interface RewardItem {
  id: string;
  title: string;
  emoji: string;
  cost: number;
  kind: RewardKind;
  minutes?: number; // for screen-time rewards
}

export interface Redemption {
  id: string;
  childId: string;
  rewardId: string;
  title: string;
  emoji: string;
  cost: number;
  minutes?: number;
  status: "pending" | "approved" | "declined";
  day: string;
  at: string;
  mystery?: boolean;
  asked?: boolean; // a request paid from the backend balance: nothing is held, a parent records it
}

export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  screen: "Screen time", privilege: "Privilege", outing: "Family fun", toy: "Toy or treat", mystery: "Mystery",
};

export function defaultRewards(): RewardItem[] {
  return [
    { id: "mystery", title: "Mystery box", emoji: "🎁", cost: 40, kind: "mystery" },
    { id: "screen-15", title: "+15 minutes screen time", emoji: "📺", cost: 60, kind: "screen", minutes: 15 },
    { id: "pick-dinner", title: "Pick what's for dinner", emoji: "🍕", cost: 80, kind: "privilege" },
    { id: "screen-30", title: "+30 minutes screen time", emoji: "🎮", cost: 110, kind: "screen", minutes: 30 },
    { id: "late-bed", title: "Stay up 15 minutes later (weekend)", emoji: "🌙", cost: 120, kind: "privilege" },
    { id: "movie-night", title: "Choose the family movie", emoji: "🍿", cost: 150, kind: "outing" },
    { id: "park-trip", title: "Special trip to the park", emoji: "🛝", cost: 200, kind: "outing" },
    { id: "small-toy", title: "A new small toy", emoji: "🧸", cost: 400, kind: "toy" },
  ];
}

/** Prizes inside the mystery box. A jackpot pays points straight away; the rest need a grown-up. */
export const MYSTERY_PRIZES: { title: string; emoji: string; minutes?: number; jackpot?: number; weight: number }[] = [
  { title: "Extra bedtime story", emoji: "📖", weight: 3 },
  { title: "Dance party with a grown-up", emoji: "💃", weight: 3 },
  { title: "Build a blanket fort", emoji: "🏰", weight: 2 },
  { title: "Choose tomorrow's breakfast", emoji: "🥞", weight: 3 },
  { title: "+10 minutes screen time", emoji: "📺", minutes: 10, weight: 2 },
  { title: "Jackpot! 100 points", emoji: "💰", jackpot: 100, weight: 1 },
];

function pick<T extends { weight: number }>(items: T[], rng: () => number): T {
  let r = rng() * items.reduce((n, i) => n + i.weight, 0);
  for (const item of items) if ((r -= item.weight) < 0) return item;
  return items[items.length - 1];
}

const newId = (prefix: string, now: Date, rng: () => number) => `${prefix}${now.getTime().toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;

export type ShopResult = { family: Family; redemption: Redemption | null; error: string | null };

/** A child spends points on a reward. Points are held until a parent approves or declines. */
export function requestReward(family: Family, childId: string, rewardId: string, day: string, rng = Math.random, now = new Date()): ShopResult {
  const child = family.children.find((c) => c.id === childId);
  const reward = family.rewards.find((r) => r.id === rewardId);
  if (!child || !reward) return { family, redemption: null, error: "That reward isn't in the shop." };
  if (child.points < reward.cost) return { family, redemption: null, error: `You need ${reward.cost - child.points} more points.` };

  let item = { title: reward.title, emoji: reward.emoji, minutes: reward.minutes };
  let jackpot = 0;
  if (reward.kind === "mystery") {
    const prize = pick(MYSTERY_PRIZES, rng);
    item = { title: prize.title, emoji: prize.emoji, minutes: prize.minutes };
    jackpot = prize.jackpot ?? 0;
  }

  const redemption: Redemption = {
    id: newId("r", now, rng), childId, rewardId, ...item, cost: reward.cost, day, at: now.toISOString(),
    status: jackpot ? "approved" : "pending", mystery: reward.kind === "mystery",
  };
  let next = updateChild(family, childId, (c) => {
    const spent = creditPoints(c, -reward.cost, `${reward.title}`, "spend", day, now);
    return jackpot ? creditPoints(spent, jackpot, "Mystery box jackpot", "bonus", day, now) : spent;
  });
  next = { ...next, redemptions: [...next.redemptions, redemption].slice(-100) };
  return { family: next, redemption, error: null };
}

/**
 * A child asks a grown-up for a reward. The balance lives on the backend and only a parent can
 * spend it, so nothing is held here: the parent's "yes" records the redemption.
 */
export function askForReward(family: Family, childId: string, rewardId: string, day: string, rng = Math.random, now = new Date()): ShopResult {
  const child = family.children.find((c) => c.id === childId);
  const reward = family.rewards.find((r) => r.id === rewardId);
  if (!child || !reward) return { family, redemption: null, error: "That reward isn't in the shop." };
  if (child.balance < reward.cost) return { family, redemption: null, error: `You need ${reward.cost - child.balance} more points.` };
  const redemption: Redemption = {
    id: newId("r", now, rng), childId, rewardId, title: reward.title, emoji: reward.emoji, minutes: reward.minutes,
    cost: reward.cost, day, at: now.toISOString(), status: "pending", asked: true,
  };
  return { family: { ...family, redemptions: [...family.redemptions, redemption].slice(-100) }, redemption, error: null };
}

/** Parent approves (fulfils) or declines a request. Declining refunds held points. Approval must be PIN-checked by the caller. */
export function resolveRedemption(family: Family, id: string, approve: boolean, now = new Date()): Family {
  const r = family.redemptions.find((x) => x.id === id);
  if (!r || r.status !== "pending") return family;
  let next: Family = { ...family, redemptions: family.redemptions.map((x) => (x.id === id ? { ...x, status: approve ? "approved" : "declined" } : x)) };
  if (approve && r.minutes) {
    next = updateChild(next, r.childId, (c) => ({ ...c, screenBonus: { ...c.screenBonus, [r.day]: (c.screenBonus[r.day] ?? 0) + r.minutes! } }));
  }
  if (!approve && !r.asked) next = updateChild(next, r.childId, (c) => creditPoints(c, r.cost, `Refund: ${r.title}`, "refund", r.day, now));
  return next;
}

export const pendingRedemptions = (family: Family) => family.redemptions.filter((r) => r.status === "pending");

export function setGoal(family: Family, childId: string, rewardId: string | null): Family {
  return updateChild(family, childId, (c) => ({ ...c, goal: rewardId }));
}

// ── Buddy accessories and the daily chest ────────────────────────────────────

export const ACCESSORIES = [
  { id: "party-hat", name: "Party hat" },
  { id: "crown", name: "Golden crown" },
  { id: "shades", name: "Cool shades" },
  { id: "bow", name: "Big bow" },
  { id: "wizard", name: "Wizard hat" },
  { id: "flower", name: "Flower" },
  { id: "headphones", name: "Headphones" },
  { id: "halo", name: "Star halo" },
] as const;
export type AccessoryId = (typeof ACCESSORIES)[number]["id"];

export type ChestPrize = { kind: "points"; points: number } | { kind: "accessory"; id: AccessoryId; name: string };

export const canOpenChest = (family: Family, childId: string, day: string) =>
  allDone(family, day, childId) && !family.children.find((c) => c.id === childId)?.chests.includes(day);

/** Opens today's chest (once, after every quest is approved): a new accessory or 5-25 bonus points. */
export function openChest(family: Family, childId: string, day: string, rng = Math.random, now = new Date()): { family: Family; prize: ChestPrize | null } {
  const child = family.children.find((c) => c.id === childId);
  if (!child || !canOpenChest(family, childId, day)) return { family, prize: null };
  const unowned = ACCESSORIES.filter((a) => !child.accessories.includes(a.id));
  const prize: ChestPrize = unowned.length > 0 && rng() < 0.45
    ? (() => { const a = unowned[Math.floor(rng() * unowned.length)]; return { kind: "accessory", id: a.id, name: a.name }; })()
    : { kind: "points", points: 5 * (1 + Math.floor(rng() * 5)) };
  const next = updateChild(family, childId, (c) => {
    const opened = { ...c, chests: [...c.chests, day].slice(-30) };
    return prize.kind === "accessory"
      ? { ...opened, accessories: [...opened.accessories, prize.id], wearing: prize.id }
      : creditPoints(opened, prize.points, "Treasure chest", "bonus", day, now);
  });
  return { family: next, prize };
}

export function wear(family: Family, childId: string, accessory: string | null): Family {
  return updateChild(family, childId, (c) => (accessory === null || c.accessories.includes(accessory) ? { ...c, wearing: accessory } : c));
}

// ── Parent surprises ──────────────────────────────────────────────────────────

export interface Surprise {
  id: string;
  childId: string | "all";
  kind: "note" | "double";
  message: string;
  points: number; // bonus points for a note (0-100)
  day: string; // for "double": the double-points day; for "note": the day it was planted
  createdAt: string;
  revealedBy: string[]; // child ids who have opened it
}

export const MAX_SURPRISE_POINTS = 100;

export function plantSurprise(
  family: Family,
  input: Pick<Surprise, "childId" | "kind" | "message" | "points" | "day">,
  rng = Math.random,
  now = new Date(),
): Family {
  const surprise: Surprise = {
    ...input,
    message: input.message.trim().slice(0, 140),
    points: input.kind === "note" ? Math.max(0, Math.min(MAX_SURPRISE_POINTS, Math.round(input.points))) : 0,
    id: newId("s", now, rng),
    createdAt: now.toISOString(),
    revealedBy: [],
  };
  return {
    ...family,
    surprises: [...family.surprises, surprise].slice(-50),
    doubleDays: input.kind === "double" ? [...new Set([...family.doubleDays, input.day])] : family.doubleDays,
  };
}

/** Surprises waiting for this child today (double days show on their day, notes straight away). */
export function dueSurprises(family: Family, childId: string, day: string): Surprise[] {
  return family.surprises.filter(
    (s) => (s.childId === "all" || s.childId === childId) && !s.revealedBy.includes(childId) && (s.kind === "note" ? s.day <= day : s.day === day)
  );
}

export function revealSurprise(family: Family, id: string, childId: string, day: string, now = new Date()): Family {
  const s = family.surprises.find((x) => x.id === id);
  if (!s || s.revealedBy.includes(childId)) return family;
  const next = { ...family, surprises: family.surprises.map((x) => (x.id === id ? { ...x, revealedBy: [...x.revealedBy, childId] } : x)) };
  return s.points > 0 ? updateChild(next, childId, (c) => creditPoints(c, s.points, "Surprise from a grown-up", "bonus", day, now)) : next;
}
