import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachContext, CoachThread } from "./api/types";

const api = vi.hoisted(() => ({ getCoachContext: vi.fn(), resetCoachThread: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("./storage", () => ({ markCoachFresh: vi.fn() }));
import { cachedCoachThread, clearCoachContext, freshCoachThread, preloadCoachContext, rememberCoachThread, setCoachContextOwner } from "./coachContext";

const thread = (content: string): CoachThread => ({ messages: [{ id: 1, role: "coach", content, sources: [], no_habit_match: false, created_at: "2026-11-04" }], suggestions: [] });
beforeEach(() => { clearCoachContext(); vi.clearAllMocks(); setCoachContextOwner("parent-1"); });

describe("private coach context", () => {
  it("keeps child histories separate and discards a preload from an ended account", async () => {
    let complete!: (result: CoachContext) => void;
    api.getCoachContext.mockReturnValue(new Promise<CoachContext>((resolve) => { complete = resolve; }));
    const pending = preloadCoachContext("family-1");
    setCoachContextOwner("parent-2");
    complete({ children: { a: thread("private") }, history_limit: 20 });
    await pending;
    expect(cachedCoachThread("a")).toBeUndefined();
    api.getCoachContext.mockResolvedValue({ children: { a: thread("A"), b: thread("B") }, history_limit: 20 });
    await preloadCoachContext("family-2");
    expect(cachedCoachThread("a")?.messages[0].content).toBe("A");
    expect(cachedCoachThread("b")?.messages[0].content).toBe("B");
  });

  it("does not restore preloaded old text after reset, and deduplicates concurrent resets", async () => {
    let finishLoad!: (result: CoachContext) => void;
    let finishReset!: () => void;
    api.getCoachContext.mockReturnValue(new Promise<CoachContext>((resolve) => { finishLoad = resolve; }));
    api.resetCoachThread.mockReturnValue(new Promise<void>((resolve) => { finishReset = resolve; }));
    const loading = preloadCoachContext("family");
    const reset = freshCoachThread("a");
    expect(freshCoachThread("a")).toBe(reset);
    finishLoad({ children: { a: thread("old") }, history_limit: 20 });
    await loading;
    finishReset(); await reset;
    expect(cachedCoachThread("a")?.messages).toEqual([]);
    expect(api.resetCoachThread).toHaveBeenCalledTimes(1);
  });

  it("reuses a recently updated thread and expires it for fresh reads", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    rememberCoachThread("a", thread("new"));
    expect(cachedCoachThread("a")?.messages[0].content).toBe("new");
    now.mockReturnValue(31_001);
    expect(cachedCoachThread("a")).toBeUndefined();
    now.mockRestore();
  });
});
