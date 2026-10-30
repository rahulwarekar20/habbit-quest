/**
 * Retrieval for the habit coach (the "R" in RAG).
 *
 *   searchGuidance  BM25 over the parenting knowledge base (knowledge.ts), split into one chunk
 *                   per "## " section. Each chunk has a short stable reference (G1, G2...) that
 *                   the coach cites inline, and the app turns back into source titles.
 *   searchHabits    BM25 over the quest library (src/lib/habits.ts), filtered to quests that fit
 *                   the child's age and the tiers they have unlocked.
 *
 * Lexical search keeps this dependency-free and deterministic. A small synonym map bridges
 * how parents describe problems ("iPad", "meltdown") and how the guidance is written.
 */
import { CATEGORY_LABEL, LIBRARY, fitsAge, type QuestDef } from "../src/lib/habits";
import { KNOWLEDGE } from "./knowledge";

const STOP = new Set(
  "a an and are as at be but by can do does for from has have he her his how i if in into is it its me my of on or our she so that the their them they this to too us was we when with won't wont doesn't dont don't just very really child kid kids son daughter".split(" ")
);

const SYNONYMS: Record<string, string[]> = {
  tv: ["screen"], tablet: ["screen"], ipad: ["screen"], phone: ["screen"], game: ["screen"], video: ["screen"], youtube: ["screen"], device: ["screen"],
  meltdown: ["tantrum", "feelings"], tantrum: ["feelings", "calm"], angry: ["feelings", "calm"], upset: ["feelings", "calm"], cry: ["feelings"], scream: ["tantrum", "calm"],
  bed: ["sleep", "bedtime"], night: ["sleep", "bedtime"], tired: ["sleep"], late: ["sleep", "bedtime"], wake: ["morning"],
  picky: ["tasting", "food"], vegetable: ["veggie", "tasting"], eat: ["food", "meal"], dinner: ["meal"], lunch: ["meal"],
  messy: ["tidy", "chores"], mess: ["tidy", "chores"], room: ["tidy"], help: ["chores"],
  lazy: ["active", "motivation"], bored: ["play", "active"], outside: ["active", "play"], exercise: ["active"], sport: ["active"],
  rude: ["kindness", "manners"], fight: ["siblings", "kindness"], share: ["kindness"], brother: ["siblings"], sister: ["siblings"],
  teeth: ["tooth", "brush"], wash: ["hygiene"], school: ["homework"], focus: ["homework"], procrastinate: ["homework", "start"],
  reward: ["motivation"], bribe: ["motivation", "reward"], read: ["book"],
};

/** Lowercase, split, drop stop words, and strip common endings so "brushing" matches "brush". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'s$/, "").replace(/'/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

const ENDINGS = ["ations", "ation", "ities", "ity", "ness", "ings", "ing", "ies", "ate", "ed", "es", "e", "s", "y"];

/** A light suffix stripper, run twice so "tidying" -> "tidy" -> "tid" matches "tidy" -> "tid". */
export function stem(word: string): string {
  let w = word;
  for (let pass = 0; pass < 2; pass++) {
    const end = ENDINGS.find((e) => w.length > e.length + 2 && w.endsWith(e));
    if (!end) break;
    w = w.slice(0, -end.length);
  }
  return w;
}

const SYNONYM_STEMS = new Map(Object.entries(SYNONYMS).map(([k, v]) => [stem(k), v.map(stem)]));

function expand(tokens: string[]): string[] {
  return tokens.flatMap((t) => [t, ...(SYNONYM_STEMS.get(t) ?? [])]);
}

/** Okapi BM25 over pre-tokenized documents. */
class Bm25<T> {
  private docs: { item: T; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(items: T[], text: (item: T) => string, private k1 = 1.2, private b = 0.75) {
    this.docs = items.map((item) => {
      const tokens = tokenize(text(item));
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      tf.forEach((_, t) => this.df.set(t, (this.df.get(t) ?? 0) + 1));
      return { item, tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length);
  }

  search(query: string): { item: T; score: number }[] {
    const terms = [...new Set(expand(tokenize(query)))];
    const n = this.docs.length;
    return this.docs
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          const f = d.tf.get(t);
          if (!f) continue;
          const df = this.df.get(t) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / this.avgLen)));
        }
        return { item: d.item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }
}

// ── Guidance ──────────────────────────────────────────────────────────────────

export interface GuidanceChunk {
  ref: string; // "G1": short, stable citation reference
  id: string; // "sleep#how-much-sleep-children-need"
  title: string; // "Sleep for growing kids: How much sleep children need"
  text: string;
  ages: [number, number];
}

export const CHUNKS: GuidanceChunk[] = KNOWLEDGE.flatMap((doc) =>
  doc.body
    .split(/^## /m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((section) => {
      const [heading, ...rest] = section.split("\n");
      return {
        id: `${doc.id}#${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        title: `${doc.title}: ${heading.trim()}`,
        text: rest.join("\n").trim(),
        ages: doc.ages,
      };
    })
).map((chunk, i) => ({ ref: `G${i + 1}`, ...chunk }));

const guidanceIndex = new Bm25(CHUNKS, (c) => `${c.title} ${c.title} ${c.text}`);

export function searchGuidance(query: string, opts: { age?: number; limit?: number } = {}): GuidanceChunk[] {
  return guidanceIndex
    .search(query)
    .map((r) => r.item)
    .filter((c) => opts.age === undefined || (opts.age >= c.ages[0] && opts.age <= c.ages[1]))
    .slice(0, opts.limit ?? 4);
}

// ── Quest library ─────────────────────────────────────────────────────────────

const habitIndex = new Bm25(LIBRARY, (q) =>
  `${q.parentTitle} ${q.parentTitle} ${q.description} ${q.kidTitle} ${q.kidHint} ${CATEGORY_LABEL[q.category]} ${q.category}`
);

export interface HabitHit {
  quest: QuestDef;
  /** Null when the child can have it now; otherwise why not (age, locked tier). */
  blocked: string | null;
}

/**
 * Library quests matching a problem description, best first. Quests outside the child's age
 * range are dropped; quests from tiers the child hasn't unlocked yet are returned as blocked,
 * so the coach can mention them as "coming soon" but not recommend them.
 */
export function searchHabits(query: string, opts: { age: number; unlockedTier: number; exclude?: string[]; limit?: number }): HabitHit[] {
  const ranked = habitIndex.search(query).map((r) => r.item);
  // Pad weak queries with the easiest age-appropriate quests so the coach always has options.
  const pool = [...ranked, ...LIBRARY.filter((q) => !ranked.includes(q)).sort((a, b) => a.tier - b.tier)];
  return pool
    .filter((q) => fitsAge(q, opts.age) && !(opts.exclude ?? []).includes(q.id))
    .slice(0, opts.limit ?? 6)
    .map((quest) => ({ quest, blocked: quest.tier > opts.unlockedTier ? `Tier ${quest.tier}: unlocks at a higher level` : null }));
}
