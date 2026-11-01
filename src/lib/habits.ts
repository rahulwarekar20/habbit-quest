/**
 * Habit catalog.
 *
 * Routine habits (HABITS) are the family's daily rhythm: wake-up, meals, homework, screen time
 * and bedtime, with times the parent sets. They apply to every child.
 *
 * Bonus quests (LIBRARY) are extra habits added per child, by the parent or on the habit
 * coach's recommendation. Each one has a tier: tier 1 quests are open from the start, and
 * harder tier 2 and tier 3 quests unlock as the child levels up (see the worlds in family.ts).
 * Higher tiers are worth more points. Each quest also has an age range (3 to 13).
 */

export type HabitId = "wake" | "lunch" | "homework" | "screen" | "dinner" | "bedtime";
export type Tier = 1 | 2 | 3;
export type Category = "routine" | "sleep" | "health" | "learning" | "home" | "kindness" | "feelings" | "active" | "screen";

export type HabitSettingSpec =
  | { kind: "time"; label: string; default: string }
  | { kind: "minutes"; label: string; default: string; options: number[] }
  | { kind: "none" };

/** Anything a child can do as a daily quest. */
export interface QuestDef {
  id: string;
  parentTitle: string;
  description: string;
  kidTitle: string;
  kidHint: string;
  setting: HabitSettingSpec;
  tier: Tier;
  category: Category;
  emoji: string;
  ages: [number, number];
  routine: boolean;
}

export interface Habit extends QuestDef {
  id: HabitId;
}

export const MIN_AGE = 3;
export const MAX_AGE = 13;

const routine = { tier: 1 as Tier, category: "routine" as Category, ages: [MIN_AGE, MAX_AGE] as [number, number], routine: true };

export const HABITS: Habit[] = [
  {
    ...routine,
    id: "wake",
    emoji: "🌅",
    parentTitle: "Wake up early",
    description: "A calm, unhurried start: up and out of bed by the time you choose.",
    kidTitle: "Rise and shine!",
    kidHint: "Hop out of bed when the sun says hello",
    setting: { kind: "time", label: "Wake up by", default: "07:00" },
  },
  {
    ...routine,
    id: "lunch",
    emoji: "🍱",
    parentTitle: "Finish lunch on time",
    description: "Sit down and finish lunch without a long chase around the table.",
    kidTitle: "Yummy lunch",
    kidHint: "Finish your lunch plate",
    setting: { kind: "time", label: "Finish lunch by", default: "13:30" },
  },
  {
    ...routine,
    id: "homework",
    emoji: "📒",
    parentTitle: "Complete homework daily",
    description: "Homework finished every school day, before play time takes over.",
    kidTitle: "Homework hero",
    kidHint: "Finish today's homework",
    setting: { kind: "none" },
  },
  {
    ...routine,
    id: "screen",
    emoji: "📱",
    parentTitle: "Reduce screen time",
    description: "Stay within a daily screen-time limit across TV, tablet and games.",
    kidTitle: "Screen-time saver",
    kidHint: "Keep screens short and play more",
    setting: { kind: "minutes", label: "Daily limit", default: "60", options: [30, 45, 60, 90, 120] },
  },
  {
    ...routine,
    id: "dinner",
    emoji: "🍲",
    parentTitle: "Finish dinner on time",
    description: "Family dinner finished on time, so the evening routine stays relaxed.",
    kidTitle: "Dinner done",
    kidHint: "Finish your dinner plate",
    setting: { kind: "time", label: "Finish dinner by", default: "20:00" },
  },
  {
    ...routine,
    id: "bedtime",
    emoji: "🌙",
    parentTitle: "Get to bed early",
    description: "Teeth brushed and in bed by bedtime, for a good night's sleep.",
    kidTitle: "Sleepy time",
    kidHint: "Snuggle into bed on time",
    setting: { kind: "time", label: "In bed by", default: "21:00" },
  },
];

export const HABIT_BY_ID = Object.fromEntries(HABITS.map((h) => [h.id, h])) as Record<HabitId, Habit>;

type LibraryEntry = Omit<QuestDef, "setting" | "routine">;
const bonus = (q: LibraryEntry): QuestDef => ({ ...q, setting: { kind: "none" }, routine: false });

export const LIBRARY: QuestDef[] = [
  // ── Tier 1: small, concrete steps (open from the start) ──
  bonus({ id: "brush-teeth", tier: 1, category: "health", emoji: "🪥", ages: [3, 13], parentTitle: "Brush teeth morning and night", description: "Two minutes, twice a day, without a battle.", kidTitle: "Sparkly teeth", kidHint: "Brush in the morning and at night" }),
  bonus({ id: "wash-hands", tier: 1, category: "health", emoji: "🧼", ages: [3, 10], parentTitle: "Wash hands before meals", description: "Soap and water before every meal and after the bathroom.", kidTitle: "Bubble hands", kidHint: "Wash with soap before you eat" }),
  bonus({ id: "toys-away", tier: 1, category: "home", emoji: "🧸", ages: [3, 10], parentTitle: "Tidy toys after play", description: "Toys go back where they live when play is over.", kidTitle: "Toy tidy-up", kidHint: "Put your toys back home" }),
  bonus({ id: "water", tier: 1, category: "health", emoji: "💧", ages: [3, 13], parentTitle: "Drink water with meals", description: "A glass of water with each meal instead of sweet drinks.", kidTitle: "Water power", kidHint: "Drink water with every meal" }),
  bonus({ id: "veggie", tier: 1, category: "health", emoji: "🥦", ages: [3, 13], parentTitle: "Try a vegetable", description: "One brave bite of a vegetable each day, no pressure to finish.", kidTitle: "Veggie explorer", kidHint: "Take one brave bite of a veggie" }),
  bonus({ id: "dress-self", tier: 1, category: "home", emoji: "👕", ages: [3, 8], parentTitle: "Get dressed independently", description: "Getting dressed without help, to build independence in the morning.", kidTitle: "Dress-up champ", kidHint: "Put on your clothes all by yourself" }),
  bonus({ id: "magic-words", tier: 1, category: "kindness", emoji: "🙏", ages: [3, 10], parentTitle: "Say please and thank you", description: "Using polite words with family, friends and teachers.", kidTitle: "Magic words", kidHint: "Say please and thank you" }),
  bonus({ id: "story-time", tier: 1, category: "learning", emoji: "📖", ages: [3, 13], parentTitle: "Share a book every day", description: "Reading together or alone, every day, even for a few minutes.", kidTitle: "Story time", kidHint: "Read a book or listen to a story" }),
  bonus({ id: "outdoor-play", tier: 1, category: "active", emoji: "⚽", ages: [3, 13], parentTitle: "Play outside", description: "Time outdoors running, climbing or exploring.", kidTitle: "Outside adventure", kidHint: "Run, jump and play outside" }),
  bonus({ id: "name-feeling", tier: 1, category: "feelings", emoji: "😊", ages: [3, 10], parentTitle: "Name a feeling", description: "Putting feelings into words helps children handle big emotions.", kidTitle: "Feelings check", kidHint: "Tell someone how you feel today" }),
  bonus({ id: "tidy-space", tier: 1, category: "home", emoji: "🧹", ages: [3, 13], parentTitle: "Tidy your space", description: "A quick tidy of a room or desk.", kidTitle: "Tidy space", kidHint: "Tidy up your space" }),
  bonus({ id: "day-chat", tier: 1, category: "feelings", emoji: "💬", ages: [3, 13], parentTitle: "Chat about the day", description: "A few minutes talking about how the day went.", kidTitle: "Day chat", kidHint: "Tell a grown-up about your day" }),
  // ── Tier 2: a bit more responsibility (unlocks at level 2) ──
  bonus({ id: "make-bed", tier: 2, category: "home", emoji: "🛏️", ages: [5, 13], parentTitle: "Make the bed", description: "Pull up the covers and straighten the pillow every morning.", kidTitle: "Bed builder", kidHint: "Pull up the covers and fluff your pillow" }),
  bonus({ id: "pack-bag", tier: 2, category: "learning", emoji: "🎒", ages: [5, 13], parentTitle: "Pack the school bag the night before", description: "A calmer morning starts with the bag packed the evening before.", kidTitle: "Bag ready", kidHint: "Pack your bag for tomorrow" }),
  bonus({ id: "set-table", tier: 2, category: "home", emoji: "🍽️", ages: [4, 13], parentTitle: "Help set the table", description: "Helping with family meals builds teamwork.", kidTitle: "Table helper", kidHint: "Help set the table for a meal" }),
  bonus({ id: "calm-breaths", tier: 2, category: "feelings", emoji: "🌬️", ages: [4, 13], parentTitle: "Calm-down breathing", description: "Five slow breaths when upset, a simple tool for big feelings.", kidTitle: "Dragon breaths", kidHint: "Take 5 slow dragon breaths when you feel upset" }),
  bonus({ id: "kind-act", tier: 2, category: "kindness", emoji: "💛", ages: [4, 13], parentTitle: "One kind act a day", description: "Helping, sharing or including someone, once a day.", kidTitle: "Kindness mission", kidHint: "Help someone or share something" }),
  bonus({ id: "answer-call", tier: 1, category: "feelings", emoji: "👂", ages: [3, 13], parentTitle: "Answer when called", description: "Stopping, looking up and answering the first time a grown-up calls.", kidTitle: "Super ears", kidHint: "Look up and say \"okay\" when a grown-up calls you" }),
  bonus({ id: "first-ask", tier: 1, category: "feelings", emoji: "✅", ages: [3, 13], parentTitle: "Do one ask the first time", description: "Doing one instruction after being asked once, with no reminder.", kidTitle: "First-time listener", kidHint: "Do one thing the first time you are asked" }),
  bonus({ id: "say-it-back", tier: 1, category: "feelings", emoji: "🦜", ages: [4, 13], parentTitle: "Say the instruction back", description: "Repeating an instruction in their own words, to show it was heard.", kidTitle: "Echo power", kidHint: "Say back what the grown-up asked you to do" }),
  bonus({ id: "not-fun-first", tier: 2, category: "feelings", emoji: "💪", ages: [5, 13], parentTitle: "Do the not-fun ask right away", description: "Doing one uninteresting job when asked, before going back to play.", kidTitle: "Boring-job beater", kidHint: "Do a not-fun job when asked, then go back to play" }),
  bonus({ id: "two-step-ask", tier: 3, category: "feelings", emoji: "👣", ages: [6, 13], parentTitle: "Finish a two-step ask", description: "Remembering and finishing two steps with no reminder.", kidTitle: "Two-step star", kidHint: "Finish both steps of an ask without a reminder" }),
  bonus({ id: "read-20", tier: 2, category: "learning", emoji: "📚", ages: [6, 13], parentTitle: "Read for 20 minutes", description: "Twenty minutes of reading builds a lasting reading habit.", kidTitle: "Reading quest", kidHint: "Read for 20 minutes" }),
  bonus({ id: "screen-switch-off", tier: 2, category: "screen", emoji: "⏰", ages: [4, 13], parentTitle: "Switch off screens when time is up", description: "Turning the screen off when the timer rings, without a fuss.", kidTitle: "Screen switch-off", kidHint: "Turn off the screen when the timer rings" }),
  bonus({ id: "move-30", tier: 2, category: "active", emoji: "🤸", ages: [4, 13], parentTitle: "Active play for 30 minutes", description: "Half an hour of dancing, biking or running games.", kidTitle: "Move and groove", kidHint: "Dance, bike or play for 30 minutes" }),
  bonus({ id: "laundry", tier: 2, category: "home", emoji: "🧺", ages: [4, 13], parentTitle: "Clothes in the laundry basket", description: "Dirty clothes go in the basket, not on the floor.", kidTitle: "Laundry hoop", kidHint: "Toss your clothes in the basket" }),
  bonus({ id: "screen-sunset", tier: 2, category: "sleep", emoji: "🌇", ages: [5, 13], parentTitle: "No screens an hour before bed", description: "Screens off an hour before bedtime helps children fall asleep.", kidTitle: "Screen sunset", kidHint: "Screens off one hour before bed" }),
  bonus({ id: "family-table", tier: 2, category: "screen", emoji: "🥗", ages: [3, 13], parentTitle: "Device-free family meal", description: "One meal a day together with no phones, tablets or TV.", kidTitle: "Family table", kidHint: "Eat together with no screens" }),
  // ── Tier 3: independence and self-management (unlocks at level 3) ──
  bonus({ id: "homework-start", tier: 3, category: "learning", emoji: "📝", ages: [7, 13], parentTitle: "Start homework without reminders", description: "Getting started on homework without being asked.", kidTitle: "Self-starter", kidHint: "Start your homework all by yourself" }),
  bonus({ id: "practice", tier: 3, category: "learning", emoji: "🎹", ages: [6, 13], parentTitle: "Practise a skill for 15 minutes", description: "Music, sport, art or anything they're learning, a little every day.", kidTitle: "Skill builder", kidHint: "Practise music, sport or art for 15 minutes" }),
  bonus({ id: "caretaker", tier: 3, category: "home", emoji: "🐾", ages: [5, 13], parentTitle: "Care for a pet or plant", description: "Feeding a pet or watering a plant, every day.", kidTitle: "Caretaker", kidHint: "Feed a pet or water a plant" }),
  bonus({ id: "day-diary", tier: 3, category: "feelings", emoji: "✏️", ages: [6, 13], parentTitle: "Draw or write about the day", description: "A few lines or a drawing about the day helps with reflection.", kidTitle: "Day diary", kidHint: "Draw or write about today" }),
  bonus({ id: "chore-champion", tier: 3, category: "home", emoji: "🧽", ages: [6, 13], parentTitle: "Finish a chore independently", description: "One household chore done start to finish without help.", kidTitle: "Chore champion", kidHint: "Finish one chore without help" }),
  bonus({ id: "happy-three", tier: 3, category: "feelings", emoji: "🌟", ages: [5, 13], parentTitle: "Share three good things", description: "Naming three good things about the day builds a positive outlook.", kidTitle: "Happy three", kidHint: "Tell three good things about today" }),
  bonus({ id: "plan-tomorrow", tier: 3, category: "learning", emoji: "🗓️", ages: [8, 13], parentTitle: "Plan for tomorrow", description: "Clothes picked and tomorrow's plan checked the evening before.", kidTitle: "Tomorrow planner", kidHint: "Pick your clothes and plan tomorrow" }),
];

export const ALL_QUESTS: QuestDef[] = [...HABITS, ...LIBRARY];
export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(ALL_QUESTS.map((q) => [q.id, q]));
export const LIBRARY_IDS = LIBRARY.map((q) => q.id);

export const isHabitId = (id: string): id is HabitId => id in HABIT_BY_ID;

export const fitsAge = (q: QuestDef, age: number) => age >= q.ages[0] && age <= q.ages[1];

export const CATEGORY_LABEL: Record<Category, string> = {
  routine: "Daily routine", sleep: "Sleep", health: "Healthy body", learning: "Learning", home: "Helping at home",
  kindness: "Kindness", feelings: "Feelings", active: "Active play", screen: "Screen balance",
};
