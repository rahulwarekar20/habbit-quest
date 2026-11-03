/** Test helper: a fresh family with default routine habits and no children. */
import { defaultHabits, type Family } from "./family";
import { normalizeFamily } from "./migrate";

/** A family with no children, for tests. */
export function emptyFamily(): Family {
  return normalizeFamily({
    email: "p@example.com", parentName: "Pat", children: [],
    habits: defaultHabits(), habitsChosen: true, log: {}, createdAt: "",
  });
}
