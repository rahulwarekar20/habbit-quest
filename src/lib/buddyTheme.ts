/**
 * What a child's buddy changes in kid mode: the confetti, the prints on the path and the words it
 * uses. Colours live in styles.css under `.page--kid[data-buddy]`. Parent screens are unaffected.
 */
import type { BuddyId } from "./family";

interface BuddyTheme {
  confetti: string;
  print: string;
  /** Nudges towards the next find, where {n} is the Sparks still to go. */
  nudge: string;
  welcomeBack: string;
  waiting: string; // a landmark is ready to open
}

export const BUDDY_THEME: Record<BuddyId, BuddyTheme> = {
  bunny: {
    confetti: "🥕", print: "🐇",
    nudge: "Hop hop! I can see something up ahead. {n} more Sparks and we'll reach it!",
    welcomeBack: "You're back! I saved your spot in the burrow. Today's quests earn extra points.",
    waiting: "Quick, quick! We reached something new. Let's go and look!",
  },
  fox: {
    confetti: "🍂", print: "🐾",
    nudge: "My nose is twitching! Something is hiding {n} Sparks away.",
    welcomeBack: "There you are! I kept the den warm. Today's quests earn extra points.",
    waiting: "I sniffed out something new. Come and see!",
  },
  owl: {
    confetti: "⭐", print: "🪶",
    nudge: "Hoo! From up high I spotted something {n} Sparks ahead.",
    welcomeBack: "Welcome back! I kept watch while you were away. Today's quests earn extra points.",
    waiting: "Hoo hoo! I spotted something new on the path!",
  },
  bear: {
    confetti: "🍯", print: "🐾",
    nudge: "I smell an adventure! It's {n} Sparks down the path.",
    welcomeBack: "Big bear hug! I saved your spot. Today's quests earn extra points.",
    waiting: "We made it to something new! Let's take a look.",
  },
};

export function buddyNudge(buddy: BuddyId, sparksToGo: number): string {
  return BUDDY_THEME[buddy].nudge.replace("{n}", String(sparksToGo));
}
