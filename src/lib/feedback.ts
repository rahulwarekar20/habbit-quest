/**
 * Kid check-ins: the child tells their grown-ups how today went. They pick a mood face,
 * the trickiest and favourite quests (by picture), message stickers, and (optionally) type a
 * short note, which goes through the guardrails first (guardrails.ts and the agent server).
 * One check-in per child per day; a newer one replaces it.
 */
import type { Family } from "./family";
import type { SafetyCategory } from "./guardrails";

export type Mood = "great" | "good" | "okay" | "hard";

export const MOODS: { id: Mood; emoji: string; label: string }[] = [
  { id: "great", emoji: "🤩", label: "Super!" },
  { id: "good", emoji: "🙂", label: "Good" },
  { id: "okay", emoji: "😐", label: "Okay" },
  { id: "hard", emoji: "😣", label: "Tricky" },
];

/** Ready-made messages, so children who can't write yet can still tell their grown-ups something. */
export const STICKERS: { id: string; emoji: string; text: string }[] = [
  { id: "best", emoji: "💪", text: "I tried my best!" },
  { id: "proud", emoji: "🌟", text: "I'm proud of myself!" },
  { id: "help", emoji: "🙋", text: "I need some help" },
  { id: "together", emoji: "🤝", text: "Can we do it together?" },
  { id: "too-hard", emoji: "🧗", text: "A quest is too hard" },
  { id: "new-quest", emoji: "✨", text: "I want a new quest!" },
];

export interface Feedback {
  id: string;
  childId: string;
  day: string;
  at: string;
  mood: Mood;
  hardest: string | null; // quest id
  favorite: string | null; // quest id
  stickers: string[];
  note: string | null;
  /** Set when the note raised a safety concern; the parent sees an alert. */
  flagged: SafetyCategory | null;
  seen: boolean;
}

export type FeedbackInput = Pick<Feedback, "childId" | "day" | "mood" | "hardest" | "favorite" | "stickers" | "note" | "flagged">;

export function submitFeedback(family: Family, input: FeedbackInput, now = new Date()): Family {
  const entry: Feedback = {
    ...input,
    stickers: input.stickers.filter((s) => STICKERS.some((x) => x.id === s)),
    note: input.note?.trim().slice(0, 200) || null,
    id: `f${now.getTime().toString(36)}`,
    at: now.toISOString(),
    seen: false,
  };
  const others = family.feedback.filter((f) => !(f.childId === input.childId && f.day === input.day));
  return { ...family, feedback: [...others, entry].slice(-120) };
}

export const feedbackFor = (family: Family, childId: string, day: string) =>
  family.feedback.find((f) => f.childId === childId && f.day === day) ?? null;

export const unseenFeedback = (family: Family) => family.feedback.filter((f) => !f.seen);

export function markFeedbackSeen(family: Family): Family {
  return { ...family, feedback: family.feedback.map((f) => (f.seen ? f : { ...f, seen: true })) };
}
