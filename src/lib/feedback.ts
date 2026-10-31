/** The choices in a kid check-in. Check-ins are saved and screened on the backend. */
import type { Mood } from "./api";

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