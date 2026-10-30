/** The habit coach's tools and loop, driven by a scripted fake client (no network, no API key). */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildContext } from "../src/lib/agents";
import { addChild, newChild } from "../src/lib/family";
import { emptyFamily } from "../src/lib/testing";
import { chat, runTool, type TurnOutput } from "./agents";
import { completeJson, parseJsonObject, type CompletionRequest, type CompletionResult, type LlmClient } from "./llm";
import { searchGuidance, searchHabits, stem, tokenize } from "./rag";

function ctx() {
  let f = addChild(emptyFamily(), { ...newChild("Maya", 6, "bunny"), id: "m" });
  f = addChild(f, { ...newChild("Sam", 3, "bear"), id: "s" });
  return buildContext(f, 14, new Date(2026, 9, 27));
}

const empty = (): TurnOutput => ({ proposals: [], recommendations: [] });

const args = (o: unknown) => JSON.stringify(o);

/** A fake LLM whose complete() returns the scripted results in order and records each request. */
function fakeClient(results: { content?: string | null; calls?: { id: string; name: string; input: unknown }[] }[]) {
  const requests: CompletionRequest[] = [];
  const client: LlmClient = {
    async complete(req): Promise<CompletionResult> {
      requests.push({ ...req, messages: [...req.messages] });
      const next = results.shift();
      if (!next) throw new Error("no more scripted results");
      return {
        message: {
          content: next.content ?? null,
          tool_calls: next.calls?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: args(c.input) } })),
        },
        finishReason: next.calls ? "tool_calls" : "stop",
      };
    },
  };
  return { client, requests };
}

describe("retrieval (RAG)", () => {
  it("stems word forms to the same root", () => {
    expect(stem("tidying")).toBe(stem("tidy"));
    expect(stem("activity")).toBe(stem("active"));
    expect(tokenize("The kids won't brush their teeth")).toEqual(["brush", "teeth"]);
  });

  it("finds screen-time guidance from a parent's own words", () => {
    const hits = searchGuidance("Maya has a meltdown when the iPad goes off");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.slice(0, 2).some((h) => h.id.startsWith("screen-time#"))).toBe(true);
  });

  it("finds bedtime guidance for stalling at night", () => {
    expect(searchGuidance("keeps stalling at bedtime every night")[0].id).toMatch(/^(sleep|bedtime-routine)#/);
  });

  it("only offers quests that fit the child's age, marking locked tiers", () => {
    const hits = searchHabits("reading books", { age: 4, unlockedTier: 1 });
    expect(hits.every(({ quest }) => quest.ages[0] <= 4 && quest.ages[1] >= 4)).toBe(true);
    expect(hits.map((h) => h.quest.id)).not.toContain("read-20"); // ages 6+
    const tidy = searchHabits("messy room, toys everywhere", { age: 8, unlockedTier: 1 });
    expect(tidy[0].quest.id).toBe("toys-away");
    expect(tidy.filter((h) => h.quest.tier > 1).every((h) => h.blocked)).toBe(true);
  });
});

describe("coach tools", () => {
  it("research returns citable guidance and age-appropriate quests in one call", () => {
    const out = runTool("research", args({ child_id: "s", problem: "screen time tantrum" }), ctx(), empty());
    const { sources, quests } = JSON.parse(out.content);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].ref).toMatch(/^G\d+$/);
    expect(sources[0].title).toMatch(/:/);
    // Sam is 3 and level 1: everything returned fits age 3, and higher tiers are marked locked.
    expect(quests.length).toBeGreaterThan(0);
    expect(quests.filter((q: { tier: number }) => q.tier > 1).every((q: { available: boolean }) => !q.available)).toBe(true);
  });

  it("rejects malformed tool arguments so the model can retry", () => {
    expect(runTool("research", "{not json", ctx(), empty()).isError).toBe(true);
    expect(runTool("research", args({ child_id: "m" }), ctx(), empty()).isError).toBe(true);
    expect(runTool("make_coffee", "{}", ctx(), empty()).isError).toBe(true);
  });

  it("recommends only valid, unlocked library quests (at most 3)", () => {
    const out = empty();
    const res = runTool("recommend_habits", args({
      child_id: "s",
      quests: [
        { quest_id: "toys-away", reason: "Small first step" },
        { quest_id: "family-table", reason: "Locked tier 2" },
        { quest_id: "bedtime", reason: "Routine, not a bonus quest" },
      ],
    }), ctx(), out);
    expect(out.recommendations).toEqual([{ childId: "s", questId: "toys-away", reason: "Small first step" }]);
    expect(res.content).toMatch(/Skipped: family-table: locked tier; bedtime: not a library quest/);
  });

  it("errors when nothing recommended is valid, so Claude can retry", () => {
    const res = runTool("recommend_habits", args({ child_id: "s", quests: [{ quest_id: "made-up", reason: "" }] }), ctx(), empty());
    expect(res.isError).toBe(true);
  });

  it("rejects invalid routine proposals", () => {
    const out = empty();
    const res = runTool("propose_habit_change", args({ habit: "bedtime", enabled: true, value: "8pm", reason: "" }), ctx(), out);
    expect(res.isError).toBe(true);
    expect(out.proposals).toHaveLength(0);
  });

  it("filters history to one child and counts approved days", () => {
    const out = JSON.parse(runTool("get_quest_history", args({ child_id: "m", days: 3 }), ctx(), empty()).content);
    expect(Object.keys(out.history)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(out.approvedDays.m.bedtime).toBe(0);
  });
});

describe("coach loop", () => {
  it("runs tools, collects recommendations and returns an append-only history", async () => {
    const { client, requests } = fakeClient([
      {
        calls: [
          { id: "t1", name: "research", input: { child_id: "m", problem: "screen meltdown" } },
          { id: "t2", name: "recommend_habits", input: { child_id: "m", quests: [{ quest_id: "family-table", reason: "Screen-free meals" }] } },
        ],
      },
      { content: "Try a visible timer and a five-minute warning [G1]." },
      // The only recommendation was refused, so the coach is nudged once to make cards.
      { content: "Try a visible timer and a five-minute warning [G1]. Tell me what you'd like to try." },
    ]);
    const prior = [{ role: "user" as const, content: "hello" }, { role: "assistant" as const, content: "Hi!" }];
    const { messages, recommendations, safety } = await chat(client, ctx(), prior, "Maya melts down when screens go off");
    expect(messages.slice(0, 2)).toEqual(prior);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "tool", "tool", "assistant"]);
    // Maya is 6 and level 1, so the tier-2 quest is refused and the model is told why.
    expect(messages[5]).toMatchObject({ role: "tool", tool_call_id: "t2" });
    expect((messages[5] as { content: string }).content).toMatch(/^Error: .*locked tier/);
    expect(recommendations).toEqual([]);
    expect(safety).toBeNull();
    // The system prompt (with the family overview) is sent on every request but never stored.
    expect(requests).toHaveLength(3);
    expect(requests[2].messages.at(-1)?.content).toMatch(/haven't called recommend_habits/); // one-off nudge
    expect(requests[1].messages[0]).toMatchObject({ role: "system" });
    expect(requests[1].messages[0].content).toMatch(/Family overview:.*Maya/s);
    expect(messages.some((m) => m.role === "system")).toBe(false);
    // Rate-limited requests fall back to the small model.
    expect(requests[0]).toMatchObject({ model: "openai/gpt-oss-120b", fallbackModel: "openai/gpt-oss-20b" });
  });

  it("shortens earlier turns' tool results before re-sending them", async () => {
    const { client, requests } = fakeClient([{ content: "Happy to help." }]);
    const long = JSON.stringify({ sources: [{ ref: "G1", title: "t", text: "x".repeat(2000) }] });
    const prior = [
      { role: "user" as const, content: "earlier" },
      { role: "assistant" as const, content: null, tool_calls: [{ id: "r1", type: "function" as const, function: { name: "research", arguments: "{}" } }] },
      { role: "tool" as const, tool_call_id: "r1", content: long },
      { role: "assistant" as const, content: "Earlier reply" },
    ];
    const { messages } = await chat(client, ctx(), prior, "thanks");
    const sent = requests[0].messages.find((m) => m.role === "tool") as { content: string };
    expect(sent.content.length).toBeLessThan(250);
    expect((messages[2] as { content: string }).content).toBe(long); // stored history keeps it in full
  });

  it("adds a safety system message when a child may be at risk", async () => {
    const { client, requests } = fakeClient([{ content: "Please call for help now." }]);
    const { safety, messages } = await chat(client, ctx(), [], "My son said he wants to die");
    expect(safety?.category).toBe("self-harm");
    expect(messages[1]).toMatchObject({ role: "system" });
    expect(JSON.stringify(requests[0].messages)).toMatch(/emergency/);
  });

  it("always ends with a reply the parent can read", async () => {
    const { client } = fakeClient([{ content: "" }]);
    const { messages } = await chat(client, ctx(), [], "hi");
    expect(messages.at(-1)).toMatchObject({ role: "assistant" });
    expect((messages.at(-1) as { content: string }).content.length).toBeGreaterThan(0);
  });
});

describe("JSON answers", () => {
  it("extracts JSON from fenced or chatty answers", () => {
    expect(parseJsonObject('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => parseJsonObject("no json here")).toThrow();
  });

  it("retries once with a bigger budget when the answer is unusable", async () => {
    const { client, requests } = fakeClient([{ content: '{"safe": "maybe"' }, { content: '{"safe": true}' }]);
    const result = await completeJson(client, z.object({ safe: z.boolean() }), { model: "m", system: "s", user: "u", maxTokens: 100 });
    expect(result).toEqual({ safe: true });
    expect(requests.map((r) => r.maxTokens)).toEqual([100, 200]);
    expect(requests[0].json).toBe(true);
    expect(requests[0].messages[0].content).toMatch(/JSON Schema/);
  });

  it("gives up with a friendly error after the retry", async () => {
    const { client } = fakeClient([{ content: "" }, { content: "nope" }]);
    await expect(completeJson(client, z.object({ safe: z.boolean() }), { model: "m", system: "s", user: "u", maxTokens: 100 }))
      .rejects.toThrow(/couldn't use/);
  });
});
