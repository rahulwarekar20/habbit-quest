/**
 * Guardrails, first layer: fast local checks shared by the browser and the agent server.
 * HabbitQuest is for children aged 3 to 13, so everything a child reads or writes goes
 * through these checks.
 *
 *   - Kid-written text (notes to grown-ups): personal info (phone, email, address, links) and
 *     explicit language are blocked before saving. Signs that a child may be unsafe or hurting
 *     are never silently dropped: the note is kept, flagged for the parent, and the child sees
 *     a gentle "talk to a grown-up you trust" message.
 *   - AI text shown to a child (buddy lines): anything flagged is replaced with a safe built-in line.
 *   - Parent messages to the coach: risk signals add safety guidance to the coach's reply.
 *
 * The agent server adds a second layer: an AI safety classifier (server/guardrails.ts) that
 * catches what word lists can't. These lists are deliberately conservative, not exhaustive.
 */

export type SafetyCategory =
  | "personal-info"   // phone numbers, emails, addresses, links
  | "explicit"        // swearing or sexual content
  | "violence"        // weapons or hurting others
  | "self-harm"       // a child may be hurting themselves
  | "abuse"           // a child may be hurt or unsafe
  | "unkind"          // insults and bullying
  | "unsafe-advice";  // dangerous activities, drugs, alcohol

export interface ScreenResult {
  ok: boolean; // safe to show or save as-is
  category: SafetyCategory | null;
  /** True when a grown-up should know (self-harm or abuse signals). */
  risk: boolean;
}

export interface SafetyEvent {
  id: string;
  at: string;
  source: "kid-note" | "buddy" | "coach" | "surprise";
  childId?: string;
  category: SafetyCategory;
  action: "blocked" | "flagged" | "replaced";
  /** Kept only for flagged risk notes, so the parent can follow up. */
  excerpt?: string;
}

const words = (list: string[]) => new RegExp(`\\b(?:${list.join("|")})\\b`, "i");

const PATTERNS: { category: SafetyCategory; test: RegExp; risk?: boolean }[] = [
  { category: "self-harm", risk: true, test: /\b(?:kill|hurt|cut|harm)(?:ing)? my ?self\b|\bwant(?:s)? to die\b|\bsuicid|\bend my life\b|\bdon'?t want to (?:live|be alive)\b|\bno ?one (?:would )?cares? if i\b/i },
  { category: "abuse", risk: true, test: /\b(?:hits?|hurts?|touch(?:es|ed)?|beats?|hit|kicked|slapped) me\b|\bi(?:'m| am) (?:scared|afraid) (?:of|at) (?:home|my|him|her|them)\b|\bkeep (?:it|this) (?:a )?secret\b|\bsecret from (?:mum|mom|dad|my parents)\b/i },
  { category: "personal-info", test: /[\w.+-]+@[\w-]+\.[\w.]+|\b(?:https?:\/\/|www\.)\S+|\+?\d[\d\s().-]{7,}\d|\b\d{1,5}\s+\w+(?:\s\w+)?\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|way|court|ct)\b|\bmy (?:address|password|phone number) is\b/i },
  { category: "explicit", test: words(["fuck\\w*", "shit\\w*", "bitch\\w*", "asshole\\w*", "bastard\\w*", "cunt\\w*", "porn\\w*", "sexy", "sex", "nude\\w*", "naked"]) },
  { category: "violence", test: words(["guns?", "knife", "knives", "stab(?:bed|bing|s)?", "shoot (?:him|her|them|you|people)", "murder\\w*", "kill (?:him|her|them|you)", "bombs?"]) },
  { category: "unsafe-advice", test: words(["alcohol", "beer", "wine", "vodka", "drunk", "cigarette\\w*", "vape\\w*", "drugs?", "weed", "pills"]) },
  { category: "unkind", test: words(["stupid", "idiot\\w*", "dumb", "loser\\w*", "ugly", "fat", "shut up", "i hate you", "hate (?:him|her|them)"]) },
];

/** Screens text locally. Order matters: risk signals are checked first so they're never masked. */
export function screenText(text: string): ScreenResult {
  for (const p of PATTERNS) {
    if (p.test.test(text)) return { ok: false, category: p.category, risk: !!p.risk };
  }
  return { ok: true, category: null, risk: false };
}

export const KID_SAFETY_MESSAGE =
  "Thank you for telling us. Please talk to a grown-up you trust, like a parent, teacher or school counsellor. You can always ask for help.";

export const KID_BLOCKED_MESSAGE: Record<SafetyCategory, string> = {
  "personal-info": "Let's keep phone numbers, emails, addresses and links private. Try saying it another way!",
  explicit: "Hmm, let's use kind and friendly words. Try again!",
  violence: "Let's keep our notes calm and safe. Try saying it another way!",
  unkind: "Let's use kind words, even when we feel upset. Try again!",
  "unsafe-advice": "Let's keep our notes about safe things. Try again!",
  "self-harm": KID_SAFETY_MESSAGE,
  abuse: KID_SAFETY_MESSAGE,
};

/** Coach guidance added when a parent's message suggests a child may be at risk. */
export const PARENT_RISK_GUIDANCE =
  "If a child may be in danger or talking about hurting themselves, please contact your local emergency number now, or a children's helpline or your doctor. HabbitQuest can help with everyday habits, but not with emergencies.";

export function safetyEvent(e: Omit<SafetyEvent, "id" | "at">, now = new Date()): SafetyEvent {
  return { ...e, id: `x${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: now.toISOString() };
}
