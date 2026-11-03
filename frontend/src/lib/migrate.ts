/** Fills in fields added after a family was first saved, so older saved data keeps working. */
import { childDefaults, type Family } from "./family";

/** A family as saved by any version of the app: the original fields, plus whatever came later. */
export type SavedFamily = Pick<Family, "email" | "parentName" | "children" | "habits" | "habitsChosen" | "log" | "createdAt"> & Partial<Family>;

/**
 * Fills in every field added since a family was first saved, with its default, so older saved data still loads.
 */
export function normalizeFamily(f: SavedFamily): Family {
  return {
    ...f,
    settings: { appLimit: 0, buddyTalk: true, ...f.settings },
    children: f.children.map((c) => ({ ...childDefaults(), ...c, levelSeen: c.levelSeen ?? 1 })),
  };
}