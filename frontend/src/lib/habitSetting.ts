/** Local setting suggestions. Explicit places beat topics; canonical contexts constrain goals. */
import type { HabitSetting } from "./api/types";

export const HABIT_SETTINGS: HabitSetting[] = ["home", "school", "community", "outdoors", "online"];
export const SETTING_LABELS: Record<HabitSetting, string> = { home: "Home", school: "School", community: "Community", outdoors: "Outdoors", online: "Online" };

const EXPLICIT: [RegExp, HabitSetting, string][] = [
  [/\b(at home|in (our|the) (house|kitchen|bedroom))\b/i, "home", "Your message mentions being at home."],
  [/\b(at school|in (the )?class(room)?|during class|school lunch)\b/i, "school", "Your message mentions school or the classroom."],
  [/\b(outdoors|outside|at (the )?park|on (a )?walk)\b/i, "outdoors", "Your message mentions an outdoor activity."],
  [/\b(at (the )?(library|shop|store|club)|community cent(er|re))\b/i, "community", "Your message mentions a shared place in the community."],
  [/\b(online|video call|internet)\b/i, "online", "Your message mentions an online activity."],
];
const TOPICS: [RegExp, HabitSetting, string][] = [
  [/\b(homework|bedtime|breakfast|dinner|toothbrushing|brush.{0,12}teeth|tidy|after school)\b/i, "home", "This sounds like a home routine."],
  [/\b(screen ?time|tablet|video game|gaming|device|social media)\b/i, "online", "This habit involves screens or digital activities."],
  [/\b(classroom|teacher|school|classmates)\b/i, "school", "This sounds like a school activity."],
  [/\b(playground|cycling|biking|garden|outdoor play)\b/i, "outdoors", "This activity usually happens outdoors."],
  [/\b(library|club|shop|store|community)\b/i, "community", "This sounds like an activity in the community."],
];

export function suggestHabitSetting(text = "", category = "", contexts: readonly string[] = HABIT_SETTINGS, preferred?: HabitSetting) {
  const allowed = HABIT_SETTINGS.filter((setting) => contexts.includes(setting));
  for (const [pattern, setting, rationale] of [...EXPLICIT, ...TOPICS]) {
    if (pattern.test(text) && allowed.includes(setting)) return { setting, rationale };
  }
  if (preferred && allowed.includes(preferred)) return { setting: preferred, rationale: "Keeping the setting from this conversation or goal." };
  const categoryDefault: HabitSetting = category === "screen-balance" ? "online"
    : category === "movement-play" ? "outdoors" : category === "friendship-social-play" ? "community" : "home";
  const setting = allowed.includes(categoryDefault) ? categoryDefault : allowed[0] ?? "home";
  const rationale = categoryDefault === setting && category ? {
    home: "A familiar home setting is a starting place for this habit.",
    online: "Digital-balance habits usually involve online or screen activities.",
    outdoors: "Movement and play often fit an outdoor setting.",
    community: "Social-play habits can fit shared community activities.",
    school: "This goal fits a school setting.",
  }[setting] : contexts.length < HABIT_SETTINGS.length ? "Using a setting supported by this goal." : "Start at home, or describe the activity to suggest a setting.";
  return { setting, rationale };
}
