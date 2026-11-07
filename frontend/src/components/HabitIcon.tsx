/** Only bundled Fluent keys can become image paths; old drafts retain a local fallback. */
export const HABIT_ICON_KEYS = ["sparkles", "star", "book", "books", "pencil", "backpack", "calendar", "clock", "alarm_clock", "sun", "moon", "bed", "toothbrush", "soap", "water", "plate", "apple", "basket", "broom", "socks", "door", "seedling", "ball", "bicycle", "puzzle", "art", "headphones", "speech_balloon", "heart", "rainbow", "compass", "light_bulb"];
const RULES: [RegExp, string][] = [
  [/tooth|brush.*teeth/i, "toothbrush"], [/wash|soap/i, "soap"], [/drink|water/i, "water"],
  [/food|meal|dinner|lunch|snack/i, "plate"], [/read|story|book/i, "book"],
  [/write|pencil|mark|draw/i, "pencil"], [/point|signal|choose|notice/i, "light_bulb"], [/question|ask|say|talk|tell/i, "speech_balloon"],
  [/pack|bag|school/i, "backpack"], [/tidy|clean|spill/i, "broom"], [/clothes|sock/i, "socks"],
  [/sleep|bed|rest/i, "bed"], [/screen|device|online|listen|music/i, "headphones"],
  [/play|ball|move|jump/i, "ball"], [/outside|garden|plant/i, "seedling"],
  [/plan|time|cue|routine/i, "calendar"], [/help|kind|friend|comfort/i, "heart"],
];
export function HabitIcon({ text, iconKey, className = "" }: { text: string; iconKey?: string; className?: string }) {
  const key = iconKey && HABIT_ICON_KEYS.includes(iconKey) && iconKey !== "sparkles" ? iconKey : RULES.find(([pattern]) => pattern.test(text))?.[1] ?? "sparkles";
  return <img className={`habit-fluent-icon ${className}`} src={`/fluent-emoji/${key}.svg`} width="112" height="112" alt="" aria-hidden="true" />;
}
