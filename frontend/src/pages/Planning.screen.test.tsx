/** The parent reads a goal before explicitly creating and accepting reviewed habits. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { CatalogDialog } from "../components/CatalogDialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalRecommendation, GoalSource, HabitDraftBatch, Plan, PlanHabit } from "../lib/api";
import type { CoachingBudget } from "../lib/api/tokenomics";
import { markCoachFresh } from "../lib/storage";
import { defaultState, PIN, startFakeServer } from "../test/fakeServer";
import { renderApp } from "../test/renderApp";

const sourceRef = { source_id: "learning-question--a6-8", concept_id: "learning-question", category_id: "learning", catalog_version: "0.1.0", record_sha256: "a".repeat(64), snapshot_id: "b".repeat(64) };
const goal: GoalRecommendation = { id: "rec1", child_id: "c1", goal_id: "hqg-question", title: "Ask a learning question", description: "Notice one place you need help.", reason: "A small question makes getting help easier.", source_ref: sourceRef, setting: "home", created_at: "2026-11-04T12:00:00Z" };
const source: GoalSource = {
  goal_id: goal.goal_id, title: goal.title, description: goal.description, source_ref: sourceRef,
  age_min: 6, age_max: 8, contexts: ["home", "school"], readiness_note: "Offer adult support.",
  parent: { selection_guidance: "A specific question can help.", setup: "Keep paper nearby.", steps: ["Model a question."], say: "Which part is tricky?", avoid: ["Do not test or shame."], adaptations: [], review_guidance: "Notice attempts." },
  kid: { title: "Find a question", description: "Ask for help.", instructions: ["Mark a question."], help_phrase: "Help me with this part.", delivery_options: [] },
  practice: { form: "practice", schedule: "daily", completion: "A question is marked.", minimum_seconds: 20, typical_seconds: 60, timing_note: "After school", support_level: "adult nearby", adult_role: "Listen without rushing.", easier_version: "Point to a part.", stretch_version: "Write a question.", allowed_outcomes: [], observation_rule: "Notice attempts." },
  safety: { flags: [], not_for: [], care_and_help_unconditional: true },
  research: { insight: "Practice asking for support.", product_efficacy: "This product has not been clinically evaluated.", evidence: [{ source_id: "study-1", relationship: "background", supports: "Supported practice can make asking easier.", does_not_establish: "Not a trial of this generated habit.", age_transfer: "Adapt support to the child.", source_url: "https://example.org/research" }] },
  support_targets: [], mechanisms: [], clinical_review_status: "editorial_draft", status: "research_grounded_editorial_draft",
};
const batch: HabitDraftBatch = {
  id: "batch1", child_id: "c1", goal_id: goal.goal_id, status: "reviewed", outcome: "habits", source: sourceRef,
  expires_at: "2099-01-01T00:00:00Z", items: [{ id: "draft1", accepted_habit_id: null, child_habit_id: null, draft: {
    title: "Mark one question", description: "Practice noticing a stuck spot.", kid_title: "My question mark", kid_hint: "Find one tricky part.",
    instruction: "Put a question mark beside one tricky part.", why: "A visible mark makes it easier to ask for support.",
    parent_setup: "Leave a pencil nearby.", strategy: "external cue", estimated_seconds: 60,
    steps: ["Pick one piece of work.", "Mark one tricky part."], materials: ["Pencil"], help_text: "Can you help me with this part?",
    cue: "When homework starts", completion: "You have marked one tricky part.", recurrence: "weekly",
    parent_guidance: { prepare: "Keep the task small.", coach: "Notice the attempt.", if_hard: "Let them point instead.", observe: "One question is enough." },
  } }],
};

beforeEach(() => { Element.prototype.scrollTo = vi.fn(); });

function setup(saved: HabitDraftBatch[] = [], pin: string | null = PIN) {
  const server = startFakeServer(defaultState({ pin }));
  let cards = [goal];
  let reset = false;
  const activeGoals = new Set<string>();
  const plan = (): Plan => ({ child_id: "c1", habits: server.state.plans.c1, goals: cards.filter(card => activeGoals.has(card.goal_id)).map(card => ({ goal_id: card.goal_id, title: card.title, status: "active", reason: card.reason, recommended_habit_ids: [], options: [] })), capacity: { limit: 6, used: server.state.plans.c1.length, remaining: Math.max(0, 6 - server.state.plans.c1.length) }, progress: { sparks: 4, pending_sparks: 0, level: 1, level_name: "Camp Sprout", world: "camp", unlocked_tier: 1, next_level_at: 30, next_landmark: null } });
  server.on("GET", /\/coach\/messages$/, () => ({ messages: [], suggestions: [], goal_recommendations: cards }));
  server.on("GET", /\/goals\/([^/]+)\/source$/, match => ({ ...source, goal_id: match[1], kid: { ...source.kid, title: cards.find(card => card.goal_id === match[1])?.title ?? source.kid.title } }));
  const batches = structuredClone(saved);
  server.on("GET", /\/goals\/([^/]+)\/habit-drafts$/, match => ({ batches: batches.filter(batch => batch.goal_id === match[1]).map(batch => reset ? { ...batch, items: [], status: "unavailable", outcome: "stale_context", message: "These drafts belong to an earlier context. Generate new habits." } : batch) }));
  server.on("DELETE", /\/coach\/messages$/, () => { reset = true; return { status: 204 }; });
  server.on("GET", /\/plan$/, plan);
  server.on("PATCH", /\/child-habits\/([^/]+)$/, match => { server.state.plans.c1 = server.state.plans.c1.filter(habit => habit.id !== match[1]); return plan(); });
  server.on("PATCH", /\/children\/c1\/goals\/([^/]+)$/, (match, body) => { if ((body as { status: string }).status === "active") activeGoals.add(match[1]); else { activeGoals.delete(match[1]); server.state.plans.c1 = server.state.plans.c1.filter(habit => habit.goal_id !== match[1]); } return plan(); });
  let serial = saved.length;
  const accepted = new Map<string, PlanHabit>();
  server.on("GET", /\/children\/c1\/habits\/([^/]+)\/details$/, match => {
    const item = batches.flatMap(batch => batch.items).find(item => item.accepted_habit_id === match[1])!;
    return { habit_id: match[1], goal_id: accepted.get(match[1])!.goal_id, source: sourceRef, draft: item.draft };
  });
  server.on("POST", /\/goals\/([^/]+)\/habit-drafts$/, (match, input) => {
    const count = (input as { count: number }).count;
    const number = ++serial;
    const next = { ...batch, id: `batch${number}`, goal_id: match[1], items: Array.from({ length: count }, (_, i) => ({ ...batch.items[0], id: `draft${number}-${i}`, draft: { ...batch.items[0].draft, kid_title: `My question ${number}-${i}`, emoji_key: ["pencil", "book", "speech_balloon"][i % 3] } })) };
    batches.unshift(next); return next;
  });
  server.on("POST", /\/habit-drafts\/([^/]+)\/items\/([^/]+)\/accept$/, (match, input) => {
    const current = batches.find(batch => batch.id === match[1])!;
    const item = current.items.find(item => item.id === match[2])!;
    const schedule = input as { cue_time: string; days: import("../lib/api").DayName[]; anchor: import("../lib/api").RoutinePart };
    const habit = { ...server.state.plans.c1[0], ...item.draft, ...schedule, id: `assigned-${item.id}`, habit_id: `my-ai-${item.id}`, icon: `fluent:${item.draft.emoji_key}`, goal_id: current.goal_id };
    item.accepted_habit_id = habit.habit_id; item.child_habit_id = habit.id;
    accepted.set(habit.habit_id, habit); activeGoals.add(current.goal_id); server.state.plans.c1.push(habit);
    return { habit_id: habit.habit_id, child_habit_id: habit.id, goal_id: current.goal_id };
  });
  server.on("POST", /\/children\/c1\/habits$/, (_match, input) => { const habit = accepted.get((input as { habit_id: string }).habit_id)!; server.state.plans.c1.push(habit); activeGoals.add(habit.goal_id); return plan(); });
  const view = renderApp("/coach/c1");
  markCoachFresh("c1");
  return { ...view, server, batches, activeGoals, plan, setCards: (value: GoalRecommendation[]) => { cards = value; } };
}

describe("source goals and generated habits", () => {
  it("prepares only funded goals, binds automatic batches to their parent, and charges explicit choices independently", async () => {
    const extra = { ...goal, id: "rec2", goal_id: "hqg-extra", title: "Another goal" };
    const { user, server, setCards } = setup([], null);
    await screen.findByRole("button", { name: "Get more goals" });
    const budget = { allowance: 3, used: 2, pending: 1, remaining: 0, overage: 0, reset_at: "2026-11-06T05:00:00Z", enforced: true, show_costs: false, activity_quotes: { coach: 2, habit_batch: 1 }, policy_revision: 1 };
    const accounting = { operation_id: "coach-op", parent_operation_id: null, activity: "coach", status: "completed", credits: 2, pending_credits: 1, budget, automatic_slots: [{ goal_id: goal.goal_id, parent_operation_id: "coach-op" }] };
    server.on("GET", /\/ai\/operations\/coach-op$/, () => accounting);
    server.on("POST", /\/ai\/operations\/coach-op\/observation$/, () => ({ status: 204 }));
    server.on("POST", /\/coach\/messages$/, () => { setCards([goal, extra]); return { messages: [{ id: 1, role: "coach", content: "Two goals to explore.", sources: [], created_at: goal.created_at }], suggestions: [], goal_recommendations: [goal, extra], response_goal_ids: [goal.goal_id, extra.goal_id], reply: "Two goals to explore.", safety: null, mapped_by: "ai", outcome: "recommendations", tokenomics: accounting }; });
    await user.click(screen.getByRole("button", { name: "Get more goals" }));
    await screen.findByText("My question 1-0");
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(1);
    expect(server.sent("POST", /habit-drafts$/)[0].body).toMatchObject({ parent_operation_id: "coach-op", count: 3 });
    expect(screen.getByText(/Some goals are ready to explore without new habit choices/)).toBeInTheDocument();
    const article = document.querySelector(`[data-goal-id="${goal.goal_id}"]`) as HTMLElement;
    await user.click(within(article).getByRole("button", { name: "More habit choices" }));
    await screen.findByText("My question 2-0");
    expect(server.sent("POST", /habit-drafts$/)[1].body).not.toHaveProperty("parent_operation_id");
  });

  it("does not automatically generate habits when the server grants zero slots", async () => {
    const { user, server } = setup([], null);
    await screen.findByRole("button", { name: "Get more goals" });
    server.on("POST", /\/coach\/messages$/, () => ({ messages: [], suggestions: [], goal_recommendations: [goal], response_goal_ids: [goal.goal_id], reply: "A goal to read.", safety: null, mapped_by: "ai", outcome: "recommendations", tokenomics: { operation_id: "empty-slots", parent_operation_id: null, activity: "coach", status: "completed", credits: 2, pending_credits: 0, automatic_slots: [], budget: { allowance: 2, used: 2, pending: 0, remaining: 0, overage: 0, reset_at: "2026-11-06T05:00:00Z", enforced: true, show_costs: false, activity_quotes: { coach: 2, habit_batch: 1 }, policy_revision: 1 } } }));
    server.on("POST", /\/ai\/operations\/empty-slots\/observation$/, () => ({ status: 204 }));
    await user.click(screen.getByRole("button", { name: "Get more goals" }));
    await screen.findByText(/Some goals are ready to explore without new habit choices/);
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(0);
  });

  it("gets more goals once, preserves earlier choices and prepares habits only for the new goals", async () => {
    const extra = { ...goal, id: "rec2", goal_id: "hqg-extra", title: "An additional goal" };
    const { user, server, setCards } = setup([batch], null);
    await screen.findByText("My question mark");
    server.on("POST", /\/coach\/messages$/, () => {
      setCards([goal, extra]);
      return { messages: [{ id: 1, role: "coach", content: "Here is another approach.", sources: [], created_at: goal.created_at }], suggestions: [], goal_recommendations: [goal, extra], response_goal_ids: [extra.goal_id], reply: "Here is another approach.", safety: null, mapped_by: "ai", outcome: "recommendations" };
    });
    const fetch = globalThis.fetch;
    let release!: () => void;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST" && /\/coach\/messages/.test(String(url))) await new Promise<void>(resolve => { release = resolve; });
      return fetch(url, init);
    });
    await user.type(screen.getByRole("textbox", { name: "Message the habit coach" }), "An unfinished note");
    await user.click(screen.getByRole("button", { name: "Get more goals" }));
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByRole("button", { name: "Get more goals" })).toBeDisabled();
    expect(screen.getByText("My question mark")).toBeInTheDocument();
    await act(async () => release());
    await screen.findByText("My question 2-0");
    expect(server.sent("POST", /\/coach\/messages$/)).toHaveLength(1);
    expect(server.sent("POST", /\/coach\/messages$/)[0].body).toMatchObject({ more_goals: true, setting: "home" });
    expect(screen.getByRole("textbox", { name: "Message the habit coach" })).toHaveValue("An unfinished note");
    expect(document.querySelectorAll(".source-goal")).toHaveLength(2);
    expect(screen.getByText("My question mark")).toBeInTheDocument();
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(1);
    expect(server.sent("POST", /habit-drafts$/)[0].path).toContain(extra.goal_id);
    vi.stubGlobal("fetch", fetch);
    server.on("POST", /\/coach\/messages$/, () => ({ messages: [], suggestions: [], goal_recommendations: [goal, extra], response_goal_ids: [], reply: "No other matching goals.", safety: null, mapped_by: "ai", outcome: "no_direct_fit" }));
    await user.click(screen.getByRole("button", { name: "Get more goals" }));
    await screen.findByText(/No additional matching goals this time/);
    expect(document.querySelectorAll(".source-goal")).toHaveLength(2);
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(1);
  });

  it("keeps the conversation together above recommendations and the saved plan", async () => {
    const { server } = setup([batch], null);
    const chat = await screen.findByRole("region", { name: "Chat about Alex" });
    const recommendations = await screen.findByRole("region", { name: "Suggested goals for Alex" });
    expect(within(chat).getByRole("textbox", { name: "Message the habit coach" })).toBeInTheDocument();
    expect(within(chat).getByRole("group", { name: "Where will this happen?" })).toBeInTheDocument();
    await within(chat).findByRole("button", { name: "Something different" });
    expect(chat.compareDocumentPosition(recommendations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const card = document.querySelector(".source-goal")!;
    const plan = document.querySelector(".coach-plan-manager")!;
    expect(card.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("keeps the two-request habit queue when more goals arrive during preparation", async () => {
    const { user, server, setCards } = setup([], null);
    const goals = Array.from({ length: 4 }, (_, i) => ({ ...goal, id: `rec${i}`, goal_id: `hqg-goal${i}`, title: `Goal ${i + 1}` }));
    setCards([]);
    let turn = 0;
    server.on("POST", /\/coach\/messages$/, () => {
      const returned = ++turn === 1 ? goals.slice(0, 2) : goals.slice(2);
      const all = goals.slice(0, turn === 1 ? 2 : 4);
      setCards(all);
      return { messages: [], suggestions: [], goal_recommendations: all, response_goal_ids: returned.map(card => card.goal_id), reply: "Some useful goals.", safety: null, mapped_by: "ai", outcome: "recommendations" };
    });
    const fetch = globalThis.fetch;
    const releases: (() => void)[] = [];
    let active = 0, maximum = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST" && /\/habit-drafts(?:\?|$)/.test(String(url))) {
        maximum = Math.max(maximum, ++active);
        await new Promise<void>(resolve => releases.push(resolve));
        try { return await fetch(url, init); } finally { active--; }
      }
      return fetch(url, init);
    });
    await user.type(await screen.findByRole("textbox", { name: "Message the habit coach" }), "Help with getting ready");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(releases).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Get more goals" }));
    await waitFor(() => expect(screen.getAllByText("Waiting to prepare three choices…")).toHaveLength(2));
    expect(releases).toHaveLength(2);
    await act(async () => { releases[0](); releases[1](); });
    await waitFor(() => expect(releases).toHaveLength(4));
    await act(async () => { releases[2](); releases[3](); });
    await waitFor(() => expect(document.querySelectorAll(".habit-draft")).toHaveLength(12));
    expect(maximum).toBe(2);
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(4);
  });

  it("keeps a re-recommended saved goal with the latest response without duplicating or resetting its habits", async () => {
    const other = { ...goal, id: "rec2", goal_id: "hqg-other", title: "Another saved goal" };
    const fresh = { ...goal, id: "rec3", goal_id: "hqg-fresh", title: "A new goal in the same category" };
    const freshBatch = { ...batch, id: "batch3", goal_id: fresh.goal_id, items: [{ ...batch.items[0], id: "draft3", draft: { ...batch.items[0].draft, kid_title: "My new practice" } }] };
    const { user, server, activeGoals, setCards } = setup([batch, freshBatch], null);
    setCards([goal, other, fresh]); activeGoals.add(goal.goal_id); activeGoals.add(other.goal_id);
    const planHeading = await screen.findByRole("heading", { name: "Goals in Alex's plan" });
    const original = document.querySelector(`[data-goal-id="${goal.goal_id}"]`)! as HTMLElement;
    await within(original).findByText("My question mark");
    await user.click(within(original).getByRole("button", { name: "Read habit details for My question mark" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Time"), { target: { value: "16:15" } });
    await user.keyboard("{Escape}");
    server.on("POST", /\/coach\/messages$/, () => ({ messages: [{ id: 2, role: "coach", content: "Try these two goals.", sources: [], created_at: goal.created_at }], suggestions: [], goal_recommendations: [goal, fresh], reply: "Try these two goals.", safety: null, mapped_by: "ai", outcome: "recommendations" }));
    await user.type(screen.getByRole("textbox", { name: "Message the habit coach" }), "More help with the same kind of goal");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("heading", { name: "New recommendations" });
    const visibleIds = () => [...document.querySelectorAll(".source-goal")].map(card => card.getAttribute("data-goal-id"));
    expect(visibleIds()).toEqual([goal.goal_id, fresh.goal_id, other.goal_id]);
    expect(document.querySelector(`[data-goal-id="${goal.goal_id}"]`)).toBe(original);
    expect(within(original).getByText("Recommended again in this response")).toBeInTheDocument();
    expect(original.compareDocumentPosition(planHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const freshCard = document.querySelector(`[data-goal-id="${fresh.goal_id}"]`)! as HTMLElement;
    await user.click(within(freshCard).getByRole("button", { name: "Add goal to plan" }));
    await waitFor(() => expect(freshCard).toHaveAttribute("data-goal-state", "saved"));
    expect(visibleIds()).toEqual([goal.goal_id, fresh.goal_id, other.goal_id]);
    await user.click(within(original).getByRole("button", { name: "Read habit details for My question mark" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Time")).toHaveValue("16:15");
    await user.keyboard("{Escape}");
    server.on("POST", /\/coach\/messages$/, () => ({ status: 503, body: { detail: "Temporarily unavailable" } }));
    await user.type(screen.getByRole("textbox", { name: "Message the habit coach" }), "Another thought");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Temporarily unavailable");
    expect(visibleIds()).toEqual([goal.goal_id, fresh.goal_id, other.goal_id]);
    expect(screen.getByRole("heading", { name: "New recommendations" })).toBeInTheDocument();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("separates saved goals from recommendations and preserves each goal's choices when it is saved", async () => {
    const other = { ...goal, id: "rec2", goal_id: "hqg-other", title: "A different goal" };
    const otherBatch = { ...batch, id: "batch2", goal_id: other.goal_id, items: [{ ...batch.items[0], id: "draft2", draft: { ...batch.items[0].draft, kid_title: "My other practice" } }] };
    const { user, server, activeGoals, setCards } = setup([batch, otherBatch], null);
    setCards([goal, other]); activeGoals.add(goal.goal_id);
    await screen.findByRole("heading", { name: "Goals in Alex's plan" });
    await screen.findByRole("heading", { name: "Coach recommendations" });
    const saved = document.querySelector(`[data-goal-id="${goal.goal_id}"]`)! as HTMLElement;
    const suggested = document.querySelector(`[data-goal-id="${other.goal_id}"]`)! as HTMLElement;
    expect(saved).toHaveAttribute("data-goal-state", "saved");
    expect(suggested).toHaveAttribute("data-goal-state", "recommended");
    await within(saved).findByText("My question mark");
    await within(suggested).findByText("My other practice");
    expect(within(saved).queryByText("My other practice")).not.toBeInTheDocument();
    expect(within(suggested).queryByText("My question mark")).not.toBeInTheDocument();
    expect(within(saved).getByText("Saved goal · 0 habits")).toBeInTheDocument();
    expect(within(suggested).getByText("Earlier recommendation")).toBeInTheDocument();
    await user.click(within(suggested).getByRole("button", { name: "Read habit details for My other practice" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Time"), { target: { value: "16:15" } });
    await user.keyboard("{Escape}");
    await user.click(within(suggested).getByRole("button", { name: "Add goal to plan" }));
    await waitFor(() => expect(suggested).toHaveAttribute("data-goal-state", "saved"));
    expect(document.querySelectorAll(".source-goal")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Coach recommendations" })).not.toBeInTheDocument();
    await user.click(within(suggested).getByRole("button", { name: "Read habit details for My other practice" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Time")).toHaveValue("16:15");
    expect(within(screen.getByRole("dialog")).getByText("A different goal")).toBeInTheDocument();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("does not display a saved batch returned under the wrong child or goal", async () => {
    const { server } = setup([], null);
    server.on("GET", /\/goals\/([^/]+)\/habit-drafts$/, () => ({ batches: [{ ...batch, child_id: "c2", goal_id: "hqg-other" }] }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The saved habits do not match this goal");
    expect(screen.queryByText("My question mark")).not.toBeInTheDocument();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("rejects approved habit details whose goal differs from the saved assignment", async () => {
    const { server, activeGoals } = setup([], null);
    activeGoals.add(goal.goal_id);
    server.state.plans.c1.push({ ...server.state.plans.c1[0], id: "assignment-approved", habit_id: "my-ai-approved", goal_id: goal.goal_id, kid_title: "Approved practice" });
    server.on("GET", /\/children\/c1\/habits\/my-ai-approved\/details$/, () => ({ habit_id: "my-ai-approved", goal_id: "hqg-wrong", source: sourceRef, draft: batch.items[0].draft }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The approved habit does not match this goal");
    expect(screen.queryByRole("button", { name: "Read habit details for My question mark" })).not.toBeInTheDocument();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("keeps an outer detail reader open when closing a nested goal reader", async () => {
    function Readers() {
      const [outer, setOuter] = useState(false), [inner, setInner] = useState(false);
      return <><button onClick={() => setOuter(true)}>Open habit</button>{outer && <CatalogDialog title="Habit" onClose={() => setOuter(false)}>
        <button onClick={() => setInner(true)}>Read its goal</button>
        {inner && <CatalogDialog title="Goal" onClose={() => setInner(false)}><a href="#source">Research source</a></CatalogDialog>}
      </CatalogDialog>}</>;
    }
    render(<Readers />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open habit" }));
    const goalTrigger = screen.getByRole("button", { name: "Read its goal" });
    await user.click(goalTrigger);
    const inner = within(screen.getByRole("dialog", { name: "Goal" }));
    await user.tab({ shift: true });
    expect(inner.getByRole("link", { name: "Research source" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Goal" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Habit" })).toBeInTheDocument();
    expect(goalTrigger).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open habit" })).toHaveFocus();
  });

  it("shows research, makes three choices, appends without deletion, and adds/removes/restores an assignment", async () => {
    const { user, server } = setup();
    await screen.findByText("Practice asking for support.");
    await user.click(screen.getByRole("button", { name: "Research · 1 source ↗" }));
    const research = within(screen.getByRole("dialog", { name: goal.title }));
    await user.click(research.getByText("Research and limitations"));
    expect(research.getByRole("link", { name: "Read research source 1 ↗" })).toHaveAttribute("href", "https://example.org/research");
    expect(research.getByText("Not a trial of this generated habit.")).toBeInTheDocument();
    await user.click(research.getByRole("button", { name: "Close details" }));
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Make three habits" }));
    await screen.findByText("My question 1-0");
    expect(document.querySelectorAll(".habit-draft")).toHaveLength(3);
    expect(server.sent("POST", /habit-drafts/)[0].body).toMatchObject({ count: 3, setting: "home" });
    expect(new Set([...document.querySelectorAll(".habit-draft__art img")].map(img => img.getAttribute("src"))).size).toBe(3);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More habit choices" }));
    await screen.findByText("My question 2-0");
    expect(document.querySelectorAll(".habit-draft")).toHaveLength(6);
    expect(server.sent("POST", /habit-drafts/)[1].body).toMatchObject({ count: 3 });
    expect(screen.getByText("My question 1-0")).toBeInTheDocument();
    const card = within(document.querySelectorAll(".habit-draft")[0] as HTMLElement);
    await user.click(card.getByRole("button", { name: /Read habit details for/ }));
    const habitDetails = within(screen.getByRole("dialog"));
    fireEvent.change(habitDetails.getByLabelText("Time"), { target: { value: "16:30" } });
    await user.click(habitDetails.getByRole("button", { name: "Add to Alex's quests" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("4-digit PIN"), PIN);
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await card.findByText("Added to Alex's quests");
    expect(server.sent("POST", /\/accept$/)[0].body).toMatchObject({ pin: PIN, cue_time: "16:30", anchor: "evening" });
    expect(server.state.plans.c1).toHaveLength(3);
    await user.click(card.getByRole("button", { name: /Remove .* from plan/ }));
    await card.findByRole("button", { name: "Add back to Alex's quests" });
    expect(server.state.plans.c1).toHaveLength(2);
    await user.click(card.getByRole("button", { name: "Add back to Alex's quests" }));
    await card.findByText("Added to Alex's quests");
    expect(server.sent("POST", /\/children\/c1\/habits$/)).toHaveLength(1);
    expect(server.state.plans.c1).toHaveLength(3);
  });

  it("reuses saved drafts, exposes full details, and saves/removes a goal without generating", async () => {
    const { user, server } = setup([batch], null);
    await screen.findByText("My question mark");
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Read goal details" }));
    const goalDetails = within(screen.getByRole("dialog", { name: goal.title }));
    await user.click(goalDetails.getByText("How to support this goal"));
    expect(goalDetails.getByText("Which part is tricky?")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read goal details" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Add goal to plan" }));
    await screen.findByRole("button", { name: "Remove goal from plan" });
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Remove goal from plan" }));
    await screen.findByRole("button", { name: "Add goal to plan" });
    await user.click(screen.getByRole("button", { name: "Adjust setting, add a note or make more choices" }));
    const settings = within(within(screen.getByRole("dialog")).getByRole("group", { name: "Where will this happen?" }));
    await user.click(settings.getByRole("radio", { name: "School" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "More habit choices" }));
    await screen.findByText("My question 2-0");
    expect(server.sent("POST", /habit-drafts/)[0].body).toMatchObject({ setting: "school" });
    expect(screen.getByText("My question mark")).toBeInTheDocument();
  });

  it("opens bounded detail dialogs without enlarging cards, traps focus, and restores focus after dismissal", async () => {
    const { user, server } = setup([batch], null);
    await screen.findByText("My question mark");
    expect(screen.queryByText("Pick one piece of work.")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Read habit details for My question mark" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "My question mark" });
    const close = within(dialog).getByRole("button", { name: "Close details" });
    expect(close).toHaveFocus();
    expect(within(dialog).getByText("Pick one piece of work.")).toBeVisible();
    expect(document.querySelector(".source-goals")?.closest("[inert]")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Add to Alex's quests" })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.querySelector(".source-goals")?.closest("[inert]")).toBeNull();
    await user.click(trigger);
    fireEvent.mouseDown(document.querySelector(".catalog-dialog-backdrop")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(server.sent("POST", /habit-drafts/)).toHaveLength(0);
  });

  it("reuses transport identity, starts a fresh completed-failure retry, and clears old errors after success", async () => {
    const { user, server } = setup([], null);
    let attempts = 0;
    server.on("POST", /\/goals\/hqg-question\/habit-drafts$/, () => ++attempts === 1 ? { status: 503, body: { detail: "Try this request again." } } : attempts === 2 ? { ...batch, items: [], outcome: "budget_unavailable", message: "Open Settings to review the cap." } : batch);
    await user.click(await screen.findByRole("button", { name: "Make three habits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try this request again.");
    await user.click(screen.getByRole("button", { name: "Try generating habits" }));
    await screen.findByRole("link", { name: "Open generation settings" });
    await user.click(screen.getByRole("button", { name: "Try generating habits" }));
    await screen.findByText("My question mark");
    const calls = server.sent("POST", /\/habit-drafts$/);
    expect(calls[0].body).toEqual(calls[1].body);
    expect((calls[2].body as { request_id: string }).request_id).not.toEqual((calls[1].body as { request_id: string }).request_id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the full plan and makes room before accepting a choice", async () => {
    const { user, server } = setup([batch], null);
    server.state.plans.c1 = Array.from({ length: 6 }, (_, i) => ({ ...server.state.plans.c1[0], id: `existing${i}`, habit_id: `existing${i}`, kid_title: `Existing ${i}` }));
    await screen.findByText(/Plan full/);
    expect(screen.getByRole("button", { name: "Add to Alex's quests" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove Existing 0 from plan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to Alex's quests" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add to Alex's quests" }));
    await screen.findByText("Added to Alex's quests");
    expect(server.state.plans.c1).toHaveLength(6);
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(0);
  });

  it("prepares three funded habits per goal, updates the meter after every result and hides inline accounting", async () => {
    const { user, server, setCards } = setup([], null);
    const goals = Array.from({ length: 4 }, (_, i) => ({ ...goal, id: `rec${i}`, goal_id: `hqg-goal${i}`, title: `Goal ${i + 1}` }));
    setCards([]);
    let budget: CoachingBudget = { allowance: 100, used: 0, pending: 0, remaining: 100, overage: 0, reset_at: "2099-01-01T00:00:00Z", enforced: false, show_costs: true, activity_quotes: { coach: 2, habit_batch: 1 }, policy_revision: 1 };
    server.on("GET", /\/ai\/budget$/, () => budget);
    const accounting = () => ({ operation_id: "coach-op", parent_operation_id: null, activity: "coach", status: "completed", credits: 2, pending_credits: 0, budget, automatic_slots: goals.map(card => ({ goal_id: card.goal_id, parent_operation_id: "coach-op" })), interaction: { credits: budget.used, pending_credits: budget.pending, batches_ready: budget.used - 2, batches_pending: budget.pending, batches_failed: 0 } });
    server.on("POST", /\/ai\/operations\/coach-op\/observation$/, () => ({ status: 204 }));
    await screen.findByRole("textbox", { name: "Message the habit coach" });
    server.on("POST", /\/coach\/messages$/, () => { setCards(goals); budget = { ...budget, used: 2, pending: 4, remaining: 94 }; return { messages: [{ id: 1, role: "coach", content: "Here are four goals.", created_at: goal.created_at, sources: [] }], suggestions: [], goal_recommendations: goals, response_goal_ids: goals.map(card => card.goal_id), reply: "Here are four goals.", safety: null, mapped_by: "ai", outcome: "recommendations", tokenomics: accounting() }; });
    const original = globalThis.fetch;
    const releases: (() => void)[] = [];
    let active = 0, maximum = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (init.method === "POST" && /\/habit-drafts(?:\?|$)/.test(String(url))) {
        active++; maximum = Math.max(maximum, active);
        await new Promise<void>(resolve => releases.push(resolve));
        try {
          const response = await original(url, init);
          budget = { ...budget, used: budget.used + 1, pending: budget.pending - 1 };
          return new Response(JSON.stringify({ ...await response.json(), tokenomics: { ...accounting(), operation_id: `habit-op-${releases.length}`, parent_operation_id: "coach-op", activity: "habit_batch", credits: 1 } }));
        } finally { active--; }
      }
      return original(url, init);
    });
    await user.type(screen.getByRole("textbox", { name: "Message the habit coach" }), "Help with learning and getting ready");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(releases).toHaveLength(2));
    await screen.findByLabelText("2 / 100 credits used");
    expect(screen.queryByLabelText("Generation accounting")).not.toBeInTheDocument();
    expect(screen.queryByText(/Including prepared habits|A useful Coach response uses|Preparing three habit choices adds/)).not.toBeInTheDocument();
    await act(async () => { releases[0](); releases[1](); });
    await waitFor(() => expect(releases).toHaveLength(4));
    await screen.findByLabelText("4 / 100 credits used");
    await act(async () => { releases[2](); releases[3](); });
    await waitFor(() => expect(document.querySelectorAll(".habit-draft")).toHaveLength(12));
    await screen.findByLabelText("6 / 100 credits used");
    expect(screen.getByRole("progressbar", { name: "Coaching credits used" })).toHaveValue(6);
    expect(screen.queryByLabelText("Generation accounting")).not.toBeInTheDocument();
    expect(screen.queryByText(/Including prepared habits|per useful batch/)).not.toBeInTheDocument();
    expect(maximum).toBe(2);
    expect(server.sent("POST", /habit-drafts$/).every(call => (call.body as { count: number }).count === 3)).toBe(true);
    expect(server.sent("POST", /habit-drafts$/).every(call => (call.body as { parent_operation_id: string }).parent_operation_id === "coach-op")).toBe(true);
    const goalsOnScreen = document.querySelectorAll(".source-goal--rich");
    expect(goalsOnScreen).toHaveLength(4);
    goalsOnScreen.forEach(card => expect(card.querySelectorAll(".habit-draft")).toHaveLength(3));
    await user.click(within(goalsOnScreen[0] as HTMLElement).getAllByRole("button", { name: "Add to Alex's quests" })[0]);
    await screen.findByText("Added to Alex's quests");
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(document.querySelectorAll(".source-goal--rich")).toHaveLength(1));
    await waitFor(() => expect(document.querySelectorAll(".habit-draft")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Remove goal and 1 habit" })).toBeInTheDocument();
    expect(screen.getByText("Added to Alex's quests")).toBeInTheDocument();
    expect(screen.getByText(/Earlier unadded choices are no longer current/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(server.sent("GET", /\/habits\/[^/]+\/details$/)).toHaveLength(1);
    expect(server.sent("POST", /habit-drafts$/)).toHaveLength(4);
  });
});
