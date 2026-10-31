/** Labels for the reward shop and the buddy accessories found in treasure chests. Their rules live on the backend. */
import type { RewardKind } from "./api";

export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  screen: "Screen time", privilege: "Privilege", outing: "Family fun", toy: "Toy or treat", mystery: "Mystery",
};

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