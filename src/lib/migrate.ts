/** Fills in fields added after a family was first saved, so older saved data keeps working. */
import { childDefaults, levelOf, type Family } from "./family";
import { defaultRewards } from "./rewards";

/** A family as saved by any version of the app: the original fields, plus whatever came later. */
export type SavedFamily = Pick<Family, "email" | "parentName" | "passwordHash" | "pinHash" | "children" | "habits" | "habitsChosen" | "log" | "createdAt"> & Partial<Family>;

export function normalizeFamily(f: SavedFamily): Family {
  return {
    ...f,
    settings: f.settings ?? { appLimit: 0 },
    rewards: f.rewards ?? defaultRewards(),
    redemptions: f.redemptions ?? [],
    feedback: f.feedback ?? [],
    surprises: f.surprises ?? [],
    doubleDays: f.doubleDays ?? [],
    safety: f.safety ?? [],
    children: f.children.map((c) => ({ ...childDefaults(), ...c, levelSeen: c.levelSeen ?? levelOf(c.sparks ?? 0).level })),
  };
}
