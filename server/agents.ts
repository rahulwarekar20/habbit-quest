/**
 * HabbitQuest agents, running server-side so the API key never reaches the browser. They use
 * Groq's open-weight models (see llm.ts), the same setup as the Wealth Intelligence Copilot.
 *
 *   POST /api/agent/plan      Quest planner: suggests routine habits and times for the family.
 *   POST /api/agent/review    Reviewer: writes the week's progress review, may suggest changes.
 *   POST /api/agent/chat      Habit coach: a parent describes a child's problem in their own
 *                             words; the coach retrieves guidance (RAG, cited inline as [G#]) and
 *                             library quests, recommends bonus quests for that child, and refines
 *                             them as the parent replies. Also proposes routine changes.
 *   POST /api/agent/buddy     Kid buddy: one short line of encouragement, safety-checked.
 *   POST /api/agent/moderate  Guardrail check for a note a child wants to send.
 *
 * Agents only suggest. Proposals and recommendations go back to the browser, where a parent
 * approves them with the PIN. No agent can touch Sparks, points or quest approvals.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  HABIT_IDS, validateChange, type BuddyRequest, type FamilyContext, type HabitChange, type HabitRecommendation,
  type PlanResult, type ReviewResult,
} from "../src/lib/agents";
import { PARENT_RISK_GUIDANCE, screenText, type SafetyCategory } from "../src/lib/guardrails";
import { MAX_AGE, MIN_AGE, QUEST_BY_ID, fitsAge } from "../src/lib/habits";
import { checkText } from "./guardrails";
import {
  LlmError, MODEL_LARGE, MODEL_SMALL, completeJson, createGroqClient, type ChatMessage, type LlmClient, type ToolDef,
} from "./llm";
import { searchGuidance, searchHabits } from "./rag";

const MAX_AGENT_TURNS = 10;
const MAX_BODY_BYTES = 1_000_000;
const MAX_RECOMMENDATIONS = 3;

// ── Schemas ───────────────────────────────────────────────────────────────────

// `habit` is a plain string here (not an enum) so an unknown id is dropped by cleanChanges
// instead of failing the whole response.
const ChangeSchema = z.object({
  habit: z.string().describe(`One of: ${HABIT_IDS.join(", ")}`),
  enabled: z.boolean(),
  value: z.string().describe('"HH:MM" 24-hour for time habits, minutes like "45" for screen time, "" for homework or to keep the current value'),
  reason: z.string().describe("One sentence for the parent explaining why"),
});

const PlanSchema = z.object({
  summary: z.string().describe("2-3 warm sentences for the parent describing the plan"),
  tips: z.array(z.string()).describe("Up to 3 short, practical tips"),
  changes: z.array(ChangeSchema).describe("At most 4 changes; empty when the current plan is already good"),
});

const ReviewSchema = z.object({
  headline: z.string().describe("One upbeat sentence summing up the week"),
  children: z.array(z.object({
    childId: z.string(),
    wins: z.string().describe("One specific win from this week"),
    watch: z.string().describe("One thing to keep an eye on, or 'Nothing to worry about'"),
  })),
  patterns: z.array(z.string()).describe("Up to 3 concrete patterns, each citing weekdays, counts or the children's own check-ins"),
  changes: z.array(ChangeSchema).describe("At most 2 changes, only when the data clearly supports them"),
});

const StatusSchema = z.enum(["todo", "submitted", "approved", "notyet"]);
const ContextSchema = z.object({
  today: z.string(),
  weekday: z.string(),
  localTime: z.string(),
  parentName: z.string().max(80),
  children: z.array(z.object({
    id: z.string(), name: z.string().max(40), age: z.number().int().min(MIN_AGE).max(MAX_AGE), sparks: z.number(),
    level: z.number(), levelName: z.string(), unlockedTier: z.number().int().min(1).max(3),
    bonusQuests: z.array(z.object({ id: z.string(), title: z.string(), tier: z.number() })),
  })).max(12),
  habits: z.array(z.object({
    id: z.enum(HABIT_IDS), title: z.string(), enabled: z.boolean(), setting: z.string(), value: z.string(),
  })),
  history: z.record(z.string(), z.record(z.string(), z.record(z.string(), StatusSchema))),
  checkins: z.array(z.object({
    childId: z.string(), day: z.string(), mood: z.string(), hardest: z.string().nullable(), favorite: z.string().nullable(),
    said: z.array(z.string().max(200)).max(8),
  })).max(200),
});

const BuddySchema = z.object({
  event: z.enum(["greet", "submitted", "celebrate"]),
  buddy: z.enum(["fox", "owl", "bear", "bunny"]),
  name: z.string().min(1).max(40),
  age: z.number().int().min(MIN_AGE).max(MAX_AGE),
  quests: z.array(z.string().max(60)).max(10),
  sparks: z.number().int().min(0),
});

// ── Prompts ───────────────────────────────────────────────────────────────────

const APP_FACTS = `HabbitQuest is a habit app for children aged 3 to 13. A parent picks daily routine habits (shared by every child) and their times, and can add up to 4 bonus quests per child from a library. Library quests have tiers: tier 1 is open from the start, tier 2 unlocks at level 2 and tier 3 at level 3 (levels rise with lifetime Sparks). A child taps "I did it!", the parent approves, and the child earns one Spark and points; points buy real-world rewards the parent prices. Sparks and earned points are never taken away. Children also send check-ins about how their day felt.
Quest statuses in the history: "approved" = done and approved by the parent; "submitted" = child tapped "I did it!" and is waiting for the parent; "notyet" = parent sent it back to try again; "todo" = not marked done that day (it may also mean the app wasn't used).`;

const PLANNER_SYSTEM = `You are the quest planner for HabbitQuest.
${APP_FACTS}

Given a family snapshot, propose a realistic daily routine for the parent. Consider the children's ages (for example, typical sleep needs are about 10-13 hours at ages 3-5 and 9-12 hours at ages 6-12), how consistently each habit has been done recently, the children's check-ins, and the gaps between wake-up, meals and bedtime. Routine habits apply to every child, so balance the plan across them.
Prefer small steps: shift a time by 15-30 minutes rather than a big jump, and don't enable more habits than the family is managing. Only propose changes that differ from the current settings; if the routine is already sensible, return no changes. Write for a busy parent: warm, plain and brief. Stay within general guidance and never give medical advice.`;

const REVIEWER_SYSTEM = `You are the weekly reviewer for HabbitQuest.
${APP_FACTS}

Review the last 14 days of quest history, focusing on the most recent 7 days and comparing them with the 7 before. Use the children's own check-ins (moods, trickiest quests, what they said) as well. For each child, name one specific win and one thing to watch. Point out up to 3 concrete patterns with evidence. Suggest at most 2 routine changes, and only when the data clearly supports them.
Celebrate effort and never shame a child. Don't suggest punishments, taking Sparks or points away, or comparing siblings against each other. Write for the parent: warm, specific and brief. Use each child's first name and refer to them by the id given in the snapshot.`;

const COACH_SYSTEM = `You are the HabbitQuest habit coach, chatting with a parent inside the app.
${APP_FACTS}

Your main job: a parent describes a problem in their own words ("Maya melts down when screen time ends", "Alex won't go to bed"). Help them by recommending a few small habits for that child, then refine them together.
1. Work out which child it's about from the family overview below (if it's unclear and there are several children, ask). If the problem is vague, ask one short clarifying question (when does it happen? what have you tried?) before recommending.
2. Call research once with the child and the problem. It returns guidance passages and matching library quests. Base your advice on the passages and cite each one you use inline with its ref in square brackets, like [G12]. Only cite refs that research returned; never invent statistics or sources.
3. Call recommend_habits with 1-3 available quests from the research results, each with a reason tied to the problem. Whenever you suggest quests, you must call recommend_habits before your final reply: that is the only way they appear as cards. Prefer small tier-1 steps for a new problem; never recommend a quest marked as locked or not in the results. If a locked quest would be ideal, mention it as something to look forward to.
4. Reply briefly: what might be going on, 2-3 practical tips, and that the recommended quests are shown as cards they can pick from. Invite them to say what feels too hard or too easy so you can refine. When they push back, search again and recommend a new set (it replaces the old one).
You can also adjust routine habits with propose_habit_change. Every recommendation and proposal becomes a card the parent approves with their PIN, so never say a change has been made. You can't award, remove or approve Sparks, points or quests.
Safety: you are not a doctor or therapist. Don't diagnose. Never suggest physical punishment, shaming, threats, withholding food or sleep, or taking earned rewards away. If a child may be in danger, hurting themselves or being hurt, put safety first: urge the parent to contact local emergency services, a children's helpline or their doctor now, and don't continue with habit advice in that reply.
Messages that begin with "[App]" are status notes from the app, not words the parent typed. Keep replies short (under 120 words), warm and practical, in plain text: no markdown (no **bold**, headings, tables or bullet symbols); use simple numbered lines for tips.`;

const BUDDY_SYSTEM = `You are a friendly animal buddy in HabbitQuest, a children's habit game. You speak one short line to a child.
Rules: one sentence, at most 18 words. Use simple words a child of the given age can read. Be warm, playful and encouraging. Praise effort, never pressure or guilt. No questions asking for personal information, no real brands, places or people, nothing scary, no emojis. Output only the line, without quotes.
Events: "greet" = say hello and cheer them toward one of today's quests. "submitted" = the child just tapped "I did it!" and a grown-up will check soon; praise the effort. "celebrate" = a grown-up approved the quest and they earned a Spark; celebrate with them.`;

/** Safe lines shown when an AI buddy line fails the safety check. */
const BUDDY_FALLBACK: Record<BuddyRequest["event"], string> = {
  greet: "Hello, quest hero! Let's do something great today!",
  submitted: "Great job trying! A grown-up will check soon.",
  celebrate: "Hooray! You earned a Spark. I'm so proud of you!",
};

// ── Planner and reviewer ──────────────────────────────────────────────────────

class AgentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Drops invalid or duplicate changes so the browser only ever sees proposals it can apply. */
function cleanChanges(changes: z.infer<typeof ChangeSchema>[]): HabitChange[] {
  const seen = new Set<string>();
  return (changes as HabitChange[]).filter((c) => {
    if (validateChange(c) || seen.has(c.habit)) return false;
    seen.add(c.habit);
    return true;
  });
}

async function plan(client: LlmClient, ctx: FamilyContext): Promise<PlanResult> {
  const result = await completeJson(client, PlanSchema, {
    model: MODEL_LARGE, system: PLANNER_SYSTEM, user: `Family snapshot:\n${JSON.stringify(ctx)}`, fallbackModel: MODEL_SMALL, maxTokens: 3000, reasoningEffort: "medium",
  });
  return { ...result, changes: cleanChanges(result.changes) };
}

async function review(client: LlmClient, ctx: FamilyContext): Promise<ReviewResult> {
  const result = await completeJson(client, ReviewSchema, {
    model: MODEL_LARGE, system: REVIEWER_SYSTEM, user: `Family snapshot:\n${JSON.stringify(ctx)}`, fallbackModel: MODEL_SMALL, maxTokens: 3000, reasoningEffort: "medium",
  });
  const ids = new Set(ctx.children.map((c) => c.id));
  return { ...result, children: result.children.filter((c) => ids.has(c.childId)), changes: cleanChanges(result.changes) };
}

// ── Coach tools ───────────────────────────────────────────────────────────────

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

const TOOLS: ToolDef[] = [
  fn("get_quest_history",
    'Get day-by-day quest statuses for each child\'s quests, plus per-quest counts of approved days. Use child_id "" for every child.',
    { child_id: { type: "string", description: 'A child id from the family overview, or "" for all children' }, days: { type: "integer", description: "How many recent days, 1-14" } },
    ["child_id", "days"]),
  fn("research",
    "Look up help for one child's problem: parenting guidance passages (sleep, screens, tantrums, mealtimes, homework, chores, hygiene, motivation, building habits, when to get help), each with a ref like G12 to cite as [G12], plus bonus quests from the library that fit the child's age, marked available or locked.",
    {
      child_id: { type: "string" },
      problem: { type: "string", description: "The problem in the parent's own words plus key topics, e.g. 'meltdowns when screen time ends'" },
    },
    ["child_id", "problem"]),
  fn("recommend_habits",
    `Show the parent 1-${MAX_RECOMMENDATIONS} bonus quests for one child as selectable cards. Replaces any earlier recommendations for that child. Only use quest ids from research that are available now. The parent picks which to add, with their PIN.`,
    {
      child_id: { type: "string" },
      quests: {
        type: "array",
        items: {
          type: "object",
          properties: { quest_id: { type: "string" }, reason: { type: "string", description: "One sentence linking this quest to the parent's problem" } },
          required: ["quest_id", "reason"],
          additionalProperties: false,
        },
      },
    },
    ["child_id", "quests"]),
  fn("propose_habit_change",
    "Propose turning a routine habit on or off and/or changing its time or minutes. This does NOT apply the change: the parent sees a card and approves it with their PIN. Make one call per habit.",
    {
      habit: { type: "string", enum: HABIT_IDS },
      enabled: { type: "boolean" },
      value: { type: "string", description: '"HH:MM" 24-hour for time habits; minutes for screen (30, 45, 60, 90 or 120); "" for homework or to keep the current value' },
      reason: { type: "string", description: "One sentence for the parent explaining why" },
    },
    ["habit", "enabled", "value", "reason"]),
];

// Tool inputs are validated here: the model's arguments are untrusted JSON.
const TOOL_INPUTS: Record<string, z.ZodType> = {
  get_quest_history: z.object({ child_id: z.string().default(""), days: z.coerce.number().default(7) }),
  research: z.object({ child_id: z.string(), problem: z.string().min(1) }),
  recommend_habits: z.object({ child_id: z.string(), quests: z.array(z.object({ quest_id: z.string(), reason: z.string().default("") })).min(1) }),
  propose_habit_change: z.object({ habit: z.string(), enabled: z.boolean(), value: z.string().default(""), reason: z.string().default("") }),
};

/** What the coach collected during one turn. */
export interface TurnOutput {
  proposals: HabitChange[];
  recommendations: HabitRecommendation[];
}

export function runTool(name: string, rawArgs: string, ctx: FamilyContext, out: TurnOutput): { content: string; isError?: boolean } {
  const schema = TOOL_INPUTS[name];
  if (!schema) return { content: `Unknown tool "${name}".`, isError: true };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArgs || "{}");
  } catch {
    return { content: "Arguments were not valid JSON. Try again.", isError: true };
  }
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) return { content: `Invalid arguments: ${parsed.error.issues[0]?.message}. Try again.`, isError: true };
  const input: unknown = parsed.data;

  const childOf = (id: string) => ctx.children.find((c) => c.id === id);
  const noChild = (id: string) => ({ content: `No child with id "${id}". Use an id from the family overview.`, isError: true });

  if (name === "get_quest_history") {
    const { child_id, days } = input as { child_id: string; days: number };
    if (child_id && !childOf(child_id)) return noChild(child_id);
    const keys = Object.keys(ctx.history).sort().slice(-Math.min(14, Math.max(1, days)));
    const history = Object.fromEntries(
      keys.map((d) => [d, child_id ? { [child_id]: ctx.history[d][child_id] ?? {} } : ctx.history[d]])
    );
    const approvedDays: Record<string, Record<string, number>> = {};
    for (const d of keys) {
      for (const [cid, quests] of Object.entries(history[d])) {
        for (const [quest, status] of Object.entries(quests ?? {})) {
          approvedDays[cid] ??= {};
          approvedDays[cid][quest] = (approvedDays[cid][quest] ?? 0) + (status === "approved" ? 1 : 0);
        }
      }
    }
    return { content: JSON.stringify({ days: keys.length, approvedDays, history }) };
  }
  if (name === "research") {
    const { child_id, problem } = input as { child_id: string; problem: string };
    const child = childOf(child_id);
    if (!child) return noChild(child_id);
    const chunks = searchGuidance(problem, { age: child.age, limit: 3 });
    const hits = searchHabits(problem, { age: child.age, unlockedTier: child.unlockedTier, exclude: child.bonusQuests.map((q) => q.id), limit: 6 });
    // The browser reads `sources` from this tool result to show cited titles under the reply.
    return {
      content: JSON.stringify({
        sources: chunks.map((c) => ({ ref: c.ref, title: c.title, text: c.text })),
        ...(chunks.length ? {} : { note: "No matching guidance. Answer from general, cautious principles and say so." }),
        quests: hits.map(({ quest, blocked }) => ({
          quest_id: quest.id, title: quest.parentTitle, about: quest.description, tier: quest.tier,
          available: !blocked, ...(blocked ? { locked: blocked } : {}),
        })),
        bonusQuestsInUse: child.bonusQuests.length,
      }),
    };
  }
  if (name === "recommend_habits") {
    const { child_id, quests } = input as { child_id: string; quests: { quest_id: string; reason: string }[] };
    const child = childOf(child_id);
    if (!child) return noChild(child_id);
    // Output guardrail: only library quests that fit the child's age and unlocked tier.
    const errors: string[] = [];
    const ok = quests.slice(0, MAX_RECOMMENDATIONS).filter(({ quest_id }) => {
      const q = QUEST_BY_ID[quest_id];
      const why = !q || q.routine ? "not a library quest" : !fitsAge(q, child.age) ? `not for age ${child.age}` : q.tier > child.unlockedTier ? "locked tier" : child.bonusQuests.some((b) => b.id === quest_id) ? "already added" : null;
      if (why) errors.push(`${quest_id}: ${why}`);
      return !why;
    });
    if (ok.length === 0) return { content: `No valid quests. ${errors.join("; ")}. Use available quest ids from search_habits.`, isError: true };
    out.recommendations = [
      ...out.recommendations.filter((r) => r.childId !== child_id),
      ...ok.map((q) => ({ childId: child_id, questId: q.quest_id, reason: q.reason.slice(0, 240) })),
    ];
    return { content: `Shown ${ok.length} quest card(s) to the parent for ${child.name}.${errors.length ? ` Skipped: ${errors.join("; ")}.` : ""} They're added only if the parent picks them and confirms with their PIN.` };
  }
  // propose_habit_change
  const change = input as HabitChange;
  const error = validateChange(change);
  if (error) return { content: error, isError: true };
  out.proposals = [...out.proposals.filter((p) => p.habit !== change.habit), change];
  return { content: "Proposal card shown to the parent. It is not applied until they approve it with their PIN." };
}

// ── Coach loop ────────────────────────────────────────────────────────────────

/**
 * One parent turn: appends the parent's message, runs the tool loop until the model answers,
 * and returns the new history (append-only, so it can be sent back unchanged next turn).
 * The coach's system prompt is added on every request and is not part of the stored history.
 * Input guardrail: if the message suggests a child may be at risk, a system message tells the
 * coach to lead with safety resources, and the browser shows the same guidance.
 */
export async function chat(client: LlmClient, ctx: FamilyContext, history: ChatMessage[], text: string) {
  const screen = screenText(text);
  const messages: ChatMessage[] = [...history, { role: "user", content: text }];
  if (screen.risk) {
    messages.push({ role: "system", content: `Safety check: the parent's last message may describe a child at risk (${screen.category}). Respond with care: acknowledge it, and lead with this guidance before anything else: "${PARENT_RISK_GUIDANCE}" Do not recommend habits in this reply.` });
  }
  const out: TurnOutput = { proposals: [], recommendations: [] };
  let searchedHabits = false;
  let nudged = false;
  let nudge: ChatMessage | null = null; // a one-off instruction for the next request only, never stored

  // Groq's free tier allows ~8,000 tokens a minute, so each request is kept lean: the family
  // overview rides in the system prompt (no tool round trip), and tool results from earlier
  // turns are shortened (the stored history keeps them in full for the browser).
  const { history: _history, ...overview } = ctx;
  const system: ChatMessage = { role: "system", content: `${COACH_SYSTEM}\n\nFamily overview:\n${JSON.stringify(overview)}` };
  const earlier = history.length;

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const { message } = await client.complete({
      model: MODEL_LARGE,
      fallbackModel: MODEL_SMALL,
      messages: [system, ...messages.map((m, i) => (i < earlier ? shorten(m) : m)), ...(nudge ? [nudge] : [])],
      tools: TOOLS,
      maxTokens: 4000,
      reasoningEffort: "medium",
      temperature: 0.4,
    });
    nudge = null;
    const calls = message.tool_calls ?? [];
    // Store only the standard fields so the history can be replayed to the API as-is.
    messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) {
      // The model sometimes names quests in its reply without making the cards. Once per turn,
      // drop that draft reply (it hasn't been sent anywhere) and ask it to call recommend_habits first.
      if (searchedHabits && out.recommendations.length === 0 && !nudged && !screen.risk) {
        nudged = true;
        messages.pop();
        nudge = { role: "system", content: "You researched quests but haven't called recommend_habits. If you are suggesting quests, call recommend_habits now with 1-3 available quest ids, then write your reply." };
        continue;
      }
      break;
    }
    for (const call of calls) {
      if (call.function.name === "research") searchedHabits = true;
      const result = runTool(call.function.name, call.function.arguments, ctx, out);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.isError ? `Error: ${result.content}` : result.content });
    }
  }
  const last = messages[messages.length - 1];
  if (last.role !== "assistant" || !last.content?.trim()) {
    messages.push({ role: "assistant", content: "I've put my suggestions on the cards below. Tell me if they feel too hard or too easy and I'll adjust them." });
  }
  const safety: { category: SafetyCategory; guidance: string } | null =
    screen.risk && screen.category ? { category: screen.category, guidance: PARENT_RISK_GUIDANCE } : null;
  return { messages, ...out, safety };
}

/** Shortens an old tool result before re-sending it (the model can research again if needed). */
function shorten(m: ChatMessage): ChatMessage {
  return m.role === "tool" && m.content.length > 200 ? { ...m, content: `${m.content.slice(0, 160)}… [earlier result shortened]` } : m;
}

/** Writes a buddy line, then runs it through both guardrail layers; a flagged line is swapped for a safe one. */
async function buddyLine(client: LlmClient, req: BuddyRequest): Promise<{ line: string; replaced: SafetyCategory | null }> {
  const { message } = await client.complete({
    model: MODEL_SMALL,
    messages: [{ role: "system", content: BUDDY_SYSTEM }, { role: "user", content: JSON.stringify(req) }],
    maxTokens: 600,
    reasoningEffort: "low",
    temperature: 0.8,
  });
  const line = (message.content ?? "").replace(/\s+/g, " ").replace(/^["'“]|["'”]$/g, "").trim();
  if (!line || line.length > 160) return { line: BUDDY_FALLBACK[req.event], replaced: null };
  const check = await checkText(client, line, "kid-reads");
  return check.ok ? { line, replaced: null } : { line: BUDDY_FALLBACK[req.event], replaced: check.category ?? "unkind" };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AgentError(413, "Request too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new AgentError(400, "Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AgentError(400, `Invalid request: ${result.error.issues[0]?.message ?? "bad input"}`);
  return result.data;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

const NOT_SET_UP = "AI helpers aren't set up: add GROQ_API_KEY to a .env file and restart the server.";

function toHttpError(error: unknown): { status: number; message: string } {
  if (error instanceof AgentError || error instanceof LlmError) return { status: error.status, message: error.message };
  return { status: 500, message: "Something went wrong in the AI helper." };
}

const MessageSchema = z.custom<ChatMessage>(
  (m) => typeof m === "object" && m !== null && ["user", "assistant", "tool", "system"].includes((m as { role?: string }).role ?? ""),
);
const ChatBodySchema = z.object({
  context: ContextSchema,
  history: z.array(MessageSchema).max(600),
  message: z.string().min(1).max(2000),
});
const ContextBodySchema = z.object({ context: ContextSchema });
const ModerateBodySchema = z.object({ text: z.string().min(1).max(400) });

const ROUTES = ["/plan", "/review", "/chat", "/buddy", "/moderate"];

/** Connect-style middleware mounted at /api/agent. */
export function createAgentHandler(apiKey?: string) {
  const key = apiKey || process.env.GROQ_API_KEY || "";
  const client = key ? createGroqClient(key) : null;
  const need = () => {
    if (!client) throw new AgentError(503, NOT_SET_UP);
    return client;
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const route = (req.url ?? "").split("?")[0].replace(/\/+$/, "");
    if (!ROUTES.includes(route)) return next();
    if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

    try {
      const body = await readJson(req);
      if (route === "/moderate") {
        // Works without a key too (local checks only), so kids' notes are always screened.
        const { text } = parseBody(ModerateBodySchema, body);
        return send(res, 200, await checkText(client, text, "kid-writes"));
      }
      if (route === "/plan") return send(res, 200, await plan(need(), parseBody(ContextBodySchema, body).context));
      if (route === "/review") return send(res, 200, await review(need(), parseBody(ContextBodySchema, body).context));
      if (route === "/buddy") return send(res, 200, await buddyLine(need(), parseBody(BuddySchema, body)));
      const { context, history, message } = parseBody(ChatBodySchema, body);
      return send(res, 200, await chat(need(), context, history, message));
    } catch (error) {
      const { status, message } = toHttpError(error);
      if (status >= 500 && message !== NOT_SET_UP) console.error(`[agents] ${route}:`, error instanceof Error ? error.message : error);
      return send(res, status, { error: message });
    }
  };
}
